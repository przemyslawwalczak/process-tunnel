import { Channel, MessageType } from "./interface/queued-message"
import { RemoteQueue } from "./remote-queue"

const Dissolve = require('dissolve')

export class TypedReadableStream {
  private stream: any

  constructor(channel: Channel, queue: RemoteQueue) {
    this.stream = new Dissolve()

    this.stream.loop(() => {
      this.stream.int8('type')
      .tap(() => {
        switch (this.stream.vars.type) {
          case MessageType.ACK: {
            this.stream.int32('length')
          } break

          case MessageType.REQ: {
            this.stream.string('callback', 36)
            this.stream.int32('length')
          } break

          case MessageType.ERR: {
            this.stream.string('callback', 36)
            this.stream.int32('length')
          } break
        }
        
        this.stream.tap(() => {
          this.stream.string('args', this.stream.vars.length)
        })
      })
      .tap(() => {
        this.stream.vars.args = JSON.parse(this.stream.vars.args)
        this.stream.push(this.stream.vars)
        this.stream.vars = {}
      })
    })

    this.stream.on('readable', () => {
      let packet
      while (packet = this.stream.read()) {
        console.log(packet)

        switch (packet.type) {
          case MessageType.ACK: {
            queue.approve(packet.args.type, packet.args.name, packet.args.prefix)
          } break

          case MessageType.REQ: {
            channel.emit('REQ', packet.callback, packet.args)
          } break

          case MessageType.ERR: {
            channel.emit('ERR', packet.callback, packet.args)
          } break

          default: channel.destroy(new Error(`Unhandled MessageType (${packet.type})`))
        }
      }
    })

    channel.pipe(this.stream)
  }

  destroy() {
    this.stream.end()
  }
}