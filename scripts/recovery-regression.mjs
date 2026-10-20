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
        if (input.id && !this.records.has(input.id)) throw Error('snapshot deleted; stale update rejected')
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
        saveTarget: async () => options.cancelTarget ? null : ({ token: 'tok-2', path: 'E:/fixture/save.txt', version: null }),
        save: async (token, text, version, encoding, bom) => {
          options.saved?.push({ token, text, version })
          return { ...fileMeta, path: token === 'tok-2' ? 'E:/fixture/save.txt' : fileMeta.path, token, text, version: 'v2' }
        },
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

    // P0 ownership tests. This transport controls frontend timing/failures;
    // actual conditional atomic replacement is tested in Rust and WebView2.
    {
      const check = (value, message) => { if (!value) throw Error(message) }
      const { manager, transport, files, controller } = setup()
      const seed = (id, text, path = fileMeta.path) => ({ schemaVersion: 1, id, name: 'note.txt', path, text,
        encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [{ pane: 'main', mode: null }],
        updatedAt: Date.now(), charCount: text.length, checksum: 'test', diskVersion: 'v1', diskSize: 4, diskModifiedNs: null })
      const a = '1'.repeat(32), sibling = '2'.repeat(32), other = '3'.repeat(32)
      transport.records.set(a, seed(a, 'unclaimed A'))
      transport.records.set(sibling, seed(sibling, 'same path sibling'))
      transport.records.set(other, seed(other, 'other file', 'E:/fixture/other.txt'))
      files.accept({ ...fileMeta, text: 'disk' })
      const doc = manager.activeId
      manager.splitPane('right', 'main', doc)
      await controller.start()
      controller.close() // The user chooses later.
      manager.dispatch(doc, { changes: { from: 0, to: manager.getState(doc).doc.length, insert: 'saved B' } })
      await controller.flushForClose()
      check([...transport.records.values()].some(record => record.text === 'saved B' && record.id !== a && record.id !== sibling), 'ordinary editing must create its own snapshot')
      check(await files.save(doc), 'original save must succeed')
      await controller.open()
      check(transport.records.get(a)?.text === 'unclaimed A', 'later + ordinary save deleted unclaimed A')
      check(controller.records.value.length === 3 && transport.records.size === 3, 'same path/multi-pane ownership leaked')
      await controller.discardActive() // Window discard must not mean discard all old recoveries.
      check(transport.records.size === 3, 'window discard removed unclaimed records')
      controller.dispose(); files.dispose(); manager.dispose()

      // New controller and manager model restart; persistent store is retained.
      const restarted = new f.DocumentManager([], async () => [])
      const restartedFiles = new f.FileController(restarted, fileGateway(), () => {})
      const c = new f.RecoveryController(restarted, restartedFiles, transport, () => {}, { debounceMs: 15 })
      restartedFiles.setSavedHandler(id => c.onSaved(id))
      await c.start()
      check(c.records.value.some(record => record.id === a), 'unclaimed A lost after restart')
      await c.discard(c.records.value.find(record => record.id === a))
      check(!transport.records.has(a) && transport.records.size === 2, 'explicit discard must delete exactly A')

      // Explicit claim of one same-path record must not claim its sibling.
      check(await c.restore(c.records.value.find(record => record.id === sibling)), 'explicit restore failed')
      const restored = restarted.activeId
      restarted.splitPane('right', 'main', restored)
      restarted.dispatch(restored, { changes: { from: 0, insert: 'continued ' } })
      await c.flushForClose()
      check(transport.records.get(sibling)?.text === 'continued same path sibling', 'restored edits did not update exact body under same ID')
      check(await restartedFiles.save(restored), 'restored file save failed')
      check(!transport.records.has(sibling) && transport.records.get(other)?.text === 'other file', 'successful save cleaned an unrelated snapshot')
      c.dispose(); restartedFiles.dispose(); restarted.dispose()
      out.unclaimedSafety = true
    }
    {
      const check = (value, message) => { if (!value) throw Error(message) }
      const fileOptions = { version: 'v2', diskText: 'external B', cancelTarget: true, saved: [] }
      const { manager, transport, files, controller } = setup({ file: fileOptions })
      const id = '4'.repeat(32)
      transport.records.set(id, { schemaVersion: 1, id, name: 'note.txt', path: fileMeta.path, text: 'old recovery A',
        encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 14,
        checksum: 'test', diskVersion: 'v1', diskSize: 4, diskModifiedNs: null })
      await controller.start()
      const summary = controller.records.value[0]
      transport.fail = true
      check(!(await controller.restore(summary)), 'failed snapshot refresh falsely reported restore success')
      check(controller.lastError.value?.includes('快照更新未成功') && controller.lastError.value.includes('injected recovery write failure'), 'restore write failure not accurately surfaced')
      check(transport.records.get(id)?.text === 'old recovery A', 'failed refresh corrupted last valid body')
      const draft = manager.activeDocument
      check(!draft.path && !draft.fileToken && draft.dirty, 'changed original must restore to pathless draft')
      const original = manager.openedDocuments.find(doc => doc.path)
      check(manager.getText(original.id) === 'external B' && !original.dirty, 'restore overwrote newer original')
      manager.dispatch(draft.id, { changes: { from: 0, insert: 'newer ' } })
      transport.fail = false
      const count = manager.openedDocuments.length
      check(await controller.restore(summary), 'retry did not persist recovered buffer')
      check(manager.openedDocuments.length === count && transport.records.get(id)?.text === 'newer old recovery A', 'retry reapplied stale body or duplicated document')
      check(transport.records.get(id)?.path === null, 'refreshed pathless recovery retained dangerous original association')
      await controller.open()
      check(controller.records.value.length === 0, 'successfully active snapshot still shown as unclaimed')
      check(!(await files.save(draft.id)) && fileOptions.saved.length === 0 && transport.records.has(id), 'ordinary save must require a chosen target and retain recovery on cancellation')
      fileOptions.cancelTarget = false
      await files.save(draft.id) // Save As gateway chooses a different path.
      check(fileOptions.saved.length === 1 && fileOptions.saved[0].token === 'tok-2', 'pathless draft bypassed Save As')
      check(manager.getText(original.id) === 'external B' && !transport.records.has(id), 'Save As cleanup corrupted original or leaked recovery')
      controller.dispose(); files.dispose(); manager.dispose()
      out.restoreFailureAndExternalSafety = true
    }

    {
      const { manager, transport, controller } = setup()
      await controller.start()
      const doc = manager.createUntitled('txt')
      manager.dispatch(doc, { changes: { from: 0, insert: 'A' } })
      await controller.flushForClose()
      const id = transport.lastId
      const save = transport.save.bind(transport)
      let entered, release
      const started = new Promise(resolve => { entered = resolve })
      const gate = new Promise(resolve => { release = resolve })
      let first = true
      transport.save = async input => {
        if (first) { first = false; entered(); await gate; throw Error('in-flight B failed') }
        return save(input)
      }
      manager.dispatch(doc, { changes: { from: 0, to: 1, insert: 'B' } })
      const flushing = controller.flushForClose()
      await started
      manager.dispatch(doc, { changes: { from: 0, to: 1, insert: 'C' } })
      release()
      await flushing
      if (transport.records.get(id)?.text !== 'A') throw Error('failed B changed previous valid A')
      await controller.flushForClose()
      if (transport.records.get(id)?.text !== 'C' || transport.records.size !== 1) throw Error('failed in-flight B dropped newer queued C')
      controller.dispose(); manager.dispose()
      out.queuedEditAfterFailure = true
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
  assert.equal(result.unclaimedSafety, true)
  assert.equal(result.restoreFailureAndExternalSafety, true)
  assert.equal(result.queuedEditAfterFailure, true)
  console.log('PASS later + original save + restart retain unclaimed drafts; exact-ID cleanup, restore failure/retry and changed-original Save As protection')

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
    let controller = new window.RecoveryController(f.manager, { recent: async () => {} }, transport, () => {}, { debounceMs: 15 })
    await controller.start()
    f.caret('Paragraph target.')
    f.insert(' EDIT')
    await sleep(80)
    const record = [...transport.records.values()][0]
    const edited = f.source()
    const summary = { id: record.id, name: record.name, path: record.path, updatedAt: record.updatedAt, charCount: record.charCount,
      sizeBytes: record.text.length, mode: record.mode, panes: record.panes, diskExists: false, diskChanged: false }
    // Simulate a new recovery session. An already active snapshot is owned by
    // its current document and must never be restored into a duplicate buffer.
    controller.dispose()
    f.manager.close(f.id, true)
    controller = new window.RecoveryController(f.manager, { recent: async () => {} }, transport, () => {}, { debounceMs: 15 })
    await controller.start()
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
