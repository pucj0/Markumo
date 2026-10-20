// Real RecoveryController/DocumentManager with a controllable recovery
// transport. No user data or real app data directory is touched.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/phase07/recovery'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module">
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import { FileController } from '/src/features/files/FileController.ts'
import { RecoveryController } from '/src/features/recovery/RecoveryController.ts'
import { Transaction } from '@codemirror/state'
import { createApp, nextTick } from 'vue'
import RecoveryDialog from '/src/components/modals/RecoveryDialog.vue'
window.f = { DocumentManager, FileController, RecoveryController, Transaction, createApp, nextTick, RecoveryDialog }
</script>`)
fs.writeFileSync(`${output}/live.html`, `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:720px"></div><script type="module">
import '/scripts/fixtures/markdown-live-controller.js'
import { RecoveryController } from '/src/features/recovery/RecoveryController.ts'
window.RecoveryController = RecoveryController
</script>`)

const server = await createServer({ server: { host: '127.0.0.1', port: 1484, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:1484/test-results/phase07/recovery/index.html')
  await page.waitForFunction(() => window.f)
  const result = await page.evaluate(async () => {
    const f = window.f
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const random = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
    class RecoveryTransport {
      constructor() { this.records = new Map(); this.calls = []; this.removed = []; this.warnings = []; this.fail = false; this.lastId = '' }
      summary(record) {
        return { id: record.id, name: record.name, path: record.path, updatedAt: record.updatedAt, charCount: record.charCount,
          sizeBytes: record.text.length, mode: record.mode, panes: record.panes, diskExists: !!record.path && record.diskExists !== false,
          diskChanged: !!record.diskChanged }
      }
      async list() { return { records: [...this.records.values()].map(record => this.summary(record)), warnings: this.warnings } }
      async read(id) { const record = this.records.get(id); if (!record) throw Error('missing recovery'); return { ...record } }
      async save(input) {
        this.calls.push({ ...input, panes: input.panes.map(pane => ({ ...pane })) })
        if (this.fail) throw Error('injected recovery write failure')
        const id = input.id || random()
        const record = { ...input, id, schemaVersion: 1, updatedAt: Date.now(), charCount: input.text.length, checksum: 'test',
          diskVersion: input.diskVersion, diskSize: null, diskModifiedNs: null }
        this.records.set(id, record); this.lastId = id
        return { record: this.summary(record), warnings: [] }
      }
      async remove(id) { this.removed.push(id); this.records.delete(id) }
    }
    const fileMeta = { token: 'tok-1', name: 'note.txt', path: 'E:/fixture/note.txt', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: 'v1' }
    function fileGateway(options = {}) {
      return {
        release: async () => {},
        saveTarget: async () => ({ token: 'tok-2', path: 'E:/fixture/save.txt', version: null }),
        save: async (token, text, version, encoding, bom) => ({ ...fileMeta, token, text, version: 'v2' }),
        openRecent: async path => {
          if (options.missing) throw Error('injected missing file')
          return { ...fileMeta, path, text: options.diskText ?? 'disk text', version: options.version ?? 'v1' }
        },
        preferences: async () => ({ recent: [], layout: { mode: 'single', sidebarVisible: false, sidebarWidth: 240 } }),
      }
    }
    function setup(options = {}) {
      const manager = new f.DocumentManager([], async () => [])
      const transport = new RecoveryTransport()
      transport.warnings = options.warnings || []
      const files = new f.FileController(manager, fileGateway(options.file || {}), () => {})
      const notices = []
      const controller = new f.RecoveryController(manager, files, transport, message => notices.push(message), { debounceMs: 15 })
      files.setSavedHandler(id => controller.onSaved(id))
      return { manager, transport, files, controller, notices }
    }
    const out = {}

    // Debounce/coalesce, dirty-only, path/metadata, panes and untitled.
    {
      const { manager, transport, files, controller } = setup()
      files.accept({ ...fileMeta, text: 'disk' })
      const id = manager.activeId
      await controller.start()
      manager.dispatch(id, { changes: { from: 0, insert: 'A' } })
      manager.dispatch(id, { changes: { from: 0, insert: 'B' } })
      await sleep(60)
      const first = transport.calls.length
      const body = transport.records.get(transport.lastId)?.text
      const untitled = manager.createUntitled('txt')
      manager.dispatch(untitled, { changes: { from: 0, insert: 'draft' } })
      await sleep(60)
      manager.splitPane('right', 'main', id)
      manager.dispatch(id, { changes: { from: 0, insert: 'C' } })
      await sleep(60)
      out.debounce = { first, body, calls: transport.calls.length, lastPanes: transport.calls.at(-1)?.panes.length,
        untitledPath: transport.calls.find(call => call.text === 'draft')?.path,
        detail: transport.calls.map(call => ({ text: call.text, panes: call.panes.length })) }
      await files.save(id)
      await sleep(10)
      out.cleanup = { removed: transport.removed.length, saves: transport.calls.length }
      controller.dispose(); files.dispose(); manager.dispose()
    }

    // Restore existing clean file, dirty doc protection, missing file and diff.
    {
      const { manager, transport, files, controller } = setup({ file: { diskText: 'old disk', version: 'v1' } })
      files.accept({ ...fileMeta, text: 'old disk' })
      const id = 'a'.repeat(32)
      const record = { schemaVersion: 1, id, name: 'note.txt', path: 'E:/fixture/note.txt', text: 'recovery body',
        encoding: 'UTF-8', bom: false, eol: 'LF', mode: 'source', panes: [{ pane: 'main', mode: 'source' }],
        updatedAt: Date.now(), charCount: 13, checksum: 'x', diskVersion: 'v1', diskSize: 8, diskModifiedNs: null }
      transport.records.set(id, record)
      await controller.start()
      const listed = controller.records.value.length
      await controller.showDiff(controller.records.value[0])
      const diff = controller.diff.value?.diskText
      await controller.restore(controller.records.value[0])
      const restored = manager.activeDocument
      out.restoreFile = { listed, diff, text: restored?.path ? manager.getText(restored.id) : '', dirty: restored?.dirty,
        path: restored?.path, records: controller.records.value.length, removed: transport.removed.length }
      controller.dispose(); files.dispose(); manager.dispose()
    }
    {
      const { manager, transport, files, controller } = setup({ file: { missing: true } })
      const id = 'b'.repeat(32)
      transport.records.set(id, { schemaVersion: 1, id, name: 'gone.txt', path: 'E:/fixture/gone.txt', text: 'orphan body',
        encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 11,
        checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null })
      await controller.start()
      await controller.restore(controller.records.value[0])
      const restored = manager.activeDocument
      out.restoreMissing = { path: restored?.path, name: restored?.name, text: restored ? manager.getText(restored.id) : '', dirty: restored?.dirty }
      controller.dispose(); files.dispose(); manager.dispose()
    }
    {
      const { manager, transport, files, controller } = setup()
      files.accept({ ...fileMeta, text: 'disk' })
      const id = manager.activeId
      manager.dispatch(id, { changes: { from: 0, insert: 'user edit' } })
      const rid = 'c'.repeat(32)
      transport.records.set(rid, { schemaVersion: 1, id: rid, name: 'note.txt', path: 'E:/fixture/note.txt', text: 'older recovery',
        encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 14,
        checksum: 'x', diskVersion: 'v1', diskSize: 4, diskModifiedNs: null })
      await controller.start()
      await controller.restore(controller.records.value[0] ?? { ...transport.records.get(rid), sizeBytes: 14, diskExists: true, diskChanged: false })
      out.restoreDirtyProtection = { original: manager.getText(id), recovered: manager.openedDocuments.filter(doc => doc.id !== id).map(doc => manager.getText(doc.id)) }
      controller.dispose(); files.dispose(); manager.dispose()
    }
    {
      const { manager, transport, controller } = setup()
      await controller.start()
      const source = ['# Recovered', '', '```js', 'const n = 1', '```', '', '![alt](./image.png)', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '$$', 'x^2', '$$', '', '```mermaid', 'graph TD', 'A-->B', '```', ''].join('\n')
      const md = manager.createUntitled('md')
      manager.dispatch(md, { changes: { from: 0, insert: source } })
      await sleep(60)
      const record = [...transport.records.values()].find(item => item.text === source)
      out.markdown = { exact: record?.text === source, mode: record?.mode, name: record?.name, panes: record?.panes?.length }
      controller.dispose(); manager.dispose()
    }
    {
      const { manager, transport, controller } = setup()
      await controller.start()
      const id = manager.createUntitled('txt')
      manager.dispatch(id, { changes: { from: 0, insert: 'quick close' } })
      const before = transport.calls.length
      await controller.flushForClose()
      out.quickClose = { before, after: transport.calls.length, body: transport.calls.at(-1)?.text }
      controller.dispose(); manager.dispose()
    }
    {
      const { manager, transport, controller } = setup()
      const records = [
        { id: 'e'.repeat(32), name: 'one.txt', path: null, text: 'first recovered', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 15, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null },
        { id: 'f'.repeat(32), name: 'two.txt', path: null, text: 'second recovered', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 16, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null },
      ]
      for (const record of records) transport.records.set(record.id, record)
      await controller.start()
      await controller.restoreAll()
      out.multi = manager.openedDocuments.map(doc => manager.getText(doc.id)).sort()
      controller.dispose(); manager.dispose()
    }
    {
      const { manager, transport, controller } = setup()
      const id = '9'.repeat(32)
      transport.records.set(id, { schemaVersion: 1, id, name: 'discard.txt', path: null, text: 'discard me', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 10, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null })
      await controller.start()
      const before = controller.records.value.length
      controller.close()
      await controller.open()
      const reopened = controller.records.value.length
      await controller.discard(controller.records.value[0])
      out.discard = { before, reopened, after: controller.records.value.length, removed: transport.removed.includes(id) }
      controller.dispose(); manager.dispose()
    }
    {
      const { manager, transport, controller } = setup()
      for (const id of ['7'.repeat(32), '8'.repeat(32)]) transport.records.set(id, { schemaVersion: 1, id, name: 'drop.txt', path: null, text: 'drop', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 4, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null })
      await controller.start()
      await controller.discardAll()
      out.discardAll = { records: controller.records.value.length, removed: ['7'.repeat(32), '8'.repeat(32)].every(id => transport.removed.includes(id)) }
      controller.dispose(); manager.dispose()
    }

    // Failure is explicit; a later visit keeps records.
    {
      const { manager, transport, controller } = setup()
      transport.fail = true
      const id = manager.createUntitled('txt')
      await controller.start()
      manager.dispatch(id, { changes: { from: 0, insert: 'will fail' } })
      await controller.flushForClose()
      const error = controller.lastError.value
      transport.fail = false
      await controller.open()
      out.failure = { error, visible: controller.visible.value, calls: transport.calls.length }
      controller.dispose(); manager.dispose()
    }

    // RecoveryDialog renders independently; close must not imply deletion.
    {
      const records = [{ id: 'd'.repeat(32), name: 'recover.md', path: 'E:/fixture/recover.md', updatedAt: Date.now(), charCount: 12,
        sizeBytes: 12, mode: 'live', panes: [], diskExists: true, diskChanged: true }]
      let closed = 0
      const app = f.createApp(f.RecoveryDialog, { visible: true, records, busy: false, diff: null, error: null, onClose: () => closed++ })
      app.mount('#app')
      await f.nextTick()
      const text = document.querySelector('.recovery-dialog')?.textContent || ''
      const closeButton = [...document.querySelectorAll('.recovery-dialog button')].find(button => button.textContent?.includes('暂不处理'))
      closeButton?.click()
      out.dialog = { rendered: text.includes('recover.md'), close: closed, disk: text.includes('磁盘内容已变化') }
      app.unmount()
    }

    return out
  })
  assert.deepEqual(result.debounce.first, 1)
  assert.equal(result.debounce.body, 'BAdisk')
  assert.equal(result.debounce.calls, 3)
  assert.equal(result.debounce.lastPanes, 2)
  assert.equal(result.debounce.untitledPath, null)
  assert.equal(result.cleanup.removed, 1)
  assert.deepEqual(result.restoreFile, { listed: 1, diff: 'old disk', text: 'recovery body', dirty: true, path: 'E:/fixture/note.txt', records: 0, removed: 0 })
  assert.deepEqual(result.restoreMissing, { path: '', name: 'gone.txt', text: 'orphan body', dirty: true })
  assert.equal(result.restoreDirtyProtection.original, 'user editdisk')
  assert.deepEqual(result.restoreDirtyProtection.recovered, ['older recovery'])
  assert.deepEqual(result.markdown, { exact: true, mode: 'live', name: 'Untitled-1.md', panes: 1 })
  assert.deepEqual(result.multi, ['first recovered', 'second recovered'])
  assert.deepEqual(result.quickClose, { before: 0, after: 1, body: 'quick close' })
  assert.deepEqual(result.discard, { before: 1, reopened: 1, after: 0, removed: true })
  assert.deepEqual(result.discardAll, { records: 0, removed: true })
  assert(result.failure.error.includes('injected recovery write failure'))
  assert.equal(result.failure.visible, true)
  assert.deepEqual(result.dialog, { rendered: true, close: 1, disk: true })

  const livePage = await browser.newPage()
  livePage.on('pageerror', error => errors.push(error.message))
  await livePage.goto('http://127.0.0.1:1484/test-results/phase07/recovery/live.html')
  await livePage.waitForFunction(() => window.f?.ready && window.RecoveryController)
  const liveResult = await livePage.evaluate(async () => {
    const f = window.f
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const source = ['# Live recovery', '', 'Paragraph target.', '', '```js', 'const n = 1', '```', '', '![alt](./image.png)', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '$$', 'x^2', '$$', '', '```mermaid', 'graph TD', 'A-->B', '```', ''].join('\n')
    f.reset(source)
    for (let i = 0; i < 100 && !f.live(); i++) await sleep(20)
    await sleep(30)
    const transport = { records: new Map(), next: 1,
      async list() { return { records: [...this.records.values()].map(record => ({ id: record.id, name: record.name, path: record.path, updatedAt: record.updatedAt, charCount: record.charCount, sizeBytes: record.text.length, mode: record.mode, panes: record.panes, diskExists: false, diskChanged: false })), warnings: [] } },
      async read(id) { return { ...this.records.get(id) } },
      async save(input) {
        const id = input.id || ('a'.repeat(31) + this.next++)
        const record = { ...input, id, schemaVersion: 1, updatedAt: Date.now(), charCount: input.text.length, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null }
        this.records.set(id, record)
        return { record: { ...record, sizeBytes: record.text.length, diskExists: false, diskChanged: false }, warnings: [] }
      },
      async remove(id) { this.records.delete(id) } }
    const controller = new window.RecoveryController(f.manager, { recent: async () => {} }, transport, () => {}, { debounceMs: 15 })
    await controller.start()
    f.caret('Paragraph target.')
    f.insert(' EDIT')
    await sleep(80)
    const record = [...transport.records.values()][0]
    const edited = f.source()
    const summary = { id: record.id, name: record.name, path: record.path, updatedAt: record.updatedAt, charCount: record.charCount,
      sizeBytes: record.text.length, mode: record.mode, panes: record.panes, diskExists: false, diskChanged: false }
    await controller.restore(summary)
    await sleep(50)
    const recovered = f.manager.openedDocuments.find(doc => doc.id.startsWith('recovered-'))
    const result = { recordText: record.text, edited, recoveredText: recovered ? f.manager.getText(recovered.id) : '', mode: recovered ? f.manager.getMarkdownMode(recovered.id) : null, dirty: recovered?.dirty }
    controller.dispose()
    return { source, ...result, hasCode: result.recoveredText.includes('```js'), hasImage: result.recoveredText.includes('(./image.png)'), hasTable: result.recoveredText.includes('| 1 | 2 |'), hasMath: result.recoveredText.includes('x^2'), hasMermaid: result.recoveredText.includes('A-->B') }
  })
  assert.equal(liveResult.recordText, liveResult.edited)
  assert.equal(liveResult.recoveredText, liveResult.edited)
  assert.equal(liveResult.mode, 'live')
  assert.equal(liveResult.dirty, true)
  assert(liveResult.hasCode && liveResult.hasImage && liveResult.hasTable && liveResult.hasMath && liveResult.hasMermaid)
  assert.deepEqual(errors, [])
  console.log('PASS real Markdown Live edit -> raw Markdown snapshot -> recovered Live draft preserves code/image/table/math/Mermaid')
  await livePage.close()
  console.log('PASS recovery debounce, dirty-only snapshots, multi-pane dedup, save cleanup, file/missing/dirty restore, failure and dialog')
} finally {
  await browser?.close()
  await server.close()
}
