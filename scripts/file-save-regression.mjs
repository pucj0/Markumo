// Real controllers and canonical CM history with a controllable IPC transport.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/phase07/save'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script type="module">
import {DocumentManager} from '/src/editor/core/DocumentManager.ts'
import {FileController} from '/src/features/files/FileController.ts'
import {AutoSaveController} from '/src/features/files/AutoSaveController.ts'
import {Transaction} from '@codemirror/state'
import {isolateHistory,undoDepth} from '@codemirror/commands'
window.f={DocumentManager,FileController,AutoSaveController,Transaction,isolateHistory,undoDepth}
</script>`)
const server = await createServer({ server: { host: '127.0.0.1', port: 1482, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:1482/${output}/index.html`)
  await page.waitForFunction(() => window.f)
  const result = await page.evaluate(async () => {
    const f = window.f, m = new f.DocumentManager([], async () => []), calls = [], released = [], notices = []
    const metadata = { token: 'selected', name: 'save.txt', path: 'E:/fixture/save.txt', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: 'v1' }
    const gateway = { release: async token => released.push(token), saveTarget: async () => null,
      save: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) }
    const files = new f.FileController(m, gateway, message => notices.push(message))
    files.accept({ ...metadata, text: 'Original' }); const id = m.activeId
    const edit = text => m.dispatch(id, { changes: { from: m.getState(id).doc.length, insert: text }, annotations: f.isolateHistory.of('full') })
    edit(' saved snapshot'); const pending = files.save(id)
    const rapid = await files.save(id), auto = await files.autoSave(id), close = files.close(id, true)
    edit(' newer input'); const other = m.createUntitled('txt')
    calls[0].resolve({ ...metadata, version: 'v2' })
    const saved = await pending
    const duringSave = { rapid, auto, close, saved, count: calls.length, diskText: calls[0].args[1],
      expectedVersion: calls[0].args[2], currentText: m.getText(id), dirty: m.metadata(id).dirty,
      version: m.metadata(id).lastDiskVersion, active: m.activeId === other, saving: files.saving.size }
    m.select(id); const before = m.getText(id), depth = f.undoDepth(m.getState(id))
    const failed = files.save(id); calls[1].reject(Error('injected disk conflict'))
    const failure = { saved: await failed, text: m.getText(id), depth: f.undoDepth(m.getState(id)), dirty: m.metadata(id).dirty }
    m.command('undo'); const undone = m.getText(id)
    const cancelled = await files.save(id, true)
    files.dispose(); m.dispose()
    return { duringSave, before, depth, failure, undone, cancelled, notices, released }
  })
  assert.deepEqual(result.duringSave, { rapid: false, auto: 'skipped', close: 'saving', saved: false, count: 1,
    diskText: 'Original saved snapshot', expectedVersion: 'v1', currentText: 'Original saved snapshot newer input',
    dirty: true, version: 'v2', active: true, saving: 0 })
  assert.deepEqual(result.failure, { saved: false, text: result.before, depth: result.depth, dirty: true })
  assert.equal(result.undone, 'Original saved snapshot')
  assert.equal(result.cancelled, false)
  assert(result.notices.some(message => message.includes('injected disk conflict')))
  console.log('PASS async save snapshot, later input/dirty/version, rapid save, close guard, document switch, failure undo and cancelled save-as')
  await page.evaluate(() => {
    const f = window.f, manager = new f.DocumentManager([], async () => []), calls = []
    const meta = { token: 'auto', name: 'auto.txt', path: 'E:/fixture/auto.txt', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: 'v1' }
    const files = new f.FileController(manager, { release: async () => {}, save: (...args) => new Promise(resolve => calls.push({ args, resolve })) }, message => { throw Error(message) })
    files.accept({ ...meta, text: 'Original' })
    const auto = new f.AutoSaveController(manager, files)
    auto.configure(true, 0)
    manager.dispatch(manager.activeId, { changes: { from: 8, insert: ' first' } })
    window.autoTest = { manager, files, auto, calls, meta }
  })
  await page.waitForFunction(() => window.autoTest.calls.length === 1)
  assert.equal(await page.evaluate(() => window.autoTest.files.save(window.autoTest.manager.activeId)), false)
  await page.evaluate(() => {
    const t = window.autoTest
    t.manager.dispatch(t.manager.activeId, { changes: { from: 14, insert: ' second' } })
    t.calls[0].resolve({ ...t.meta, version: 'v2' })
  })
  await page.waitForFunction(() => window.autoTest.calls.length === 2)
  assert.deepEqual(await page.evaluate(() => window.autoTest.calls.map(call => ({ text: call.args[1], version: call.args[2] }))), [
    { text: 'Original first', version: 'v1' }, { text: 'Original first second', version: 'v2' },
  ])
  await page.evaluate(() => window.autoTest.calls[1].resolve({ ...window.autoTest.meta, version: 'v3' }))
  await page.waitForFunction(() => !window.autoTest.manager.activeDocument.dirty && window.autoTest.files.saving.size === 0)
  await page.evaluate(() => { const t = window.autoTest; t.auto.dispose(); t.files.dispose(); t.manager.dispose() })
  assert.deepEqual(errors, [])
  console.log('PASS actual AutoSaveController queue serializes later input and manual save using the latest native version')
} finally { await browser?.close(); await server.close() }
