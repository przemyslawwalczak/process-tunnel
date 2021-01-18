import * as Tunnel from '../lib'
import * as path from 'path'

const client = new Tunnel.Client(8082, 'localhost', 'tg')
.setContext({
  ca: [path.join(process.cwd(), 'ssl', 'cert.pem')],
  cert: path.join(process.cwd(), 'ssl', 'cert.pem'),
  key: path.join(process.cwd(), 'ssl', 'key.pem')
})

client.call('test', async (arg, arg2, arg3) => {
  console.log('test called:', arg, arg2, arg3)

  return arg * arg2 * arg3
})
.then(() => {
  console.log('then with result')

  return 'pentagon'
})
.catch((e) => {
  console.log('on error:', e)
})

client.map('hello.world', async (value, index, array) => {
  console.log('mapping value:', value, index, array)

  // throw new Error('DEBUG')

  return { alive: false }
})