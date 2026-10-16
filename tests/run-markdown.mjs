import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
process.env.LIGHTEDIT_DESKTOP_NO_RELOAD = '1'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } })
try {
  await server.listen()
  const port = server.httpServer.address().port
  const requested = process.argv.slice(2)
  for (const script of requested.length ? requested : ['filetree-preview-tab-ui.mjs', 'markdown-html-parity-ui.mjs', 'markdown-html-interactions-ui.mjs', 'markdown-image-deletion-ui.mjs', 'codeblock-layout-ui.mjs', 'table-layout-ui.mjs', 'document-conversion-ui.mjs', 'export-presentation-ui.mjs', 'fleet-tab-drag-ui.mjs', 'typora-codeblock-ui.mjs', 'markdown-interactions-ui.mjs', 'markdown-wysiwyg-ui.mjs', 'typora-parity-ui.mjs', 'language-experience-ui.mjs', 'typora-visual-ui.mjs', 'markdown-wysiwyg-performance.mjs']) {
    const code = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'tests', script)], {
        cwd: root, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, LIGHTEDIT_TEST_URL: `http://127.0.0.1:${port}` },
      })
      child.on('error', reject)
      child.on('exit', done)
    })
    if (code !== 0) throw new Error(`${script} exited ${code}`)
  }
} finally {
  await server.close()
}
