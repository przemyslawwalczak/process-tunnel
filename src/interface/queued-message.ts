import Interface from '.'
import * as tls from 'tls'
import * as uuid from 'uuid'
import { RemoteQueue } from "../remote-queue"

export type Queue = any

export enum ChannelType {
  CALL,
  MAP
}
export enum MessageType {
  ACK,
  REQ
}

export interface Channel extends tls.TLSSocket {
  type: ChannelType
  name: string
  queue: RemoteQueue
}


export class QueuedMessage {
  public promise: Promise<any>
  private id: string
  private _resolve: Function | undefined
  private _reject: Function | undefined
  private type: ChannelType
  private name: string
  private args: any[]
  private _queue: Queue
  public timeout: NodeJS.Timeout | null = null

  constructor(type: ChannelType, name: string, args: any[]) {
    this.type = type
    this.name = name

    this.args = args

    this.id = uuid.v4()

    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject

      this.timeout = setTimeout(() => {
        this.reject(new Error(`Timedout: ${this.id}`))
      }, 3000)
    })
  }

  resolve(result: any) {
    const callback = this.pop()

    if (!this._resolve) {
      throw new Error('Invalid callback')
    }

    return this._resolve(result)
  }

  reject(reason?: any) {
    const callback = this.pop()

    if (!this._reject) {
      throw new Error('Invalid callback')
    }
    
    return this._reject(reason)
  }

  bind(queue: Queue) {
    this._queue = queue

    return queue[this.id] = this
  }

  pop() {
    if (!this._queue) return

    const result = this._queue[this.id]

    delete this._queue[this.id]
    delete this._queue

    clearTimeout(<NodeJS.Timeout>result.timeout)

    return result
  }

  toJSON(self: Interface) {
    return {
      type: this.type,
      name: this.name,
      args: this.args,
      callback: this.id,
      endpoint: { port: self.port, host: self.host }
    }
  }
}
