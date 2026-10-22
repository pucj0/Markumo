import { createServer as createPortProbe } from 'node:net'
import { createServer } from 'vite'

// Vite 6 treats server.port=0 as its default port. Reserve an OS-assigned
// positive port first, which also gives the repo's Vite cache isolation a key.
export async function startRegressionServer() {
  const probe = createPortProbe()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } })
  await server.listen()
  return server
}
