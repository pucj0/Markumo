import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(
  process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright'
)

const output = 'test-results/document-manager'
fs.mkdirSync(output, { recursive: true })

fs.writeFileSync(
  `${output}/index.html`,
  '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><div id="mount-main"></div><div id="mount-secondary"></div><script type="module" src="./fixture.js"></script>',
)

fs.writeFileSync(
  `${output}/fixture.js`,
  `
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import { EditorState, EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { sameFilePath } from '/src/features/files/pathKey.ts';

window.f = {
  DocumentManager,
  EditorState,
  EditorSelection,
  Transaction,
  isolateHistory,
  sameFilePath,
  createManager(seeds = [], customLoader) {
    return new DocumentManager(seeds, customLoader);
  }
};
`,
)

const port = Number(process.env.MARKUMO_TEST_PORT || 1446)
const server = await createServer({
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
})
await server.listen()

let browser
const results = []
const errors = []

try {
  browser = await chromium.launch({
    executablePath: process.env.MARKUMO_CHROME,
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', err => errors.push(err.message))

  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(() => window.f?.DocumentManager)

  const test = async (name, fn) => {
    try {
      await fn()
      results.push(name)
      console.log('PASS ' + name)
    } catch (e) {
      console.error('FAIL ' + name, e)
      throw e
    }
  }

  // =========================================================================
  // Section A: 文档状态与身份 (Document State & Identity)
  // =========================================================================

  await test('A1. Single authoritative EditorState: createUntitled has exactly one state and stable id', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const id = dm.createUntitled('txt')
      const state1 = dm.getState(id)
      const text1 = dm.getText(id)

      // Make an edit
      dm.dispatch(id, { changes: { from: 0, insert: 'Hello World' } })
      const state2 = dm.getState(id)
      const text2 = dm.getText(id)

      const meta = dm.metadata(id)
      return {
        idMatches: id.startsWith('untitled-'),
        text1,
        text2,
        isSameDocLength: state2.doc.length === 11,
        charCountMatches: meta.charCount === 11,
      }
    })

    assert.equal(res.idMatches, true)
    assert.equal(res.text1, '')
    assert.equal(res.text2, 'Hello World')
    assert.equal(res.isSameDocLength, true)
    assert.equal(res.charCountMatches, true)
  })

  await test('A2. Reopening existing path: never duplicates record, never overwrites unsaved edits or undo history', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const file = {
        token: 'tok-file-1',
        name: 'test.md',
        path: 'C:/docs/test.md',
        text: 'Initial text',
        version: 'v1',
      }

      // First open
      const id1 = dm.openFile(file)
      dm.dispatch(id1, { changes: { from: 12, insert: ' with modifications' } })
      const editedText = dm.getText(id1)
      const isDirty = dm.metadata(id1).dirty

      // Second open with same path (simulating shell reopen or tab click)
      const fileSpelling2 = {
        token: 'tok-file-2',
        name: 'test.md',
        path: 'c:\\docs\\test.md', // different case and separators
        text: 'Initial text (from disk)',
        version: 'v1',
      }
      const id2 = dm.openFile(fileSpelling2)
      const afterSecondOpenText = dm.getText(id1)
      const isStillDirty = dm.metadata(id1).dirty

      // Undo history should still be intact: undoing should revert to initial text
      dm.command('undo')
      const undidText = dm.getText(id1)

      return {
        id1,
        id2,
        sameId: id1 === id2,
        editedText,
        afterSecondOpenText,
        isDirty,
        isStillDirty,
        undidText,
      }
    })

    assert.equal(res.sameId, true, 'Reopening must return same document ID')
    assert.equal(res.afterSecondOpenText, 'Initial text with modifications', 'Unsaved edits must not be overwritten')
    assert.equal(res.isStillDirty, true, 'Dirty state must not be cleared on reopen')
    assert.equal(res.undidText, 'Initial text', 'Undo history must survive reopening')
  })

  await test('A3. Multi-pane sharing & reference counting: closing one pane does not release document until last reference', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      let releasedTokens = []
      dm.onFileRelease(token => releasedTokens.push(token))

      const file = { token: 'tok-ref-1', name: 'shared.txt', path: '/docs/shared.txt', text: 'Shared content' }
      const id = dm.openFile(file, false, 'main')

      // Split into secondary pane with same document
      const pane2 = dm.splitPane('right', 'main', id)

      // Edit in main pane
      dm.dispatch(id, { changes: { from: 0, insert: '[Edited] ' } })
      const textInMain = dm.getText(id)

      // Close primary pane tab
      const closeResult1 = dm.close(id, false, 'main')
      const existsAfterFirstClose = dm.getState(id) !== undefined
      const tokensAfterFirstClose = [...releasedTokens]

      // Close secondary pane tab (last reference)
      const closeResult2 = dm.close(id, true, pane2)
      const existsAfterSecondClose = dm.getState(id) !== undefined
      const tokensAfterSecondClose = [...releasedTokens]

      return {
        textInMain,
        closeResult1,
        existsAfterFirstClose,
        tokensAfterFirstClose,
        closeResult2,
        existsAfterSecondClose,
        tokensAfterSecondClose,
      }
    })

    assert.equal(res.textInMain, '[Edited] Shared content')
    assert.equal(res.closeResult1, 'closed')
    assert.equal(res.existsAfterFirstClose, true, 'Document must not be released while referenced in secondary pane')
    assert.deepEqual(res.tokensAfterFirstClose, [])

    assert.equal(res.closeResult2, 'closed')
    assert.equal(res.existsAfterSecondClose, false, 'Document must be released when last reference closes')
    assert.deepEqual(res.tokensAfterSecondClose, ['tok-ref-1'], 'onFileRelease must fire exactly once on last close')
  })

  // =========================================================================
  // Section B: 保存与脏状态 (Saving & Dirty State Invariants)
  // =========================================================================

  await test('B1. saveSnapshot & complete: dirty becomes false on complete, concurrent edits remain dirty', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const file = { token: 'tok-save-1', name: 'note.md', path: '/docs/note.md', text: 'Original line' }
      const id = dm.openFile(file)

      // 1. Initial clean state
      const initialDirty = dm.metadata(id).dirty

      // 2. Edit -> dirty = true
      dm.dispatch(id, { changes: { from: 13, insert: '\nAppended line' } })
      const dirtyAfterEdit = dm.metadata(id).dirty

      // 3. Take save snapshot
      const snapshot = dm.saveSnapshot(id)
      const snapshotText = snapshot.text

      // 4. Complete save without intervening edits -> dirty = false
      const completeRes1 = snapshot.complete({
        token: 'tok-save-1',
        name: 'note.md',
        path: '/docs/note.md',
        version: 'v2',
        encoding: 'UTF-8',
        eol: 'LF',
        bom: false,
        readOnly: false,
      })
      const dirtyAfterComplete = dm.metadata(id).dirty

      // 5. Concurrent edit scenario:
      // Edit doc, take snapshot, dispatch ANOTHER edit while save is "in flight", then complete.
      dm.dispatch(id, { changes: { from: 0, insert: 'Header\n' } })
      const snapshot2 = dm.saveSnapshot(id)

      // Concurrent edit while saving:
      dm.dispatch(id, { changes: { from: 0, insert: 'CRITICAL CONCURRENT EDIT: ' } })

      // Complete previous snapshot
      const completeRes2 = snapshot2.complete({
        token: 'tok-save-1',
        name: 'note.md',
        path: '/docs/note.md',
        version: 'v3',
        encoding: 'UTF-8',
        eol: 'LF',
        bom: false,
        readOnly: false,
      })

      // The document MUST still be dirty because concurrent edits occurred!
      const dirtyAfterConcurrentComplete = dm.metadata(id).dirty
      const finalDocText = dm.getText(id)

      return {
        initialDirty,
        dirtyAfterEdit,
        snapshotText,
        completeRes1,
        dirtyAfterComplete,
        completeRes2,
        dirtyAfterConcurrentComplete,
        finalDocText,
      }
    })

    assert.equal(res.initialDirty, false)
    assert.equal(res.dirtyAfterEdit, true)
    assert.equal(res.snapshotText, 'Original line\nAppended line')
    assert.equal(res.completeRes1, true)
    assert.equal(res.dirtyAfterComplete, false)

    assert.equal(res.completeRes2, true)
    assert.equal(res.dirtyAfterConcurrentComplete, true, 'Concurrent edits made during save must remain dirty')
    assert.ok(res.finalDocText.startsWith('CRITICAL CONCURRENT EDIT: Header\nOriginal line'))
  })

  await test('B2. CRLF/LF line endings and rename path behavior', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const crlfFile = {
        token: 'tok-crlf-1',
        name: 'windows.txt',
        path: 'C:/docs/windows.txt',
        text: 'Line 1\r\nLine 2\r\nLine 3',
        eol: 'CRLF',
      }
      const id = dm.openFile(crlfFile)
      const metaBefore = dm.metadata(id)
      const snapshot = dm.saveSnapshot(id)

      // Rename file
      const renamed = dm.renamePath('C:/docs/windows.txt', 'C:/docs/renamed.md', 'renamed.md')
      const metaAfter = dm.metadata(id)

      return {
        eolMeta: metaBefore.eol,
        serializedHasCrlf: snapshot.text.includes('\r\n'),
        renamed,
        newPath: metaAfter.path,
        newName: metaAfter.name,
        newMode: metaAfter.mode, // should detect markdown mode
      }
    })

    assert.equal(res.eolMeta, 'CRLF')
    assert.equal(res.serializedHasCrlf, true, 'CRLF line endings must be preserved in snapshot')
    assert.equal(res.renamed, true)
    assert.equal(res.newPath, 'C:/docs/renamed.md')
    assert.equal(res.newName, 'renamed.md')
    assert.equal(res.newMode, 'live', 'Renaming to .md should initialize markdown mode')
  })

  // =========================================================================
  // Section C: 多窗格与模式 (Multi-Pane & Modes Invariants)
  // =========================================================================

  await test('C1. Multi-pane sync: transactions in pane 1 update pane 2 immediately without state fork', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const file = { token: 'tok-sync-1', name: 'sync.txt', path: '/docs/sync.txt', text: 'Alpha' }
      const id = dm.openFile(file, false, 'main')
      const pane2 = dm.splitPane('right', 'main', id)

      // Mount simulated hosts
      const host1 = document.createElement('div')
      const host2 = document.createElement('div')
      document.body.appendChild(host1)
      document.body.appendChild(host2)

      dm.mountPane(host1, 'main')
      dm.mountPane(host2, pane2)

      // Dispatch changes into main pane
      dm.dispatch(id, { changes: { from: 5, insert: ' Beta' } })

      const textInManager = dm.getText(id)
      const view1Text = dm.paneView('main')?.state.doc.toString()
      const view2Text = dm.paneView(pane2)?.state.doc.toString()

      // Clean up DOM hosts
      dm.unmount('main')
      dm.unmount(pane2)
      host1.remove()
      host2.remove()

      return { textInManager, view1Text, view2Text, synced: textInManager === view1Text && view1Text === view2Text }
    })

    assert.equal(res.synced, true)
    assert.equal(res.textInManager, 'Alpha Beta')
  })

  await test('C2. Markdown modes: source, live, split mode switching and IME safety guard', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const file = { token: 'tok-mode-1', name: 'doc.md', path: '/docs/doc.md', text: '# Heading\nContent' }
      const id = dm.openFile(file)

      const initialMode = dm.getMarkdownMode(id)

      // Switch to source
      dm.setMarkdownMode(id, 'source')
      const sourceMode = dm.getMarkdownMode(id)

      // Switch to split
      dm.setMarkdownMode(id, 'split')
      const splitMode = dm.getMarkdownMode(id)

      // Switch to live
      dm.setMarkdownMode(id, 'live')
      const liveMode = dm.getMarkdownMode(id)

      return { initialMode, sourceMode, splitMode, liveMode }
    })

    assert.equal(res.initialMode, 'live')
    assert.equal(res.sourceMode, 'source')
    assert.equal(res.splitMode, 'split')
    assert.equal(res.liveMode, 'live')
  })

  // =========================================================================
  // Section D: 撤销历史与事务 (Undo History & Transactions)
  // =========================================================================

  await test('D1. Undo/redo: logical edits undo cleanly across panes without transaction duplication', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const file = { token: 'tok-hist-1', name: 'hist.txt', path: '/docs/hist.txt', text: 'Step 0' }
      const id = dm.openFile(file, false, 'main')
      const pane2 = dm.splitPane('right', 'main', id)

      // Edit 1
      dm.dispatch(id, { changes: { from: 6, insert: ' -> Step 1' }, annotations: window.f.isolateHistory.of('full') })
      // Edit 2
      dm.dispatch(id, { changes: { from: 16, insert: ' -> Step 2' }, annotations: window.f.isolateHistory.of('full') })
      const edited = dm.getText(id)

      // Switch active pane to secondary, then undo
      dm.focusPane(pane2)
      dm.command('undo')
      const afterUndo1 = dm.getText(id)

      dm.command('undo')
      const afterUndo2 = dm.getText(id)

      // Redo
      dm.command('redo')
      const afterRedo1 = dm.getText(id)

      return { edited, afterUndo1, afterUndo2, afterRedo1 }
    })

    assert.equal(res.edited, 'Step 0 -> Step 1 -> Step 2')
    assert.equal(res.afterUndo1, 'Step 0 -> Step 1')
    assert.equal(res.afterUndo2, 'Step 0')
    assert.equal(res.afterRedo1, 'Step 0 -> Step 1')
  })

  await test('D2. Non-history transactions: configuration effects do not pollute user undo stack', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const file = { token: 'tok-nohist-1', name: 'cfg.txt', path: '/docs/cfg.txt', text: 'User text' }
      const id = dm.openFile(file)

      // User makes an edit
      dm.dispatch(id, { changes: { from: 9, insert: ' edited' } })

      // System reconfigures theme / bracket mode (non-history annotations)
      dm.setBracketMode('rainbow')
      dm.setWrap(true)
      dm.setIndent(2, false)

      // Undo should immediately undo the user edit ' edited', not configuration states
      dm.command('undo')
      const textAfterUndo = dm.getText(id)

      return { textAfterUndo }
    })

    assert.equal(res.textAfterUndo, 'User text', 'Undo must revert user edit without getting stuck on configuration effects')
  })

  // =========================================================================
  // Section E: 异步加载与销毁 (Async Loading & Disposal)
  // =========================================================================

  await test('E1. Language race condition: late response from older language request cannot overwrite newer language', async () => {
    const res = await page.evaluate(async () => {
      let resolveLangA = null
      let resolveLangB = null

      const customLoader = (lang) => {
        if (lang === 'Python') {
          return new Promise(r => { resolveLangA = () => r([]) })
        }
        if (lang === 'Rust') {
          return new Promise(r => { resolveLangB = () => r([]) })
        }
        return Promise.resolve([])
      }

      const dm = window.f.createManager([], customLoader)
      const file = { token: 'tok-lang-1', name: 'code.txt', path: '/docs/code.txt', text: 'code' }
      const id = dm.openFile(file)

      // Request Language A (Python, slow)
      const reqA = dm.setLanguage(id, 'Python')
      const statusA = dm.metadata(id).languageStatus

      // Immediately request Language B (Rust)
      const reqB = dm.setLanguage(id, 'Rust')
      const statusB = dm.metadata(id).languageStatus

      // Now resolve A late
      resolveLangA?.()
      await reqA

      // Language should still be Rust (loading or ready), NOT reverted to Python
      const metaAfterLateA = dm.metadata(id)

      // Now resolve B
      resolveLangB?.()
      await reqB
      const metaAfterB = dm.metadata(id)

      return {
        statusA,
        statusB,
        langAfterLateA: metaAfterLateA.language,
        langAfterB: metaAfterB.language,
        statusAfterB: metaAfterB.languageStatus,
      }
    })

    assert.equal(res.statusA, 'loading')
    assert.equal(res.statusB, 'loading')
    assert.equal(res.langAfterLateA, 'Rust', 'Late language A must not overwrite newer language B')
    assert.equal(res.langAfterB, 'Rust')
    assert.equal(res.statusAfterB, 'ready')
  })

  await test('E2. Disposal: dispose cancels pending resources and leaves no leaked views', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      const id1 = dm.openFile({ token: 't1', name: 'd1.txt', path: '/d1.txt', text: 'Doc 1' })
      const id2 = dm.createUntitled('md')

      dm.dispose()
      // Calling methods on disposed manager should return safely without throwing
      const untitledAfterDispose = dm.createUntitled('txt')
      const openAfterDispose = dm.openFile({ token: 't3', name: 'd3.txt', path: '/d3.txt', text: 'd3' })
      const stateAfterDispose = dm.getState(id1)

      return {
        untitledAfterDispose,
        openAfterDispose,
        stateAfterDispose: stateAfterDispose === undefined,
      }
    })

    assert.equal(res.untitledAfterDispose, null)
    assert.equal(res.openAfterDispose, null)
    assert.equal(res.stateAfterDispose, true)
  })

  // =========================================================================
  // Section F: 媒体文件 (Media Files Invariants)
  // =========================================================================

  await test('F. Media files: images/PDFs have no EditorState, never pollute text records, and maintain view state across panes', async () => {
    const res = await page.evaluate(() => {
      const dm = window.f.createManager()
      let releasedTokens = []
      dm.onFileRelease(token => releasedTokens.push(token))

      const mediaFile = {
        token: 'tok-img-1',
        name: 'sample.png',
        path: '/images/sample.png',
        kind: 'image',
        version: 'v1',
        media: { width: 800, height: 600, format: 'PNG' },
      }

      // 1. Open media file
      const id = dm.openFile(mediaFile, false, 'main')
      const meta = dm.metadata(id)
      const editorState = dm.getState(id) // must be undefined!
      const text = dm.getText(id) // must be undefined!

      // 2. View state per pane
      const vState1 = dm.mediaViewState(id, 'main')
      vState1.scale = 1.5
      vState1.rotation = 90

      // 3. Split into secondary pane
      const pane2 = dm.splitPane('right', 'main', id)
      const vState2 = dm.mediaViewState(id, pane2) // should inherit copy of view state

      // 4. Update metadata
      dm.updateMediaMetadata(id, { width: 1024, height: 768, format: 'PNG' }, 'v2')
      const updatedMeta = dm.metadata(id)

      // 5. Close secondary pane -> not released
      dm.close(id, false, pane2)
      const tokensAfterPaneClose = [...releasedTokens]

      // 6. Close main pane -> released
      dm.close(id, false, 'main')
      const tokensAfterLastClose = [...releasedTokens]

      return {
        id,
        isImage: meta.kind === 'image',
        hasEditorState: editorState !== undefined,
        hasText: text !== undefined,
        vState2Scale: vState2.scale,
        vState2Rotation: vState2.rotation,
        updatedWidth: updatedMeta.media.width,
        tokensAfterPaneClose,
        tokensAfterLastClose,
      }
    })

    assert.equal(res.isImage, true)
    assert.equal(res.hasEditorState, false, 'Media documents must not create EditorState')
    assert.equal(res.hasText, false, 'Media documents must not expose text content')
    assert.equal(res.vState2Scale, 1.5, 'Secondary pane must inherit zoom/scale state')
    assert.equal(res.vState2Rotation, 90, 'Secondary pane must inherit rotation state')
    assert.equal(res.updatedWidth, 1024)
    assert.deepEqual(res.tokensAfterPaneClose, [])
    assert.deepEqual(res.tokensAfterLastClose, ['tok-img-1'], 'Media release listener must be invoked when last pane closes')
  })

  assert.deepEqual(errors, [])
  console.log(`PASS all ${results.length} DocumentManager invariant regression tests`)
} finally {
  await browser?.close()
  await server.close()
}
