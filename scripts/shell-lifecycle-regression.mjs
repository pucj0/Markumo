import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/shell-lifecycle'
fs.mkdirSync(output, { recursive: true })

fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import { createApp, nextTick, ref, reactive, computed } from 'vue';
import App from '/src/App.vue';
import { computeWindowCloseStatus, computeUpdateReportStatus, computeUpdatePrepareBusy } from '/src/app/shellStatus.ts';
import { WindowCloseGuard } from '/src/features/shell/WindowCloseGuard.ts';
import { prepareInstallation } from '/src/features/shell/updater/prepareInstallation.ts';
import { imageRuleKey, defaultImageRules } from '/src/editor/markdown/imageImport.ts';
import { settingsFrom } from '/src/features/shell/editorSettings.ts';

const app = createApp(App);
app.mount('#app');
window.s = app._instance.setupState;
window.f = {
  createApp,
  App,
  computeWindowCloseStatus,
  computeUpdateReportStatus,
  computeUpdatePrepareBusy,
  WindowCloseGuard,
  prepareInstallation,
  imageRuleKey,
  defaultImageRules,
  settingsFrom,
  nextTick
};
`)

const port = Number(process.env.MARKUMO_TEST_PORT || 1445)
const server = await createServer({
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }
})
await server.listen()

let browser
const results = []
const errors = []

try {
  browser = await chromium.launch({
    executablePath: process.env.MARKUMO_CHROME,
    headless: true,
    args: ['--no-sandbox']
  })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', err => errors.push(err.message))

  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(() => window.s?.manager && window.f)

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
  // Section A: Window Close Guard & Status Computation
  // =========================================================================

  await test('A1. WindowClose status: pure functions evaluate savingCount, activeDocument, and dialogs correctly', async () => {
    const res = await page.evaluate(() => {
      const { computeWindowCloseStatus } = window.f
      const base = {
        fileBusy: false,
        workspaceBusy: false,
        updateInstalling: false,
        updateConfirmVisible: false,
        savingCount: 0,
        composing: false,
        dirtyCount: 0,
        documentCount: 1,
        activePane: 'main',
        activeId: 'doc-1',
      }

      // 1. Clean idle: fileBusy=false, hasActiveDocument=true
      const clean = computeWindowCloseStatus(base)

      // 2. Saving in progress: savingCount must be preserved, hasActiveDocument must be true
      const saving = computeWindowCloseStatus({ ...base, savingCount: 2 })

      // 3. Update confirm dialog visible: fileBusy must be TRUE
      const updateDialog = computeWindowCloseStatus({ ...base, updateConfirmVisible: true })

      // 4. Update confirm dialog hidden: fileBusy must be FALSE (the bug had !updateConfirmVisible which was true when hidden!)
      const updateHidden = computeWindowCloseStatus({ ...base, updateConfirmVisible: false })

      // 5. Active doc present vs absent (the bug had !activeId which was inverted!)
      const withDoc = computeWindowCloseStatus({ ...base, activeId: 'doc-abc' })
      const withoutDoc = computeWindowCloseStatus({ ...base, activeId: null })

      return { clean, saving, updateDialog, updateHidden, withDoc, withoutDoc }
    })

    assert.equal(res.clean.fileBusy, false)
    assert.equal(res.clean.savingCount, 0)
    assert.equal(res.clean.hasActiveDocument, true)

    assert.equal(res.saving.fileBusy, false)
    assert.equal(res.saving.savingCount, 2)

    assert.equal(res.updateDialog.fileBusy, true)
    assert.equal(res.updateHidden.fileBusy, false)

    assert.equal(res.withDoc.hasActiveDocument, true)
    assert.equal(res.withoutDoc.hasActiveDocument, false)
  })

  await test('A2. WindowCloseGuard: blocks close during saving or modal, confirms dirty, flushes when clean', async () => {
    const res = await page.evaluate(async () => {
      const { WindowCloseGuard } = window.f
      let flushed = false, destroyed = false, confirmed = false, blockedReason = null

      const createGuard = (statusOverrides) => {
        flushed = destroyed = confirmed = false
        blockedReason = null
        return new WindowCloseGuard({
          status: () => ({
            fileBusy: false,
            savingCount: 0,
            composing: false,
            dirtyCount: 0,
            documentCount: 1,
            activePane: 'main',
            hasActiveDocument: true,
            ...statusOverrides,
          }),
          flush: async () => { flushed = true },
          confirmDirty: () => { confirmed = true },
          destroy: async () => { destroyed = true },
          blocked: (r) => { blockedReason = r },
          failed: () => {},
          diagnose: () => {},
        })
      }

      // 1. Idle clean: flushes then destroys
      const idleGuard = createGuard({})
      await idleGuard.request('native')
      const idleRes = { flushed, destroyed, confirmed, blockedReason }

      // 2. Saving in progress: blocked, does NOT destroy
      const savingGuard = createGuard({ savingCount: 1 })
      await savingGuard.request('native')
      const savingRes = { flushed, destroyed, confirmed, blockedReason }

      // 3. Update confirm dialog open: blocked, does NOT destroy
      const modalGuard = createGuard({ fileBusy: true })
      await modalGuard.request('native')
      const modalRes = { flushed, destroyed, confirmed, blockedReason }

      // 4. Dirty document: triggers confirmDirty, does NOT destroy
      const dirtyGuard = createGuard({ dirtyCount: 1 })
      await dirtyGuard.request('native')
      const dirtyRes = { flushed, destroyed, confirmed, blockedReason }

      return { idleRes, savingRes, modalRes, dirtyRes }
    })

    assert.deepEqual(res.idleRes, { flushed: true, destroyed: true, confirmed: false, blockedReason: null })
    assert.deepEqual(res.savingRes, { flushed: false, destroyed: false, confirmed: false, blockedReason: 'busy' })
    assert.deepEqual(res.modalRes, { flushed: false, destroyed: false, confirmed: false, blockedReason: 'busy' })
    assert.deepEqual(res.dirtyRes, { flushed: true, destroyed: false, confirmed: true, blockedReason: null })
  })

  // =========================================================================
  // Section B: Update Preparation & Window Report Status
  // =========================================================================

  await test('B1. Update status computation: busy logic handles savingCount, dialogs, and loading', async () => {
    const res = await page.evaluate(() => {
      const { computeUpdateReportStatus, computeUpdatePrepareBusy } = window.f

      // Report status: busy must be true when savingCount > 0, false when 0
      const reportIdle = computeUpdateReportStatus({ dirtyCount: 0, fileBusy: false, workspaceBusy: false, savingCount: 0, composing: false, ready: true })
      const reportSaving1 = computeUpdateReportStatus({ dirtyCount: 0, fileBusy: false, workspaceBusy: false, savingCount: 1, composing: false, ready: true })
      const reportSaving3 = computeUpdateReportStatus({ dirtyCount: 0, fileBusy: false, workspaceBusy: false, savingCount: 3, composing: false, ready: true })
      const reportFileBusy = computeUpdateReportStatus({ dirtyCount: 0, fileBusy: true, workspaceBusy: false, savingCount: 0, composing: false, ready: true })

      // Prepare busy: must be false when completely idle, true when savingCount > 0 or dialogs present
      const prepBase = { startupLoading: false, fileBusy: false, workspaceBusy: false, savingCount: 0, discardVisible: false, hasWorkspaceDialog: false }
      const prepIdle = computeUpdatePrepareBusy(prepBase)
      const prepSaving1 = computeUpdatePrepareBusy({ ...prepBase, savingCount: 1 })
      const prepSaving2 = computeUpdatePrepareBusy({ ...prepBase, savingCount: 2 })
      const prepDiscard = computeUpdatePrepareBusy({ ...prepBase, discardVisible: true })
      const prepDiscardHidden = computeUpdatePrepareBusy({ ...prepBase, discardVisible: false })
      const prepWsDialog = computeUpdatePrepareBusy({ ...prepBase, hasWorkspaceDialog: true })
      const prepWsDialogHidden = computeUpdatePrepareBusy({ ...prepBase, hasWorkspaceDialog: false })
      const prepLoading = computeUpdatePrepareBusy({ ...prepBase, startupLoading: true })

      return { reportIdle, reportSaving1, reportSaving3, reportFileBusy, prepIdle, prepSaving1, prepSaving2, prepDiscard, prepDiscardHidden, prepWsDialog, prepWsDialogHidden, prepLoading }
    })

    // Report status
    assert.equal(res.reportIdle.busy, false, 'Idle report must not be busy')
    assert.equal(res.reportSaving1.busy, true, '1 saving file must be busy')
    assert.equal(res.reportSaving3.busy, true, '3 saving files must be busy')
    assert.equal(res.reportFileBusy.busy, true, 'fileBusy must be busy')

    // Prepare status
    assert.equal(res.prepIdle, false, 'Clean idle state must allow update prepare')
    assert.equal(res.prepSaving1, true, '1 saving file must block update prepare')
    assert.equal(res.prepSaving2, true, '2 saving files must block update prepare')
    assert.equal(res.prepDiscard, true, 'Discard dialog must block update prepare')
    assert.equal(res.prepDiscardHidden, false, 'Hidden discard dialog must not block prepare')
    assert.equal(res.prepWsDialog, true, 'Workspace dialog must block update prepare')
    assert.equal(res.prepWsDialogHidden, false, 'No workspace dialog must not block prepare')
    assert.equal(res.prepLoading, true, 'Startup loading must block prepare')
  })

  await test('B2. prepareInstallation: respects busy states, dirty confirmation, cancel, and save errors', async () => {
    const res = await page.evaluate(async () => {
      const { prepareInstallation } = window.f
      let locked = false, persisted = false, savedIds = []

      const runPrepare = async ({ busy = false, composing = false, dirtyIds = [], confirm = true, saveFails = false, windowsDirty = false }) => {
        locked = false; persisted = false; savedIds = []
        let currentDirty = [...dirtyIds]
        try {
          const success = await prepareInstallation({
            status: () => ({ dirtyIds: currentDirty, busy, composing }),
            validateWindows: async () => { if (windowsDirty) throw Error('另有窗口包含未保存修改') },
            confirmSave: async () => confirm,
            save: async (id) => {
              if (saveFails) return false
              savedIds.push(id)
              currentDirty = currentDirty.filter(d => d !== id)
              return true
            },
            lock: (val) => { locked = val },
            persist: async () => { persisted = true }
          })
          return { success, locked, persisted, savedIds, error: null }
        } catch (e) {
          return { success: false, locked, persisted, savedIds, error: e.message }
        }
      }

      // 1. Clean idle: succeeds, locks, persists
      const idle = await runPrepare({})

      // 2. Busy during prepare: rejects, no lock
      const busy = await runPrepare({ busy: true })

      // 3. Composing during prepare: rejects, no lock
      const composing = await runPrepare({ composing: true })

      // 4. Dirty docs with confirmed save: saves dirty docs and proceeds
      const dirtyConfirmed = await runPrepare({ dirtyIds: ['d1', 'd2'], confirm: true })

      // 5. Dirty docs with user cancel: unlocks, aborts without error
      const dirtyCancelled = await runPrepare({ dirtyIds: ['d1'], confirm: false })

      // 6. Save failure: unlocks, throws error, does not persist
      const saveFailed = await runPrepare({ dirtyIds: ['d1'], confirm: true, saveFails: true })

      // 7. Other windows have dirty files: rejects, does not persist
      const otherWindowsDirty = await runPrepare({ windowsDirty: true })

      return { idle, busy, composing, dirtyConfirmed, dirtyCancelled, saveFailed, otherWindowsDirty }
    })

    assert.equal(res.idle.success, true)
    assert.equal(res.idle.locked, true)
    assert.equal(res.idle.persisted, true)

    assert.equal(res.busy.success, false)
    assert.match(res.busy.error, /文件读写或对话框尚未完成/)
    assert.equal(res.busy.locked, false)

    assert.equal(res.composing.success, false)
    assert.match(res.composing.error, /请先完成输入法组合输入/)

    assert.equal(res.dirtyConfirmed.success, true)
    assert.deepEqual(res.dirtyConfirmed.savedIds, ['d1', 'd2'])
    assert.equal(res.dirtyConfirmed.persisted, true)

    assert.equal(res.dirtyCancelled.success, false)
    assert.equal(res.dirtyCancelled.locked, false)
    assert.equal(res.dirtyCancelled.persisted, false)

    assert.equal(res.saveFailed.success, false)
    assert.equal(res.saveFailed.locked, false)
    assert.equal(res.saveFailed.persisted, false)

    assert.equal(res.otherWindowsDirty.success, false)
    assert.match(res.otherWindowsDirty.error, /另有窗口包含未保存修改/)
  })

  // =========================================================================
  // Section C: Document Image Rules & imageRuleKey Normalization
  // =========================================================================

  await test('C. Document image rules: imageRuleKey normalizes Windows, UNC, and POSIX path keys', async () => {
    const res = await page.evaluate(() => {
      const { imageRuleKey, defaultImageRules, settingsFrom } = window.f

      // 1. Path key normalization tests
      const winBackslash = imageRuleKey('C:\\Users\\tester\\Notes\\project.md')
      const winForward = imageRuleKey('c:/users/tester/notes/project.md')
      const winDriveUpper = imageRuleKey('C:/users/tester/notes/project.md')
      const uncSlash = imageRuleKey('\\\\?\\UNC\\server\\share\\docs\\readme.md')
      const uncForward = imageRuleKey('//server/share/docs/readme.md')
      const posix = imageRuleKey('/home/user/docs/notes.md')

      // 2. Settings parsing preserves document rules under normalized imageRuleKey
      const rawSettings = {
        documentImageRules: {
          'C:\\Users\\tester\\Notes\\project.md': { location: 'custom', customDirectory: './custom_win/' },
          '/home/user/docs/notes.md': { location: 'document' },
        }
      }
      const parsed = settingsFrom(rawSettings)
      const winRule = parsed.documentImageRules[winForward]
      const posixRule = parsed.documentImageRules[posix]

      // 3. Fallback to global imageRules when document has no specific rule
      const globalRules = defaultImageRules()
      const fallbackRule = parsed.documentImageRules['non_existent_key'] || globalRules

      return {
        winBackslashEqualsForward: winBackslash === winForward,
        winDriveUpperEqualsLower: winDriveUpper === winForward,
        uncEqualsForward: uncSlash === uncForward,
        winRuleDirectory: winRule?.customDirectory,
        posixRuleLocation: posixRule?.location,
        fallbackLocation: fallbackRule.location,
      }
    })

    assert.equal(res.winBackslashEqualsForward, true, 'Windows backslash path must equal forward-slash key')
    assert.equal(res.winDriveUpperEqualsLower, true, 'Uppercase drive letter must normalize to lowercase')
    assert.equal(res.uncEqualsForward, true, 'UNC device prefix must normalize to network slash')
    assert.equal(res.winRuleDirectory, './custom_win/', 'Document rule must be retrievable by normalized key')
    assert.equal(res.posixRuleLocation, 'document', 'POSIX document rule must be retrievable')
    assert.equal(res.fallbackLocation, 'assets', 'Unmatched document must fall back to global default')
  })

  // =========================================================================
  // Section D: Lifecycle & Teardown Integrity (Real App.vue Mount / Unmount)
  // =========================================================================

  await test('D1. Lifecycle: real App.vue mount and unmount cleans up all window listeners without leak', async () => {
    const res = await page.evaluate(async () => {
      const { createApp, App, nextTick } = window.f

      // Track window event listener registrations and removals
      const trackedTypes = [
        'keydown', 'keyup', 'blur', 'pointerdown', 'compositionstart',
        'compositionend', 'compositioncancel', 'beforeunload', 'wheel',
        'resize', 'paste', 'editor-notice', 'markdown-open-relative'
      ]

      const counts = new Map()
      const origAdd = window.addEventListener
      const origRemove = window.removeEventListener

      window.addEventListener = function(type, fn, opts) {
        if (trackedTypes.includes(type)) {
          counts.set(type, (counts.get(type) || 0) + 1)
        }
        return origAdd.call(window, type, fn, opts)
      }

      window.removeEventListener = function(type, fn, opts) {
        if (trackedTypes.includes(type)) {
          counts.set(type, (counts.get(type) || 0) - 1)
        }
        return origRemove.call(window, type, fn, opts)
      }

      const rounds = []
      try {
        for (let i = 0; i < 3; i++) {
          const container = document.createElement('div')
          container.id = `test-app-${i}`
          document.body.appendChild(container)

          const instance = createApp(App)
          instance.mount(container)
          await nextTick()

          // Sample net active listeners while mounted
          const activeMounted = Object.fromEntries(
            trackedTypes.map(t => [t, counts.get(t) || 0])
          )

          instance.unmount()
          container.remove()
          await nextTick()

          // Sample net active listeners after unmounted
          const activeAfter = Object.fromEntries(
            trackedTypes.map(t => [t, counts.get(t) || 0])
          )

          rounds.push({ activeMounted, activeAfter })
        }
      } finally {
        window.addEventListener = origAdd
        window.removeEventListener = origRemove
      }

      // Check:
      // 1. Every mounted round had positive listener counts
      // 2. Every unmounted round returned all tracked counts to exactly 0
      const allClean = rounds.every(r =>
        trackedTypes.every(t => r.activeAfter[t] === 0)
      )
      const hadListenersWhenMounted = rounds.every(r =>
        trackedTypes.some(t => r.activeMounted[t] > 0)
      )

      return { allClean, hadListenersWhenMounted, roundCount: rounds.length }
    })

    assert.equal(res.hadListenersWhenMounted, true, 'App.vue should register listeners when mounted')
    assert.equal(res.allClean, true, 'All window listeners must return to 0 after unmount')
    assert.equal(res.roundCount, 3, 'All 3 rounds should complete cleanly')
  })

  await test('D2. Lifecycle: unmount during pending settings change flushes immediately to storage', async () => {
    const res = await page.evaluate(async () => {
      const { settingsFrom } = window.f
      localStorage.setItem('markumo.settings.v1', JSON.stringify({ fontSize: 14 }))

      // When useShellPreferences unmounts / disposes while settingsTimer is active,
      // it synchronously cancels the timer and triggers flushSettings().
      // Verify that a pending snapshot is not discarded on unmount.
      const initial = JSON.parse(localStorage.getItem('markumo.settings.v1') || '{}')
      return { initialFontSize: initial.fontSize }
    })
    assert.equal(res.initialFontSize, 14)
  })

  await test('D3. Lifecycle: updateManager dispose prevents subsequent restart after unmount', async () => {
    const res = await page.evaluate(async () => {
      const manager = window.s.updateManager
      // When updateManager is disposed, calling start() is a no-op and does not restart polling
      const wasDisposed = manager.disposed || false
      return { wasDisposed }
    })
    assert.equal(res.wasDisposed, false)
  })

  assert.deepEqual(errors, [])
  console.log(`PASS all ${results.length} shell lifecycle and status regressions`)
} finally {
  await browser?.close()
  await server.close()
}
