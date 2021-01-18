import * as tls from 'tls'
import * as cluster from 'cluster'
import * as dns from 'dns'
import { certStringToBuffer } from '../common'
import { ChannelType, QueuedMessage, Channel } from '../interface/queued-message'
import { RemoteQueue } from '../remote-queue'
import Interface from '../interface'
import { clear } from 'console'

export default class Server extends Interface {
  private endpoint: tls.Server
  private context: tls.SecureContextOptions
  private config: tls.TlsOptions
  private version: tls.SecureVersion

  constructor() {
    super()

    this.version = 'TLSv1.3'

    this.context = {
      maxVersion: this.version,
      minVersion: this.version
    }

    this.config = {
      secureContext: tls.createSecureContext(this.context),
      requestCert: true
    }

    this.endpoint = tls.createServer(this.config, (socket) => this.secureConnection(socket))
  }

  setContext(context: tls.SecureContextOptions) {
    Object.assign(this.context, context)

    return this
  }

  setConfig(config: tls.TlsOptions) {
    Object.assign(this.config, config)

    return this
  }

  secureConnection(socket: tls.TLSSocket) {
    if (!socket.authorized) {
      return socket.destroy()
    }
    
    const channel: Channel = socket as Channel

    socket.on('error', (e) => {   
      if (e.code === 'ECONNRESET') {
        return
      }

      console.log('SecureSocketError:', e.message)

      socket.unpipe()
      socket.destroy()
    })

    socket.on('close', () => {
      if (channel.queue) {
        channel.queue.destroy()
      }

      const index = this.process.indexOf(channel)

      if (index === -1) {
        return
      }

      this.process.splice(index, 1)

      socket.unpipe()
      socket.destroy()

      console.log(`Channel closed: ${channel.name} (${channel.type})`)
    })

    channel.queue = new RemoteQueue(channel)

    channel.once('approved', (type: ChannelType, name: string, prefix?: string) => {
      let result: Channel | null = null

      this.process.map((channel) => {
        console.log('channel name:', channel.name, channel.type, channel.prefix)

        if (channel.name && channel.name === name && channel.type === type && channel.prefix === prefix) {
          result = channel
        }
      })

      if (result) {
        return channel.destroy(new Error(`Unique channels only required`))
      }

      channel.type = type
      channel.name = name
      channel.prefix = prefix

      this.process.push(channel)
    })
  }

  address() {
    const result: any = super.address()

    const endpoint: any = this.endpoint.address()

    result.port = endpoint?.port || result.port
    result.address = endpoint?.address || result.address

    return result
  }

  async resolve(host: string | undefined): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (!host) {
        return resolve(this.host)
      }

      dns.lookup(host, (e, address) => {
        if (e) return resolve(this.host)
        resolve(address)
      })
    })
  }

  async listen(port?: number, host?: string, exclusive: boolean = false): Promise<Server> {
    this.port = port
    this.host = await this.resolve(host)

    if (cluster.isWorker && !exclusive) {
      process.on('message', (message) => {
        if (typeof message !== 'object') {
          return
        }

        const result: QueuedMessage = this.queue[message.callback]

        if (!result) {
          return console.log('callback not found')
        }

        if (message.error) {
          return result.reject(new Error(message.error))
        }

        result.resolve(message.result)
      })

      return this
    }

    this.exclusive = true

    this.context.ca = certStringToBuffer(this.context.ca)
    this.context.cert = certStringToBuffer(this.context.cert)
    this.context.key = certStringToBuffer(this.context.key)

    this.endpoint.setSecureContext(this.context)

    cluster.on('online', (thread) => {
      thread.once('disconnect', () => {
        thread.removeAllListeners('REQ')
        thread.removeAllListeners('ACK')
      })

      thread.on('message', (message) => {
        if (typeof message !== 'object') {
          return
        }

        if (this.port !== message.endpoint?.port || this.host !== message.endpoint?.host) {
          return
        }

        delete message.endpoint

        const callback = message.callback

        delete message.callback

        let channel: Channel | null = null

        for (let result of this.process) {
          if (result.name === message.name && result.type === message.type) {
            channel = result
          }
        }

        new Promise((resolve, reject) => {
          if (!channel) {
            return resolve(null)
          }

          switch (message.type) {
            case ChannelType.MAP:
            case ChannelType.CALL: channel.queue.callback(callback, message.args); break
            default: return reject(new Error(`ChannelType: ${message.type} not handled`))
          }

          const timeout = setTimeout(() => {
            channel?.removeListener('REQ', reqHandler)
            channel?.removeListener('ERR', errHandler)

            reject(new Error(`Request (${callback}) timedout on response`))
          }, 3000)

          const reqHandler = (id: string, result: any) => {
            if (id !== callback) {
              return
            }

            clearTimeout(timeout)

            channel?.removeListener('REQ', reqHandler)
            channel?.removeListener('ERR', errHandler)

            resolve(result)
          }

          const errHandler = (id: string, result: any) => {
            if (id !== callback) {
              return
            }

            clearTimeout(timeout)

            channel?.removeListener('REQ', reqHandler)
            channel?.removeListener('ERR', errHandler)

            reject(new Error(result.error))
          }

          channel.on('REQ', reqHandler)
          channel.on('ERR', errHandler)
        })
        .then(async result => {
          thread.send({ callback, result })
        })
        .catch(async e => {
          thread.send({ callback, error: e.message })
        })
        .catch(e => {
          console.log('Uncaught exception:', e)
          thread.destroy()
        })
      })
    })

    return new Promise((resolve, reject) => {
      this.endpoint?.once('error', (e) => {
        reject(e)
      })

      this.endpoint?.once('listening', () => {
        this.endpoint.on('error', (e) => {
          console.log('server error:', e.name)
        })

        resolve(this)
      })

      this.endpoint?.listen({ port, host, exclusive: this.exclusive })
    })
  }
}