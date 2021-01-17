import * as Tunnel from '../lib'
import * as path from 'path'
import * as cluster from 'cluster'

if (cluster.isMaster) {
  console.log('master pid:', process.pid)

  new Tunnel.Server()
  .setContext({
    ca: [path.join(process.cwd(), 'ssl', 'cert.pem')],
    cert: path.join(process.cwd(), 'ssl', 'cert.pem'),
    key: path.join(process.cwd(), 'ssl', 'key.pem')
  })
  .listen(8082, 'localhost')
  .then((server) => {
    console.log(server.address())
  })
  .catch(e => {
    console.log(e)
  })

  for (let i=0; i<2; i++) {
    cluster.fork()
  }
} else {
  console.log('fork pid:', process.pid)

  new Tunnel.Server()
  .listen(8082, 'localhost')
  .then((server) => {
    console.log(server.address())

    setInterval(() => {
      const array = [50, 60, 70]

      server.map('hello.world', array)
      .then(result => {
        console.log('returned result:', result)
      })
      .catch(e => {
        console.log('message not sent:', e)
      })
    }, 5000)
  })
  .catch(e => {
    console.log(e)
  })
}
