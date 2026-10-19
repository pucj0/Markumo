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
import { UpdateManager } from '/src/features/shell/updater/UpdateManager.ts';
import { updateState } from '/src/features/shell/updater/UpdateState.ts';
import { DesktopStartup, NativeListenerScope } from '/src/app/desktopStartup.ts';
import { useShellPreferences } from '/src/app/useShellPreferences.ts';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import { SessionWriter } from '/src/features/shell/launchSession.ts';

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
  UpdateManager,
  updateState,
  DesktopStartup,
  NativeListenerScope,
  SessionWriter,
  deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no });
    return { promise, resolve, reject };
  },
  async until(predicate) {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await Promise.resolve() }
    throw Error('Controlled asynchronous startup did not reach expected state');
  },
  startupHarness(options = {}) {
    const timers = new Map();
    const events = [];
    const releases = [];
    const model = { documents: [], workspace: '', dirtyCount: 0, confirmations: 0, destroyed: 0, writes: 0, settingsWrites: 0, registrations: 0, unlistens: 0 };
    let timerId = 0, writer, nativeClose;
    let startup;
    const guard = new WindowCloseGuard({
      status: () => ({ fileBusy: false, savingCount: 0, composing: false, dirtyCount: model.dirtyCount,
        documentCount: model.documents.length, activePane: 'main', hasActiveDocument: !!model.documents.length }),
      flush: () => startup.flushForClose(async () => { model.settingsWrites++ }, writer ? () => writer.flush(true) : undefined),
      confirmDirty: () => { model.confirmations++ }, destroy: async () => { startup.exit(); model.destroyed++ },
      blocked() {}, failed() {}, diagnose() {},
    });
    startup = new DesktopStartup({
      setTimer(callback, ms) { if (ms !== 20000) throw Error('Unexpected startup deadline'); timers.set(++timerId, callback); return timerId },
      clearTimer(id) { timers.delete(id) },
      protect: scope => scope.register('close', async () => {
        model.registrations++;
        if (options.protection) await options.protection;
        nativeClose = () => guard.request('native');
        return () => { model.unlistens++ };
      }),
      loadPreferences: current => { events.push('settings'); return options.loadPreferences ? options.loadPreferences(current) : Promise.resolve() },
      initialize: () => { events.push('launch'); return options.launch || Promise.resolve({ owner: true, documents: ['restored'], workspace: 'restored-root' }) },
      adopt: async launch => {
        events.push('adopt');
        model.documents = [...launch.documents]; model.workspace = launch.workspace;
        if (!launch.owner) return 'temporary';
        writer = new SessionWriter(async () => { model.writes++; if (options.persist) await options.persist }, () => {});
        writer.schedule({ restored: true });
        await writer.flush(true);
        return 'owner';
      },
      release: async launch => { releases.push(...launch.documents) },
      changed: state => { events.push(state.phase) },
    });
    return { startup, model, timers, events, releases,
      timeout() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()) },
      close() { if (!nativeClose) throw Error('Native close is not protected'); return nativeClose() },
      dispose() { startup.dispose(); writer?.dispose() },
    };
  },
  createPreferences() {
    const manager = new DocumentManager([]);
    let preferences;
    let alive = true;
    const container = document.createElement('div');
    document.body.append(container);
    const instance = createApp({ setup() {
      preferences = useShellPreferences({ desktop: false, isAlive: () => alive, toast: () => {}, manager,
        workspace: {}, autoSaver: { configure() {} }, revision: ref(0), getActiveDoc: () => null });
      return () => null;
    } });
    instance.mount(container);
    return { preferences, dispose() { alive = false; instance.unmount(); preferences.dispose(); manager.dispose(); container.remove(); } };
  },
  nextTick
};
`)

// Tauri's official SDK mocks intercept every IPC; these pages mount the actual
// desktop App/useAppShell branch without native file, install or restart actions.
fs.writeFileSync(`${output}/desktop.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./desktop.js"></script>')
fs.writeFileSync(`${output}/desktop.js`, `
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createApp } from 'vue';
import App from '/src/App.vue';
window.isTauri = true;
mockWindows('main');
const mode = new URLSearchParams(location.search).get('mode');
const calls = [], listeners = new Map(), released = [];
let settingsResolve, launchResolve, persistedResolve, deadline;
const settingsPending = new Promise(resolve => { settingsResolve = resolve });
const launchPending = new Promise(resolve => { launchResolve = resolve });
const persistedPending = new Promise(resolve => { persistedResolve = resolve });
const launch = { kind: mode === 'temporary' ? 'file' : 'app', ownsSession: !['no-owner', 'temporary'].includes(mode), files: { files: [], errors: [] }, roots: [], activePath: null,
  layout: { mode: 'single', sidebarWidth: 254, sidebarVisible: false }, warnings: [] };
const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout;
window.setTimeout = (callback, ms, ...args) => {
  const id = originalSetTimeout(callback, ms, ...args);
  if (ms === 20000) deadline = { id, callback };
  return id;
};
mockIPC((command, args) => {
  calls.push({ command, args });
  if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler }
  if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return }
  if (command === 'load_editor_settings') return mode === 'settings-hang' ? settingsPending : {};
  if (command === 'initialize_launch') return mode === 'launch-hang' ? launchPending : launch;
  if (command === 'persist_session') {
    if (mode === 'persist-fail') throw Error('native persistence denied');
    return mode === 'persist-hang' ? persistedPending : undefined;
  }
  if (command === 'get_recent_workspaces') return [];
  if (command === 'file_preferences') return { recent: [], layout: launch.layout };
  if (command === 'drain_pending') return { files: [], errors: [] };
  if (command === 'release_file') { released.push(args.token); return }
  if (command === 'plugin:window|set_theme' || command === 'plugin:window|destroy' || command === 'report_update_window' || command === 'save_editor_settings' || command === 'persist_layout') return;
  if (command === 'update_runtime') return { version: '1.0.4', platform: 'linux', installSupported: false };
  if (command === 'confirm_update_startup') return null;
  throw Error('Unapproved test IPC: ' + command);
});
const app = createApp(App);
app.mount('#app');
window.nativeTest = { app, setup: app._instance.setupState, calls, listeners, released,
  timeout() { originalClearTimeout(deadline.id); deadline.callback() },
  settingsResolve, launchResolve, persistedResolve, launch,
  close() {
    const entry = [...listeners].find(([, event]) => event === 'tauri://close-requested');
    if (!entry) throw Error('Product close listener missing');
    window.__TAURI_INTERNALS__.runCallback(entry[0], { event: entry[1], id: entry[0], payload: null });
  },
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
  await page.waitForFunction(() => window.s?.manager && window.s.settingsReady && window.f)

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

  await test('D2. Lifecycle: unmount during debounced settings change flushes new value to storage without delay leak', async () => {
    const res = await page.evaluate(async () => {
      const { createApp, App, nextTick } = window.f
      localStorage.removeItem('markumo.settings.v1')
      const writes = []
      const origSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function(k, v) {
        if (this === localStorage && k === 'markumo.settings.v1') writes.push(JSON.parse(v))
        return origSetItem.call(this, k, v)
      }
      const until = async predicate => {
        for (let i = 0; i < 200; i++) {
          if (predicate()) return
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        throw Error('Settings persistence did not reach the expected state')
      }

      // 1. Mount real App.vue
      const container = document.createElement('div')
      container.id = 'app-test-d2'
      document.body.appendChild(container)
      const instance = createApp(App)
      instance.mount(container)
      await nextTick()

      const setup = instance._instance.setupState
      await until(() => setup.settingsReady)
      // 2. Modify a reactive setting
      setup.fontSize = 22
      await nextTick()

      // Verify that at this exact instant (<250ms), localStorage has NOT yet been written by debounce timer
      const beforeUnmountRaw = localStorage.getItem('markumo.settings.v1')
      const beforeUnmountParsed = beforeUnmountRaw ? JSON.parse(beforeUnmountRaw) : null
      const savedBeforeUnmount = beforeUnmountParsed?.fontSize === 22

      // 3. Immediately unmount BEFORE the 250ms debounce timer fires!
      instance.unmount()
      container.remove()
      await nextTick()

      // 4. Wait for the flush promise (which was synchronously triggered by preferences.dispose()) to complete write
      await until(() => writes.some(settings => settings.fontSize === 22))

      const afterUnmountRaw = localStorage.getItem('markumo.settings.v1')
      const afterUnmountParsed = afterUnmountRaw ? JSON.parse(afterUnmountRaw) : null
      const savedAfterUnmount = afterUnmountParsed?.fontSize === 22

      // 5. Track writes over the next 350ms to ensure no delayed second write occurs
      const flushedWriteCount = writes.length
      try {
        await new Promise(r => setTimeout(r, 350))
      } finally {
        Storage.prototype.setItem = origSetItem
      }

      return {
        savedBeforeUnmount,
        savedAfterUnmount,
        delayedWriteCount: writes.length - flushedWriteCount,
        flushedWriteCount,
        finalFontSize: afterUnmountParsed?.fontSize,
      }
    })

    assert.equal(res.savedBeforeUnmount, false, 'Debounce must not have fired before unmount')
    assert.equal(res.savedAfterUnmount, true, 'Unmount must flush pending settings immediately to storage')
    assert.equal(res.finalFontSize, 22, 'Persisted setting must match the modified value')
    assert.equal(res.flushedWriteCount, 1, 'Prototype interceptor must observe the real flush write exactly once')
    assert.equal(res.delayedWriteCount, 0, 'No delayed second write should happen after unmount')
  })

  await test('D3. Lifecycle: controlled UpdateManager dispose prevents rescheduled checks, UI updates, and installs', async () => {
    const res = await page.evaluate(async () => {
      const { UpdateManager, updateState } = window.f
      const state = updateState()

      let checkCalls = 0
      let prepareCalls = 0
      let acquireCalls = 0
      let markPendingCalls = 0

      const services = {
        check: async () => {
          checkCalls++
          return {
            version: '2.0.0',
            body: 'Release notes',
            download: async () => {},
            install: async () => {},
            close: async () => {},
          }
        },
        prepare: async () => { prepareCalls++; return true },
        finishPreparation: () => {},
        acquire: async () => { acquireCalls++ },
        release: async () => {},
        markPending: async () => { markPendingCalls++ },
        clearPending: async () => {},
        relaunch: async () => {},
        notify: () => {},
      }

      const mgr = new UpdateManager(state, services)

      // Start the manager with auto-check enabled
      mgr.start(true)
      mgr.configure({ autoCheckUpdates: true, autoDownloadUpdates: false }, true)

      // Dispose the manager
      mgr.dispose()

      // Attempt to trigger start again on disposed instance
      mgr.start(true)

      // Attempt manual check on disposed instance
      await mgr.checkForUpdates()

      // Attempt download on disposed instance
      await mgr.downloadUpdate()

      // Attempt install on disposed instance
      await mgr.installUpdate()

      return {
        checkCalls,
        prepareCalls,
        acquireCalls,
        markPendingCalls,
        disposedFlag: mgr.disposed,
      }
    })

    assert.equal(res.checkCalls, 0, 'Disposed UpdateManager must never run checks')
    assert.equal(res.prepareCalls, 0, 'Disposed UpdateManager must never call prepare')
    assert.equal(res.acquireCalls, 0, 'Disposed UpdateManager must never acquire lease')
    assert.equal(res.markPendingCalls, 0, 'Disposed UpdateManager must never mark pending')
  })

  await test('D3b. In-flight update check returns after dispose: release resource, preserve state, cancel timers', async () => {
    const res = await page.evaluate(async () => {
      const { UpdateManager, updateState } = window.f
      let resolveCheck, started
      const checkingStarted = new Promise(resolve => { started = resolve })
      const pending = new Promise(resolve => { resolveCheck = resolve })
      const timers = new Set()
      let schedules = 0, releases = 0, unsafeCalls = 0
      const oldSetTimeout = window.setTimeout, oldClearTimeout = window.clearTimeout
      const oldSetInterval = window.setInterval, oldClearInterval = window.clearInterval
      window.setTimeout = (...args) => { schedules++; const id = oldSetTimeout(...args); timers.add(id); return id }
      window.clearTimeout = id => { timers.delete(id); oldClearTimeout(id) }
      window.setInterval = (...args) => { schedules++; const id = oldSetInterval(...args); timers.add(id); return id }
      window.clearInterval = id => { timers.delete(id); oldClearInterval(id) }
      const state = updateState()
      const mgr = new UpdateManager(state, {
        check: () => { started(); return pending },
        prepare: async () => { unsafeCalls++; return false }, finishPreparation() {},
        acquire: async () => { unsafeCalls++ }, release: async () => {},
        markPending: async () => { unsafeCalls++ }, clearPending: async () => {},
        relaunch: async () => { unsafeCalls++ }, notify: () => { unsafeCalls++ },
      })
      try {
        mgr.start(true)
        mgr.configure({ autoCheckUpdates: true, autoDownloadUpdates: true }, true)
        const checking = mgr.checkForUpdates()
        await checkingStarted
        mgr.dispose()
        const atDispose = JSON.stringify(state)
        const schedulesAtDispose = schedules
        resolveCheck({ version: '9.9.9', body: 'late', close: async () => { releases++ },
          download: async () => { unsafeCalls++ }, install: async () => { unsafeCalls++ } })
        await checking
        await Promise.resolve()
        mgr.start(true)
        mgr.configure({ autoCheckUpdates: true, autoDownloadUpdates: true }, true)
        await mgr.checkForUpdates()
        return { phaseAtDispose: JSON.parse(atDispose).phase, unchanged: JSON.stringify(state) === atDispose,
          releases, unsafeCalls, pendingTimers: timers.size, schedulesAtDispose, schedules }
      } finally {
        mgr.dispose()
        window.setTimeout = oldSetTimeout; window.clearTimeout = oldClearTimeout
        window.setInterval = oldSetInterval; window.clearInterval = oldClearInterval
      }
    })
    assert.equal(res.phaseAtDispose, 'checking', 'Dispose must occur after the actual asynchronous check starts')
    assert.equal(res.unchanged, true)
    assert.equal(res.releases, 1)
    assert.equal(res.unsafeCalls, 0)
    assert.equal(res.pendingTimers, 0)
    assert.equal(res.schedulesAtDispose, 1, 'Observe initial scheduling before disposal')
    assert.equal(res.schedules, res.schedulesAtDispose, 'Late completion must not reschedule checks')
  })

  await test('D4. Product NativeListenerScope: late registration, duplicate keys, disposal, and failed registration', async () => {
    const res = await page.evaluate(async () => {
      const { NativeListenerScope } = window.f
      const scope = new NativeListenerScope()
      let resolve, registered = 0, stopped = 0
      const listen = () => { registered++; return new Promise(r => { resolve = r }) }
      const first = scope.register('close', listen)
      const second = scope.register('close', listen)
      await Promise.resolve()
      scope.dispose()
      resolve(() => { stopped++ })
      await first
      scope.dispose()
      await scope.register('after-dispose', listen)
      const active = new NativeListenerScope()
      await active.register('pending', async () => { registered++; return () => { stopped++ } })
      await active.register('pending', listen)
      active.dispose(); active.dispose()
      const retry = new NativeListenerScope()
      let actualError = ''
      try { await retry.register('close', async () => { throw Error('IPC registration failed') }) }
      catch (error) { actualError = error.message }
      await retry.register('close', async () => { registered++; return () => { stopped++ } })
      retry.dispose()
      return { samePromise: first === second, registered, stopped, actualError }
    })
    assert.equal(res.samePromise, true)
    assert.equal(res.registered, 3, 'Duplicate and disposed registrations must never invoke native services')
    assert.equal(res.stopped, 3, 'Every accepted or late listener must unlisten exactly once')
    assert.equal(res.actualError, 'IPC registration failed')
  })

  await test('E1. Product startup: preferences, restore, confirmed session persistence, then ready', async () => {
    const res = await page.evaluate(async () => {
      const f = window.f, prefs = f.createPreferences(), persist = f.deferred()
      const h = f.startupHarness({ loadPreferences: current => prefs.preferences.loadPreferences(current, async () => f.settingsFrom({ fontSize: 18 })), persist: persist.promise })
      try {
        const starting = h.startup.start()
        await f.until(() => h.model.writes === 1)
        const beforePersistence = h.startup.state.phase
        persist.resolve()
        await starting
        const result = { beforePersistence, state: { ...h.startup.state }, events: [...h.events], writes: h.model.writes,
          settingsReady: prefs.preferences.settingsReady.value, fontSize: prefs.preferences.fontSize.value, timers: h.timers.size }
        let missingWriterError = ''
        try { await h.startup.flushForClose(async () => {}) } catch (error) { missingWriterError = error.message }
        return { ...result, missingWriterError }
      } finally { h.dispose(); prefs.dispose() }
    })
    assert.equal(res.beforePersistence, 'initializing', 'A pending session write cannot be declared ready')
    assert.deepEqual(res.state, { phase: 'ready', error: '', closeProtected: true, session: 'owner' })
    assert.equal(res.settingsReady, true)
    assert.equal(res.fontSize, 18)
    assert.equal(res.writes, 1)
    assert.equal(res.timers, 0)
    assert(res.events.indexOf('settings') < res.events.indexOf('launch'))
    assert(res.events.indexOf('launch') < res.events.indexOf('adopt'))
    assert.match(res.missingWriterError, /会话保存能力/)
  })

  for (const stage of ['settings', 'launch']) {
    await test(`E2/E3/E7. ${stage} IPC never settles: timeout locks editing, protected dirty close cannot discard`, async () => {
      const res = await page.evaluate(async stage => {
        const f = window.f, forever = f.deferred()
        const h = f.startupHarness(stage === 'settings' ? { loadPreferences: () => forever.promise } : { launch: forever.promise })
        const starting = h.startup.start()
        await f.until(() => h.events.includes(stage))
        h.timeout()
        await starting
        const phase = h.startup.state.phase
        const error = h.startup.state.error
        const protectedClose = h.startup.state.closeProtected
        h.model.documents = ['defensive-unsaved-draft']; h.model.dirtyCount = 1
        await h.close()
        const afterClose = { ...h.model }
        h.dispose()
        return { phase, error, protectedClose, afterClose, finalPhase: h.startup.state.phase, timers: h.timers.size, unlistens: h.model.unlistens }
      }, stage)
      assert.equal(res.phase, 'failed')
      assert.match(res.error, /启动超时.*编辑已锁定/)
      assert.equal(res.protectedClose, true)
      assert.equal(res.afterClose.confirmations, 1)
      assert.equal(res.afterClose.destroyed, 0)
      assert.equal(res.afterClose.writes, 0)
      assert.equal(res.afterClose.settingsWrites, 0)
      assert.equal(res.afterClose.dirtyCount, 1)
      assert.equal(res.finalPhase, 'disposed')
      assert.equal(res.timers, 0)
      assert.equal(res.unlistens, 1)
    })
  }

  await test('E4. Late launch after timeout cannot replace user documents/workspace or write a session', async () => {
    const res = await page.evaluate(async () => {
      const f = window.f, launch = f.deferred(), h = f.startupHarness({ launch: launch.promise })
      const starting = h.startup.start()
      await f.until(() => h.events.includes('launch'))
      h.timeout(); await starting
      h.model.documents = ['user-draft']; h.model.workspace = 'user-root'
      launch.resolve({ owner: true, documents: ['stale-file'], workspace: 'stale-root' })
      await f.until(() => h.releases.length === 1)
      const result = { state: { ...h.startup.state }, model: { ...h.model }, releases: [...h.releases], adopted: h.events.includes('adopt') }
      h.dispose()
      return result
    })
    assert.equal(res.state.phase, 'failed')
    assert.equal(res.state.session, 'pending')
    assert.deepEqual(res.model.documents, ['user-draft'])
    assert.equal(res.model.workspace, 'user-root')
    assert.equal(res.model.writes, 0)
    assert.equal(res.adopted, false)
    assert.deepEqual(res.releases, ['stale-file'])
  })

  await test('E5. Actual preferences reader returning after timeout cannot replace newer settings or enable persistence', async () => {
    const res = await page.evaluate(async () => {
      const f = window.f, read = f.deferred(), prefs = f.createPreferences()
      let returned = false
      const before = localStorage.getItem('markumo.settings.v1')
      const h = f.startupHarness({ loadPreferences: current => prefs.preferences.loadPreferences(current, () => read.promise).then(() => { returned = true }) })
      try {
        const starting = h.startup.start()
        await f.until(() => h.events.includes('settings'))
        h.timeout(); await starting
        prefs.preferences.fontSize.value = 23
        read.resolve(f.settingsFrom({ fontSize: 10 }))
        await f.until(() => returned)
        return { fontSize: prefs.preferences.fontSize.value, settingsReady: prefs.preferences.settingsReady.value,
          storageUnchanged: localStorage.getItem('markumo.settings.v1') === before, phase: h.startup.state.phase, writes: h.model.writes }
      } finally { h.dispose(); prefs.dispose() }
    })
    assert.equal(res.fontSize, 23)
    assert.equal(res.settingsReady, false)
    assert.equal(res.storageUnchanged, true)
    assert.equal(res.phase, 'failed')
    assert.equal(res.writes, 0)
  })

  await test('E6/E8. Unmount during native registration releases late listener and deadline; restart uses one registration', async () => {
    const res = await page.evaluate(async () => {
      const f = window.f, protection = f.deferred(), h = f.startupHarness({ protection: protection.promise })
      const starting = h.startup.start()
      const repeated = h.startup.start()
      await f.until(() => h.model.registrations === 1)
      h.dispose(); await starting
      protection.resolve()
      await f.until(() => h.model.unlistens === 1)
      await h.startup.start()
      h.dispose()
      const next = f.startupHarness()
      await next.startup.start(); await next.startup.start()
      const nextRegistrations = next.model.registrations
      next.dispose(); next.dispose()
      return { sameAttempt: starting === repeated, phase: h.startup.state.phase, registrations: h.model.registrations,
        unlistens: h.model.unlistens, timers: h.timers.size, writes: h.model.writes,
        nextRegistrations, nextUnlistens: next.model.unlistens, nextTimers: next.timers.size }
    })
    assert.equal(res.sameAttempt, true)
    assert.equal(res.phase, 'disposed')
    assert.equal(res.registrations, 1)
    assert.equal(res.unlistens, 1)
    assert.equal(res.timers, 0)
    assert.equal(res.writes, 0)
    assert.equal(res.nextRegistrations, 1)
    assert.equal(res.nextUnlistens, 1)
    assert.equal(res.nextTimers, 0)
  })

  for (const stage of ['settings', 'launch', 'persist', 'protection']) {
    await test(`E9/E10. ${stage} failure retains actual IPC error and never reports ready`, async () => {
      const res = await page.evaluate(async stage => {
        const f = window.f
        const bad = () => Promise.reject(Error(`injected ${stage} IPC failure`))
        const options = stage === 'settings' ? { loadPreferences: bad } : stage === 'launch' ? { launch: bad() }
          : stage === 'persist' ? { persist: bad() } : { protection: bad() }
        // Attach immediately to controlled rejections before sequential startup reaches them.
        for (const value of Object.values(options)) if (value instanceof Promise) value.catch(() => {})
        const h = f.startupHarness(options)
        await h.startup.start()
        const result = { ...h.startup.state, timers: h.timers.size }
        h.dispose()
        return result
      }, stage)
      assert.equal(res.phase, 'failed')
      assert.match(res.error, new RegExp(`injected ${stage} IPC failure`))
      assert.equal(res.session, 'pending')
      assert.equal(res.timers, 0)
    })
  }

  await test('E exit is distinct from timeout and disposal; late restore remains ignored', async () => {
    const res = await page.evaluate(async () => {
      const f = window.f, launch = f.deferred(), h = f.startupHarness({ launch: launch.promise })
      const starting = h.startup.start()
      await f.until(() => h.events.includes('launch'))
      await h.close(); await starting
      const phaseAfterClose = h.startup.state.phase
      launch.resolve({ owner: true, documents: ['late'], workspace: 'late-root' })
      await f.until(() => h.releases.length === 1)
      const result = { phaseAfterClose, phaseAfterLate: h.startup.state.phase, timers: h.timers.size, destroyed: h.model.destroyed, writes: h.model.writes }
      h.dispose()
      return result
    })
    assert.equal(res.phaseAfterClose, 'exiting')
    assert.equal(res.phaseAfterLate, 'exiting')
    assert.equal(res.timers, 0)
    assert.equal(res.destroyed, 1)
    assert.equal(res.writes, 0)
  })

  for (const mode of ['normal', 'temporary', 'settings-hang', 'launch-hang', 'persist-hang', 'persist-fail', 'no-owner']) {
    await test(`F. Real desktop App with controlled IPC: ${mode}`, async () => {
      const nativePage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
      nativePage.on('pageerror', err => errors.push(err.message))
      try {
        await nativePage.goto(`http://127.0.0.1:${port}/${output}/desktop.html?mode=${mode}`)
        await nativePage.waitForFunction(() => window.nativeTest?.listeners && [...window.nativeTest.listeners.values()].includes('tauri://close-requested'))
        const command = mode === 'settings-hang' ? 'load_editor_settings' : mode === 'persist-hang' ? 'persist_session' : 'initialize_launch'
        await nativePage.waitForFunction(command => window.nativeTest.calls.some(call => call.command === command), command)
        if (mode.endsWith('-hang')) {
          await nativePage.evaluate(() => window.nativeTest.timeout())
        }
        if (mode === 'normal' || mode === 'temporary') {
          await nativePage.waitForFunction(() => !window.nativeTest.setup.startupLoading)
          assert.equal(await nativePage.locator('.app').evaluate(el => el.inert), false)
          assert.equal(await nativePage.evaluate(() => window.nativeTest.calls.filter(call => call.command === 'persist_session').length), mode === 'normal' ? 1 : 0)
        } else {
          await nativePage.waitForFunction(() => !!window.nativeTest.setup.startupError)
          assert.equal(await nativePage.locator('.app').evaluate(el => el.inert), true)
          assert.equal(await nativePage.evaluate(() => window.nativeTest.setup.startupLoading), true)
          if (mode === 'persist-fail') assert.match(await nativePage.locator('.startup-overlay').innerText(), /native persistence denied/)
          if (mode === 'no-owner') assert.match(await nativePage.locator('.startup-overlay').innerText(), /所有权未确认/)
          if (mode === 'settings-hang' || mode === 'launch-hang') {
            const before = await nativePage.evaluate(() => {
              const { setup, calls } = window.nativeTest
              setup.createNewDoc()
              return { docs: setup.manager.openedDocuments.length, writes: calls.filter(call => call.command === 'persist_session').length }
            })
            assert.deepEqual(before, { docs: 0, writes: 0 }, 'Product command and session write gates must stay closed')
          }
          // Defensive dirty content proves the real native listener reaches the
          // actual product WindowCloseGuard/DiscardDialog, even after failure.
          await nativePage.evaluate(() => {
            const { setup } = window.nativeTest
            const id = setup.manager.createUntitled('txt')
            setup.manager.dispatch(id, { changes: { from: 0, insert: 'unsaved' } })
            window.nativeTest.close()
          })
          await nativePage.waitForFunction(() => !!document.querySelector('[aria-label="未保存修改确认"]'))
          assert.equal(await nativePage.locator('.discard-overlay').evaluate(el => el.closest('[inert]') === null), true)
          assert.equal(await nativePage.evaluate(() => window.nativeTest.calls.some(call => call.command === 'plugin:window|destroy')), false)
          if (mode === 'settings-hang') {
            await nativePage.evaluate(() => { window.nativeTest.setup.fontSize = 23; window.nativeTest.settingsResolve({ fontSize: 10 }) })
            await nativePage.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
            assert.equal(await nativePage.evaluate(() => window.nativeTest.setup.fontSize), 23)
          }
          if (mode === 'launch-hang') {
            await nativePage.evaluate(() => window.nativeTest.launchResolve({ ...window.nativeTest.launch, files: { files: [
              { token: 'late-token', path: '/stale.txt', name: 'stale.txt', text: 'stale', version: 'v1', encoding: 'UTF-8', eol: 'LF', bom: false, readOnly: false }
            ], errors: [] } }))
            await nativePage.waitForFunction(() => window.nativeTest.released.includes('late-token'))
            assert.equal(await nativePage.evaluate(() => window.nativeTest.setup.manager.openedDocuments.length), 1)
            assert.equal(await nativePage.evaluate(() => window.nativeTest.setup.manager.getText(window.nativeTest.setup.manager.activeId)), 'unsaved')
          }
          if (mode === 'persist-hang') {
            await nativePage.evaluate(() => window.nativeTest.persistedResolve())
            await nativePage.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
            assert.equal(await nativePage.evaluate(() => window.nativeTest.setup.startupLoading), true)
            assert.match(await nativePage.evaluate(() => window.nativeTest.setup.startupError), /启动超时/)
          }
        }
        await nativePage.evaluate(() => window.nativeTest.app.unmount())
        await nativePage.waitForFunction(() => window.nativeTest.listeners.size === 0)
        const counts = await nativePage.evaluate(() => ({
          closeRegistrations: window.nativeTest.calls.filter(call => call.command === 'plugin:event|listen' && call.args.event === 'tauri://close-requested').length,
          closeUnlistens: window.nativeTest.calls.filter(call => call.command === 'plugin:event|unlisten' && call.args.event === 'tauri://close-requested').length,
        }))
        assert.deepEqual(counts, { closeRegistrations: 1, closeUnlistens: 1 })
      } finally { await nativePage.close() }
    })
  }

  for (const mode of ['settings-hang', 'launch-hang']) {
    await test(`F unmount before ${mode} settles: no late preferences, restore, listener or timer revival`, async () => {
      const nativePage = await browser.newPage()
      nativePage.on('pageerror', err => errors.push(err.message))
      try {
        await nativePage.goto(`http://127.0.0.1:${port}/${output}/desktop.html?mode=${mode}`)
        const command = mode === 'settings-hang' ? 'load_editor_settings' : 'initialize_launch'
        await nativePage.waitForFunction(command => window.nativeTest?.calls.some(call => call.command === command), command)
        await nativePage.evaluate(() => window.nativeTest.app.unmount())
        await nativePage.waitForFunction(() => window.nativeTest.listeners.size === 0)
        await nativePage.evaluate(mode => {
          const t = window.nativeTest
          t.timeout() // Even a queued, cancelled deadline must be harmless.
          if (mode === 'settings-hang') t.settingsResolve({ fontSize: 10 })
          else t.launchResolve({ ...t.launch, files: { files: [
            { token: 'disposed-token', path: '/disposed.txt', name: 'disposed.txt', text: '', version: 'v1', encoding: 'UTF-8', eol: 'LF', bom: false, readOnly: false }
          ], errors: [] } })
        }, mode)
        if (mode === 'launch-hang') await nativePage.waitForFunction(() => window.nativeTest.released.includes('disposed-token'))
        const res = await nativePage.evaluate(() => ({
          ready: window.nativeTest.setup.settingsReady,
          documents: window.nativeTest.setup.manager.openedDocuments.length,
          error: window.nativeTest.setup.startupError,
          writes: window.nativeTest.calls.filter(call => call.command === 'persist_session').length,
          listeners: window.nativeTest.listeners.size,
        }))
        assert.equal(res.documents, 0)
        assert.equal(res.error, '')
        assert.equal(res.writes, 0)
        assert.equal(res.listeners, 0)
        if (mode === 'settings-hang') assert.equal(res.ready, false)
      } finally { await nativePage.close() }
    })
  }

  assert.deepEqual(errors, [])
  console.log(`PASS all ${results.length} shell lifecycle and status regressions`)
} finally {
  await browser?.close()
  await server.close()
}
