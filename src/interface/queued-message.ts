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

    if (!this._resolve || !this._reject) {
      throw new Error('Invalid callback')
    }

    console.log('resolved result:', result, this.args)

    switch (this.type) {
      case ChannelType.MAP: {
        if (!Array.isArray(result)) {
          console.log(`DEBUG: WARNING: ChannelType.MAP Requires a result array`)
          
          return this._resolve(this.args)
        }

        for (let index in this.args) {
          const current = this.args[index]
          const value = result[index]

          if (typeof value === 'object' && typeof this.args[index] === 'object') {
            // TODO: Use loadash deep merge, but we will do shallow merge for now
            Object.assign(current, value)
            continue
          }

          this.args[index] = value
        }

        return this._resolve(this.args)
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
