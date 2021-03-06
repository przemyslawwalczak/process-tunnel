import * as tls from 'tls'
import { certStringToBuffer } from '../common'
import { ChannelType, Channel, MessageType } from '../interface/queued-message'
import { RemoteQueue } from '../remote-queue'
import * as EventEmitter from 'events'

type PromiseChain = {
  then(callback: Function): PromiseChain
  catch(callback: Function): PromiseChain
  finally(callback: Function): PromiseChain
}

export default class Client {
  private port: number
  private host: string
  private context: tls.SecureContextOptions = {}
  private timeout: NodeJS.Timeout | null = null
  private prefix?: string

  constructor(port: number, host: string, prefix?: string) {
    this.port = port
    this.host = host

    this.prefix = prefix
  }

  setContext(context: tls.SecureContextOptions) {
    Object.assign(this.context, context)

    this.context.ca = certStringToBuffer(this.context.ca)
    this.context.cert = certStringToBuffer(this.context.cert)
    this.context.key = certStringToBuffer(this.context.key)

    return this
  }

  checkServerIdentity(host: string, cert: tls.PeerCertificate): Error | undefined {
    // NOTE: Removed this handler for now, extendable if needed
    // We trust our host :) (unsecure, but simple for now)

    return undefined
  }

  private async connect(type: ChannelType, name: string): Promise<Channel> {
    const options: tls.ConnectionOptions = {
      host: this.host,
      port: this.port,
      requestCert: true,
      checkServerIdentity: this.checkServerIdentity,
      secureContext: tls.createSecureContext(this.context)
    }

    const socket = tls.connect(options)

    return new Promise((resolve, reject) => {
      const onListenError = (e: any) => reject(e)

      socket.once('error', onListenError)
      
      socket.on('secureConnect', () => {
        clearTimeout(this.timeout as NodeJS.Timeout)

        socket.removeListener('error', onListenError)

        socket.on('error', (e) => {
          if (e.code === 'ECONNRESET') return
          console.error('UncaughtSecureSocketError:', e)
          socket.destroy(e)
        })

        const channel: Channel = socket as Channel

        channel.type = type
        channel.name = name

        channel.queue = new RemoteQueue(channel)

        socket.on('close', () => {
          channel.queue.destroy()
        })

        channel.queue.send(MessageType.ACK, { type, name: name, prefix: this.prefix })
        .then(() => {
          resolve(channel)
        })
        .catch(reject)
      })
    })
  }

  private establishChannelConnection(type: ChannelType, name: string) {
    const connection = new EventEmitter()

    connection.on('connect', (type: ChannelType, name: string) => {
      this.connect(type, name)
      .then(channel => {
        channel.once('close', () => {
          clearTimeout(this.timeout as NodeJS.Timeout)

          this.timeout = setTimeout(() => {
            connection.emit('connect', type, name)
          }, 10000)
        })

        connection.emit('channel', channel)
      })
      .catch(e => {
        clearTimeout(this.timeout as NodeJS.Timeout)

        this.timeout = setTimeout(() => {
          connection.emit('connect', type, name)
        }, 10000)
      })
    })

    connection.emit('connect', type, name)

    return connection
  }

  map(name: string, handler: Function) {
    const chain: any[] = []

    this.establishChannelConnection(ChannelType.MAP, name)
    .on('channel', (channel: Channel) => {
      channel.on('REQ', (callback: string, array: any[]) => {
        // NOTE: Promise.all is concurrent!
        let ref = Promise.all(array.map(async (value, index) => Promise.resolve(handler.call(this, value, index, array))
          .then((result = value) => {
            return array[index] = result
          })
        ))

        chain.map((chain) => {
          switch (chain.type) {
            case 'then': ref = ref.then(chain.callback); break
            case 'catch': ref = ref.catch(chain.callback); break
            case 'finally': ref = ref.finally(chain.callback); break
          }
        })
        
        ref.then((result: any[] = []) => {
          channel.queue.callback(callback, result)
        })
        .catch((e: any) => channel.queue.error(callback, e))
        .catch((e: any) => channel.destroy(e))
      })
    })

    const result: PromiseChain = {
      then(callback: Function): PromiseChain {
        chain.push({ type: 'then', callback })
        return result
      },
      catch(callback: Function): PromiseChain {
        chain.push({ type: 'catch', callback })
        return result
      },
      finally(callback: Function): PromiseChain {
        chain.push({ type: 'finally', callback })
        return result
      }
    }

    return result
  }
  
  call(name: string, handler: Function) {
    const chain: any[] = []

    this.establishChannelConnection(ChannelType.CALL, name)
    .on('channel', (channel: Channel) => {
      channel.on('REQ', (callback: string, args: any[]) => {
        let ref = Promise.resolve(handler.apply(this, args))

        chain.map((chain) => {
          switch (chain.type) {
            case 'then': ref = ref.then(chain.callback); break
            case 'catch': ref = ref.catch(chain.callback); break
            case 'finally': ref = ref.finally(chain.callback); break
          }
        })
        
        ref.then((result = null) => {
          channel.queue.callback(callback, result)
        })
        .catch((e: any) => channel.destroy(e))
      })
    })

    const result: PromiseChain = {
      then(callback: Function): PromiseChain {
        chain.push({ type: 'then', callback })
        return result
      },
      catch(callback: Function): PromiseChain {
        chain.push({ type: 'catch', callback })
        return result
      },
      finally(callback: Function): PromiseChain {
        chain.push({ type: 'finally', callback })
        return result
      }
    }

    return result
  }
}