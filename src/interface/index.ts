import * as cluster from 'cluster'
import { QueuedMessage, Channel, Queue, ChannelType } from './queued-message'

export default class Interface {
  public port: number | undefined
  public host: string | undefined
  public process: Channel[] = []
  public queue: Queue = {}
  public exclusive: boolean = false

  constructor(port?: number, host?: string) {
    this.port = port
    this.host = host
  }

  address() {
    return { pid: process.pid, port: this.port, address: this.host, isMaster: cluster.isMaster, isWorker: cluster.isWorker }
  }
  
  async call(name: string, ...args: any[]) {
    if (!this.exclusive && cluster.isWorker) {
      const message = new QueuedMessage(ChannelType.CALL, name, args)

      if (process.send) {
        process.send(message.toJSON(this), (e: any) => {
          if (e) return message.reject(e)
        })

        message.bind(this.queue)

        return message.promise
      }
    }

    return args
  }

  async map(name: string, array: Array<any>, handler?: Function) {
    if (!this.exclusive && cluster.isWorker) {
      const message = new QueuedMessage(ChannelType.MAP, name, array)

      if (process.send) {
        process.send(message.toJSON(this), (e: any) => {
          if (e) return message.reject(e)
        })

        message.bind(this.queue)

        return message.promise
      }
    }

    return array
  }
}