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
    const ok = (value, message = 'assertion failed') => { if (!value) throw Error(message) }
    const random = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
    class RecoveryTransport {
      constructor() { this.records = new Map(); this.calls = []; this.removed = []; this.warnings = []; this.fail = false; this.removeFail = false; this.lastId = ''; this.versions = new Map(); this.sequence = 0 }
      summary(record) {
        return { id: record.id, name: record.name, path: record.path, updatedAt: record.updatedAt, charCount: record.charCount,
          sizeBytes: record.text.length, mode: record.mode, panes: record.panes, diskExists: !!record.path && record.diskExists !== false,
          diskChanged: !!record.diskChanged }
      }
      async list() { return { records: [...this.records.values()].map(record => this.summary(record)), warnings: this.warnings } }
      async read(id) { const record = this.records.get(id); if (!record) throw Error('missing recovery'); return { ...record, version: this.versions.get(id) || 'seed' } }
      async save(input) {
        this.calls.push({ ...input, panes: input.panes.map(pane => ({ ...pane })) })
        if (this.fail) throw Error('injected recovery write failure')
        const id = input.id || random()
        const record = { ...input, id, schemaVersion: 1, updatedAt: Date.now(), charCount: input.text.length, checksum: 'test',
          diskVersion: input.diskVersion, diskSize: null, diskModifiedNs: null }
        this.records.set(id, record); this.lastId = id
        const version = `v${++this.sequence}:${input.text.length}`
        this.versions.set(id, version)
        return { record: this.summary(record), warnings: [], version }
      }
      async remove(id) { this.removed.push(id); if (this.removeFail) throw Error('injected remove failure'); this.records.delete(id); this.versions.delete(id) }
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
    function setup(options = {}, sharedTransport = null) {
      const manager = new f.DocumentManager([], async () => [])
      const transport = sharedTransport || new RecoveryTransport()
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
      const transport = new RecoveryTransport()
      const untouched = ['7'.repeat(32), '8'.repeat(32)]
      for (const id of untouched) transport.records.set(id, { schemaVersion: 1, id, name: 'drop.txt', path: null, text: 'drop', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 4, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null })
      const { manager, files, controller } = setup({}, transport)
      try {
        await controller.start()
        const doc = manager.createUntitled('txt')
        manager.dispatch(doc, { changes: { from: 0, insert: 'active draft' } })
        await sleep(60)
        const active = [...transport.records.values()].find(record => record.text === 'active draft')
        ok(active, 'active snapshot missing')
        const before = controller.records.value.length
        await controller.discardAll()
        out.discardAll = { before, unclaimed: untouched.every(id => transport.records.has(id)),
          activeRemoved: !transport.records.has(active.id), listed: controller.records.value.length }
      } finally { controller.dispose(); files.dispose(); manager.dispose() }
    }

    // Lifecycle A: choosing "later" keeps an unclaimed draft. Saving the
    // original file afterwards must not delete it, and a restart finds it.
    {
      const transport = new RecoveryTransport()
      let draftId = ''
      {
        const { manager, files, controller } = setup({ file: { diskText: 'A', version: 'v1' } }, transport)
        files.accept({ ...fileMeta, text: 'A' })
        const id = manager.activeId
        await controller.start()
        manager.dispatch(id, { changes: { from: 0, insert: 'B' } })
        await sleep(80)
        const record = [...transport.records.values()].find(item => item.text === 'BA')
        ok(record, 'dirty snapshot was not written')
        draftId = record.id
        // Abrupt stop: no discard/cleanup path runs.
        controller.dispose(); files.dispose(); manager.dispose()
      }
      {
        const { manager, files, controller } = setup({ file: { diskText: 'A', version: 'v1' } }, transport)
        files.accept({ ...fileMeta, text: 'A' })
        const id = manager.activeId
        await controller.start()
        ok(controller.records.value.some(record => record.id === draftId), 'unclaimed draft missing from the list')
        controller.close()
        manager.dispatch(id, { changes: { from: 0, insert: 'C' } })
        await sleep(80)
        ok(await files.save(id), 'ordinary save failed')
        await sleep(20)
        ok(transport.records.has(draftId), 'ordinary save deleted the unclaimed recovery draft')
        await controller.open()
        ok(controller.records.value.some(record => record.id === draftId), 'unclaimed draft not listed after save')
        const samePath = [...transport.records.values()].filter(item => item.path === 'E:/fixture/note.txt')
        out.defer = { listedAfterSave: samePath.some(item => item.text === 'BA'), activeRemoved: samePath.every(item => item.id === draftId) }
        controller.dispose(); files.dispose(); manager.dispose()
      }
      {
        const session = setup({}, transport)
        try {
          await session.controller.start()
          ok(session.transport.records.has(draftId), 'unclaimed draft vanished after a restart')
          ok((await session.transport.read(draftId)).text === 'BA', 'unclaimed draft content changed')
          out.deferRestart = session.controller.records.value.some(record => record.id === draftId)
        } finally { session.controller.dispose(); session.manager.dispose() }
      }
    }

    // Lifecycle B: an explicitly recovered draft keeps updating in place, and
    // the newest text is what a later restart offers.
    {
      const transport = new RecoveryTransport()
      const id = 'bc'.repeat(16)
      transport.records.set(id, { schemaVersion: 1, id, name: 'recovered.txt', path: null, text: 'B', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 1, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null })
      transport.versions.set(id, 'seed-b')
      {
        const { manager, files, controller } = setup({}, transport)
        await controller.start()
        ok(await controller.restore(controller.records.value.find(record => record.id === id)), 'restore failed')
        const doc = manager.openedDocuments.find(item => item.id.startsWith('recovered-'))
        ok(doc, 'restored draft missing')
        const versionAfterRestore = transport.versions.get(id)
        manager.dispatch(doc.id, { changes: { from: manager.getState(doc.id).doc.length, insert: 'D' } })
        await sleep(80)
        const last = [...transport.calls].filter(call => call.id === id).at(-1)
        out.recoveredUpdate = { text: transport.records.get(id)?.text, expectedVersion: last?.expectedVersion, restoreVersion: versionAfterRestore }
        ok(transport.records.get(id)?.text === 'BD', 'recovered draft was not updated in place')
        controller.dispose(); files.dispose(); manager.dispose()
      }
      {
        const { manager, controller } = setup({}, transport)
        try {
          await controller.start()
          const summary = controller.records.value.find(record => record.id === id)
          ok(summary, 'updated recovered draft missing after restart')
          await controller.restore(summary)
          out.recoveredRestart = manager.openedDocuments.some(doc => manager.getText(doc.id) === 'BD')
        } finally { controller.dispose(); manager.dispose() }
      }
    }

    // Lifecycle C: a safe save cleans only the snapshot of that document. A
    // different unclaimed draft for the same path is left alone.
    {
      const transport = new RecoveryTransport()
      const restored = 'cd'.repeat(16), untouched = 'ce'.repeat(16)
      const path = 'E:/fixture/note.txt'
      for (const [id, text] of [[restored, 'B'], [untouched, 'keep me']]) {
        transport.records.set(id, { schemaVersion: 1, id, name: 'note.txt', path, text, encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: text.length, checksum: 'x', diskVersion: 'v1', diskSize: 1, diskModifiedNs: null, diskExists: true })
        transport.versions.set(id, `seed-${id}`)
      }
      const { manager, files, controller } = setup({ file: { diskText: 'A', version: 'v1' } }, transport)
      try {
        files.accept({ ...fileMeta, text: 'A' })
        const documentId = manager.activeId
        await controller.start()
        ok(controller.records.value.length === 2, 'both same-path drafts must be listed')
        ok(await controller.restore(controller.records.value.find(record => record.id === restored)), 'restore failed')
        ok(await files.save(documentId), 'save after restore failed')
        await sleep(20)
        out.cleanupOne = { restoredGone: !transport.records.has(restored), unrelatedKept: transport.records.has(untouched), listed: controller.records.value.length }
      } finally { controller.dispose(); files.dispose(); manager.dispose() }
    }

    // Lifecycle C2: a failed cleanup is surfaced and leaves the record on disk
    // (not falsely deleted), so it can be listed and discarded on retry.
    {
      const transport = new RecoveryTransport()
      const id = 'cf'.repeat(16)
      const path = 'E:/fixture/note.txt'
      transport.records.set(id, { schemaVersion: 1, id, name: 'note.txt', path, text: 'B', encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: 1, checksum: 'x', diskVersion: 'v1', diskSize: 1, diskModifiedNs: null, diskExists: true })
      transport.versions.set(id, 'seed-cf')
      const { manager, files, controller } = setup({ file: { diskText: 'A', version: 'v1' } }, transport)
      try {
        files.accept({ ...fileMeta, text: 'A' })
        const documentId = manager.activeId
        await controller.start()
        ok(await controller.restore(controller.records.value.find(record => record.id === id)), 'restore failed')
        transport.removeFail = true
        ok(await files.save(documentId), 'save itself must still succeed')
        await sleep(20)
        const error = controller.lastError.value || ''
        const keptAfterFailure = transport.records.has(id)
        ok(keptAfterFailure, 'failed cleanup must not fake deletion')
        ok(error.includes('injected remove failure'), 'cleanup failure was not surfaced')
        transport.removeFail = false
        await controller.open()
        const listed = controller.records.value.some(record => record.id === id)
        await controller.discard(controller.records.value.find(record => record.id === id))
        out.cleanupFailure = { keptAfterFailure, listed, discarded: !transport.records.has(id), error: error.includes('清理恢复快照失败') }
      } finally { controller.dispose(); files.dispose(); manager.dispose() }
    }

    // Lifecycle D: several same-path records, multiple panes and untitled
    // drafts never share or cross-delete a recovery identity.
    {
      const transport = new RecoveryTransport()
      const path = 'E:/fixture/note.txt'
      const ids = { one: 'da'.repeat(16), two: 'db'.repeat(16), three: 'dc'.repeat(16) }
      for (const [id, name, text, recordPath] of [[ids.one, 'one.txt', 'draft one', path], [ids.two, 'two.txt', 'draft two', path], [ids.three, 'three.txt', 'draft three', null]]) {
        transport.records.set(id, { schemaVersion: 1, id, name, path: recordPath, text, encoding: 'UTF-8', bom: false, eol: 'LF', mode: null, panes: [], updatedAt: Date.now(), charCount: text.length, checksum: 'x', diskVersion: recordPath ? 'v1' : null, diskSize: 5, diskModifiedNs: null, diskExists: !!recordPath })
        transport.versions.set(id, `seed-${id}`)
      }
      const { manager, files, controller } = setup({ file: { diskText: 'disk', version: 'v1' } }, transport)
      try {
        files.accept({ ...fileMeta, text: 'disk' })
        const documentId = manager.activeId
        manager.splitPane('right', 'main', documentId)
        await controller.start()
        ok(controller.records.value.length === 3, 'same-path records were auto-claimed')
        manager.dispatch(documentId, { changes: { from: 0, insert: 'local ' } })
        await sleep(80)
        const active = [...transport.records.values()].find(record => record.path === path && record.text === 'local disk')
        ok(active, 'active snapshot missing')
        ok(active.panes.length === 2, 'one document must own one snapshot for both panes')
        ok(transport.records.size === 4, 'active snapshot replaced an unclaimed draft')
        await controller.discard(controller.records.value.find(record => record.id === ids.one))
        ok(!transport.records.has(ids.one), 'explicit discard did not remove its target')
        ok(transport.records.has(ids.two) && transport.records.has(ids.three), 'explicit discard removed unrelated drafts')
        const first = manager.createUntitled('txt')
        manager.dispatch(first, { changes: { from: 0, insert: 'untitled one' } })
        await sleep(60)
        const second = manager.createUntitled('txt')
        manager.dispatch(second, { changes: { from: 0, insert: 'untitled two' } })
        await sleep(60)
        const untitled = [...transport.records.values()].filter(record => record.text === 'untitled one' || record.text === 'untitled two').map(record => record.id)
        ok(new Set(untitled).size === 2, 'untitled drafts shared a recovery identity')
        ok(await files.save(documentId, true), 'save-as with multiple records failed')
        await sleep(20)
        ok(!transport.records.has(active.id), 'save-as did not clean only its own active snapshot')
        ok(transport.records.has(ids.two) && transport.records.has(ids.three), 'unclaimed drafts were deleted by save-as')
        out.multiRecord = { listed: controller.records.value.length, activePanes: active.panes.length }
      } finally { controller.dispose(); files.dispose(); manager.dispose() }
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
  assert.deepEqual(result.discardAll, { before: 2, unclaimed: true, activeRemoved: true, listed: 2 })
  assert.deepEqual(result.defer, { listedAfterSave: true, activeRemoved: true })
  assert.equal(result.deferRestart, true)
  assert.equal(result.recoveredUpdate.text, 'BD')
  assert.equal(result.recoveredUpdate.expectedVersion, result.recoveredUpdate.restoreVersion)
  assert.notEqual(result.recoveredUpdate.restoreVersion, 'seed-b')
  assert.equal(result.recoveredRestart, true)
  assert.deepEqual(result.cleanupOne, { restoredGone: true, unrelatedKept: true, listed: 1 })
  assert.deepEqual(result.cleanupFailure, { keptAfterFailure: true, listed: true, discarded: true, error: true })
  assert.deepEqual(result.multiRecord, { listed: 2, activePanes: 2 })
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
    const transport = { records: new Map(), next: 1, version: 1,
      async list() { return { records: [...this.records.values()].map(record => ({ id: record.id, name: record.name, path: record.path, updatedAt: record.updatedAt, charCount: record.charCount, sizeBytes: record.text.length, mode: record.mode, panes: record.panes, diskExists: false, diskChanged: false })), warnings: [] } },
      async read(id) { return { ...this.records.get(id), version: this.records.get(id).version || 'v0' } },
      async save(input) {
        const id = input.id || ('a'.repeat(31) + this.next++)
        const record = { ...input, id, schemaVersion: 1, updatedAt: Date.now(), charCount: input.text.length, checksum: 'x', diskVersion: null, diskSize: null, diskModifiedNs: null, version: `v${this.version++}` }
        this.records.set(id, record)
        return { record: { ...record, sizeBytes: record.text.length, diskExists: false, diskChanged: false }, warnings: [], version: record.version }
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
