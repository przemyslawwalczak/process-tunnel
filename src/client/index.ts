import * as tls from 'tls'
import { certStringToBuffer } from '../common'
import { ChannelType, Channel, MessageType } from '../interface/queued-message'
import { RemoteQueue } from '../remote-queue'

type PromiseChain = {
  then(callback: Function): PromiseChain
  catch(callback: Function): PromiseChain
  finally(callback: Function): PromiseChain
}

export default class Client {
  private port: number
  private host: string
  private context: tls.SecureContextOptions = {}

  constructor(port: number, host: string) {
    this.port = port
    this.host = host
  }

  setContext(context: tls.SecureContextOptions) {
    Object.assign(this.context, context)

    this.context.ca = certStringToBuffer(this.context.ca)
    this.context.cert = certStringToBuffer(this.context.cert)
    this.context.key = certStringToBuffer(this.context.key)

    return this
  }

  checkServerIdentity(host: string, cert: tls.PeerCertificate): Error | undefined {
    console.log('checking server identity:', host)

    return undefined
  }

  private async establishChannelConnection(type: ChannelType, name: string): Promise<Channel> {  
    const options: tls.ConnectionOptions = {
      host: this.host,
      port: this.port,
      requestCert: true,
      checkServerIdentity: this.checkServerIdentity,
      secureContext: tls.createSecureContext(this.context)
    }

    const socket = tls.connect(options)

    return new Promise((resolve, reject) => {
      const onListenError = (e: any) => {
        console.log(e)

        reject(e)
      }

      socket.once('error', onListenError)
      
      socket.on('secureConnect', () => {
        socket.removeListener('error', onListenError)

        socket.on('error', (e) => {
          if (e.code === 'ECONNRESET') {
            console.log('connection resetted')
            return
          }

          console.log('UncaughtSecureSocketError:', e)
          socket.destroy(e)
        })

        const channel: Channel = <Channel>socket

        console.log('SecureConnection:', channel.remotePort, channel.localPort)

        channel.type = type
        channel.name = name

        channel.queue = new RemoteQueue(channel)

        socket.on('close', () => {
          channel.queue.destroy()
          socket.destroy()
        })
        
        channel.queue.send(MessageType.ACK, { type, name })
        .then(() => resolve(channel))
        .catch(reject)
      })
    })
  }

  map(name: string, handler: Function) {
    const chain: any[] = []

    this.establishChannelConnection(ChannelType.MAP, name)
    .then(async channel => {
      channel.on('REQ', (callback: string, array: any[]) => {
        let ref = Promise.all(array.map(async (value, index) => {
          return await Promise.resolve(handler.call(this, value, index, array))
          .then((result = value) => {
            return array[index] = result
          })
        }))

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
    .then(async channel => {
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