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
  REQ,
  ERR
}

export interface Channel extends tls.TLSSocket {
  type: ChannelType
  name: string
  queue: RemoteQueue
  prefix?: string
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
  private handler?: Function

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

  setHandler(handler?: Function) {
    this.handler = handler
  }

  resolve(result: any) {
    const callback = this.pop()

    if (!this._resolve || !this._reject) {
      throw new Error('Invalid callback')
    }

    switch (this.type) {
      case ChannelType.MAP: {
        if (!Array.isArray(result)) {
          console.log(`DEBUG: WARNING: ChannelType.MAP Requires a result array`)

          return this._resolve(this.args)
        }

        if (this.handler && typeof this.handler === 'function') {
          const handler = this.handler
          const resolve = this._resolve
          const reject = this._reject

          return Promise.all(this.args.map(async (value: any, index: number) => {
            await Promise.resolve(handler(value, result[index]))
          }))
          .then(() => resolve.call(this, this.args))
          .catch((e) => reject.call(this, e))
        }

        return this._resolve(result)
      }
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
