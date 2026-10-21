// Saving source files in the desktop editor must not remount its own UI.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { devOptions } from './devOptions.mjs'

// Vite always ignores test-results, so use an isolated watched source fixture.
const root = fs.mkdtempSync(path.resolve('.dev-save-fixture-'))
const savedFile = path.join(root, 'edited.js')
const initial = 'export const value = 1;\n'
fs.writeFileSync(savedFile, initial)
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(path.join(root, 'watch.html'), '<!doctype html><script type="module">import "./edited.js"; window.watchReady = true;</script>')
fs.writeFileSync(path.join(root, 'fixture.js'), `
import './edited.js';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createApp } from 'vue';
import App from '/src/App.vue';
window.isTauri = true;
mockWindows('main');
const calls = [], meta = { token: 'saved-source', path: 'E:/fixture/edited.js', name: 'edited.js', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: 'v1' };
const layout = { mode: 'single', sidebarWidth: 240, sidebarVisible: false };
mockIPC(async (command, args) => {
  calls.push(command);
  if (command === 'plugin:event|listen') return args.handler;
  if (command === 'load_editor_settings') return { externalFileMonitoring: false, autoCheckUpdates: false };
  if (command === 'initialize_launch') return { kind: 'app', ownsSession: true, files: { files: [{ ...meta, text: ${JSON.stringify(initial)} }], errors: [] }, roots: [], activePath: meta.path, layout, warnings: [] };
  if (command === 'save_file') {
    const response = await fetch('/__save_fixture', { method: 'POST', body: args.text });
    if (!response.ok) throw Error('Fixture disk write failed');
    return { ...meta, version: 'v' + calls.filter(call => call === 'save_file').length + '-saved' };
  }
  if (command === 'file_preferences') return { recent: [], layout };
  if (command === 'get_recent_workspaces' || command === 'list_recovery_records') return [];
  if (command === 'drain_pending') return { files: [], errors: [] };
  if (command === 'begin_external_watch') return 1;
  if (command === 'watch_external_files') return { watcherCount: 0, directoryCount: 0, fileCount: 0 };
  if (command === 'update_runtime') return { version: '1.0.5', platform: 'linux', installSupported: false };
  if (command === 'confirm_update_startup') return null;
  return undefined;
});
const app = createApp(App); app.mount('#app');
window.test = { setup: app._instance.setupState, calls, identity: Math.random() };
`)

const options = devOptions(['dev'], process.cwd(), {})
const oldReload = process.env.MARKUMO_DESKTOP_NO_RELOAD
process.env.MARKUMO_DESKTOP_NO_RELOAD = options.env.MARKUMO_DESKTOP_NO_RELOAD
const server = await createServer({ server: { host: '127.0.0.1', port: 1497, strictPort: true }, plugins: [{
  name: 'save-fixture', configureServer(server) {
    server.middlewares.use('/__save_fixture', (req, res) => {
      let text = ''; req.on('data', chunk => { text += chunk });
      req.on('end', () => { fs.writeFileSync(savedFile, text); res.end('saved') });
    })
  },
}] })
let browser, watchServer
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage(), errors = [], reloads = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (typeof payload === 'string' && payload.includes('full-reload')) reloads.push(payload)
  }))
  await page.goto(`http://127.0.0.1:1497/${path.basename(root)}/index.html`)
  await page.waitForFunction(() => window.test && !window.test.setup.startupLoading)
  const identity = await page.evaluate(() => window.test.identity)
  for (let i = 1; i <= 10; i++) {
    await page.evaluate(i => {
      const m = window.test.setup.manager, id = m.activeId;
      m.dispatch(id, { changes: { from: m.getText(id).length, insert: '\n// save ' + i } });
    }, i)
    await page.keyboard.press('Control+s')
    await page.waitForFunction(i => window.test?.calls.filter(call => call === 'save_file').length >= i && !window.test.setup.fileBusy, i)
    // Vite batches watch events asynchronously; wait for its HMR delivery too.
    await new Promise(resolve => setTimeout(resolve, 180))
    assert.equal(reloads.length, 0, 'A normal desktop save triggered a Vite page reload and startup overlay')
    assert.equal(await page.evaluate(() => window.test.identity), identity)
    assert.equal(await page.locator('.startup-overlay').count(), 0)
  }
  assert.equal(await page.evaluate(() => window.test.calls.filter(call => call === 'initialize_launch').length), 1)
  assert.match(fs.readFileSync(savedFile, 'utf8'), /save 10/)
  const savedText = await page.evaluate(() => window.test.setup.manager.getText(window.test.setup.manager.activeId))
  await page.evaluate(() => window.test.setup.manager.command('undo'))
  assert.notEqual(await page.evaluate(() => window.test.setup.manager.getText(window.test.setup.manager.activeId)), savedText, 'Save must preserve editor undo history')
  assert.deepEqual(errors, [])
  console.log('PASS ten real desktop Ctrl+S writes preserve App identity and never reopen the startup overlay')

  assert.equal(options.watch, false)
  assert.ok(options.args.includes('--no-watch'))
  const watched = devOptions(['dev', '--watch'], process.cwd(), {})
  assert.equal(watched.watch, true)
  assert.equal(watched.env.MARKUMO_DESKTOP_NO_RELOAD, '0')
  assert.ok(!watched.args.includes('--watch') && !watched.args.includes('--no-watch'))
  const runner = devOptions(['dev', '--', '--watch'], process.cwd(), {})
  assert.deepEqual(runner.args.slice(runner.args.indexOf('--')), ['--', '--watch'])
  assert.equal(runner.watch, false)
  const disabled = devOptions(['dev', '--watch', '--no-watch'], process.cwd(), {})
  assert.equal(disabled.watch, false)
  assert.equal(disabled.args.filter(arg => arg === '--no-watch').length, 1)
  assert.deepEqual(devOptions(['build'], process.cwd(), {}).args, ['build'])
  console.log('PASS explicit watch, no-watch precedence, runner arguments and build isolation')

  // The opt-in still uses real Vite code watching, rather than silently losing
  // the existing development workflow. A saved imported source must reload it.
  process.env.MARKUMO_DESKTOP_NO_RELOAD = watched.env.MARKUMO_DESKTOP_NO_RELOAD
  watchServer = await createServer({ server: { host: '127.0.0.1', port: 1498, strictPort: true } })
  await watchServer.listen()
  const watchedPage = await browser.newPage(), watchReloads = []
  watchedPage.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (typeof payload === 'string' && payload.includes('full-reload')) watchReloads.push(payload)
  }))
  await watchedPage.goto(`http://127.0.0.1:1498/${path.basename(root)}/watch.html`)
  await watchedPage.waitForFunction(() => window.watchReady)
  fs.appendFileSync(savedFile, '\n// explicit hot reload\n')
  await watchedPage.waitForFunction(() => document.readyState === 'complete')
  for (let i = 0; i < 100 && watchReloads.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(watchReloads.length > 0, 'Explicit --watch must retain code hot reload')
  console.log('PASS opt-in watch still reloads when an imported source file is saved')
} finally {
  await browser?.close(); await watchServer?.close(); await server.close()
  if (oldReload === undefined) delete process.env.MARKUMO_DESKTOP_NO_RELOAD
  else process.env.MARKUMO_DESKTOP_NO_RELOAD = oldReload
  assert.ok(root.startsWith(path.resolve('.dev-save-fixture-')))
  fs.rmSync(root, { recursive: true, force: true })
}
