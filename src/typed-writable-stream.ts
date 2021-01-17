import { Channel, MessageType } from "./interface/queued-message"

const Concentrate = require('concentrate')

export class TypedWritableStream {
  [x: string]: any
  private stream = new Concentrate()

  constructor(channel: Channel) {
    this.stream.pipe(channel)
  }

  writeType(type: MessageType) {
    this.stream.int8(type)

    return this
  }

  writeCallback(callback: string) {
    this.stream.string(callback, 'utf8')
  }

  writeJSON(data: any) {
    const result = JSON.stringify(data)

    this.stream.int32(Buffer.byteLength(result, 'utf8'))
    this.stream.string(result, 'utf8')

    return this
  }

  flush() {
    this.stream.flush()
  }

  destroy() {
    this.stream.destroy()
  }
}
