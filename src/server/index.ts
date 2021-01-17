import * as tls from 'tls'
import * as cluster from 'cluster'
import * as dns from 'dns'
import { certStringToBuffer } from '../common'
import { ChannelType, QueuedMessage, Channel } from '../interface/queued-message'
import { RemoteQueue } from '../remote-queue'
import Interface from '../interface'

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

    const channel: any = socket

    socket.on('error', (e) => {
      console.log(e)
    })

    socket.on('close', () => {
      this.process.splice(this.process.indexOf(channel), 1)
    })

    channel.queue = new RemoteQueue(channel)

    channel.once('approved', (type: ChannelType, name: string) => {
      channel.type = type
      channel.name = name

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
      console.log('online:', thread.process.pid)

      thread.once('disconnect', () => {
        console.log('thread disconnected')
      })

      thread.on('message', (message) => {
        // TODO: Make sure we are interested in this message

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

          const handler = (id: string, result: any) => {
            if (id !== callback) {
              return
            }

            channel?.removeListener('REQ', handler)
            resolve(result)
          }

          channel.on('REQ', handler)
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
        resolve(this)
      })

      this.endpoint?.listen({ port, host, exclusive: this.exclusive })
    })
  }
}