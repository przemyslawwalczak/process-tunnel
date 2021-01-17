import { Channel, ChannelType, MessageType } from "./interface/queued-message"
import { TypedReadableStream } from "./typed-readable-stream"
import { TypedWritableStream } from "./typed-writable-stream"

export class RemoteQueue {
  public compiler: TypedWritableStream
  private parser: TypedReadableStream

  private channel: Channel
  private approved: boolean = false

  constructor(channel: Channel) {
    this.channel = channel
    this.compiler = new TypedWritableStream(channel)
    this.parser = new TypedReadableStream(channel, this)
  }

  approve(type: ChannelType, name: string) {
    if (this.approved) {
      return console.log('Warning! Channel already approved')
    }

    this.approved = true
    this.channel.emit('approved', type, name)
  }

  error(id: string, e: any) {
    this.compiler.writeType(MessageType.ERR)
    this.compiler.writeCallback(id)
    this.compiler.writeJSON({ error: e.message, code: e.code })
    this.compiler.flush()
  }

  callback(id: string, args: any[] = []) {
    this.compiler.writeType(MessageType.REQ)
    this.compiler.writeCallback(id)
    this.compiler.writeJSON(args)
    this.compiler.flush()
  }

  async send(type: MessageType, data: any = []) {
    this.compiler.writeType(type)
    this.compiler.writeJSON(data)
    this.compiler.flush()
  }

  destroy() {
    this.compiler.destroy()
    this.parser.destroy()
  }
}