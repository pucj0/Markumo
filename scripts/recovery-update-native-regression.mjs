// Windows/WebView2 integration: real RecoveryService, actual editor input,
// physical JSON bodies + SHA256, force termination and fresh process restarts.
// No browser recovery mock is involved. Run from the repository root with:
// node scripts/recovery-update-native-regression.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import { chromium } from 'playwright'

assert.equal(process.platform, 'win32', 'Requires Windows/WebView2')
const workspace = fs.realpathSync.native('.')
const root = path.join(workspace, 'test-results/recovery-update-native', Date.now().toString(36))
fs.mkdirSync(root, { recursive: true })
const profile = path.join(root, 'profile')
fs.mkdirSync(profile)
const identifier = 'com.markumo.recovery-update-audit'
const config = { identifier, build: { devUrl: 'http://localhost:1494' },
  app: { appDirectoriesOverride: profile, security: { devCsp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' blob: data:; connect-src 'self' ipc: http://ipc.localhost http://localhost:1494; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'" } } }
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 2))
const temp = path.join(workspace, '.markumo-dev/temp')
fs.mkdirSync(temp, { recursive: true })
const target = path.join(workspace, '.markumo-dev/target')
const buildLog = fs.createWriteStream(path.join(root, 'build.log'))
const build = spawn('cargo', ['build', '--offline', '--manifest-path', 'src-tauri/Cargo.toml'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    TEMP: temp, TMP: temp, CARGO_TARGET_DIR: target, TAURI_CONFIG: JSON.stringify(config) },
})
build.stdout.pipe(buildLog); build.stderr.pipe(buildLog)
const [code] = await once(build, 'exit')
assert.equal(code, 0, `isolated native build failed: ${root}/build.log`)
const binary = path.join(root, 'markumo-isolated.exe')
fs.copyFileSync(path.join(target, 'debug/markumo.exe'), binary)
const binaryBytes = fs.readFileSync(binary)
assert(binaryBytes.includes(Buffer.from(identifier)), 'Refusing binary without isolated app identifier')
const original = path.join(root, 'original.txt')
const diskA = 'original disk A\n', diskB = 'saved original B\n'
const textA = 'native recovery A\n', textB = textA + 'second B\n', textC = textB + 'third C\n'
const textD = textC + 'continued D\n'
fs.writeFileSync(original, diskA)
fs.writeFileSync(path.join(profile, 'editor-settings.json'), JSON.stringify({ settingsVersion: 6, autoSave: false, autoCheckUpdates: false, autoDownloadUpdates: false }))
function seedSession() {
  const canonical = path.toNamespacedPath(fs.realpathSync.native(original))
  fs.writeFileSync(path.join(profile, 'last-session.json'), JSON.stringify({ schemaVersion: 1, kind: 'single', roots: [],
    tabs: [{ path: canonical, encoding: 'UTF-8' }], activePath: canonical,
    layout: { mode: 'single', sidebarVisible: false, sidebarWidth: 240 } }))
}
seedSession()
const report = { mode: 'real Windows debug app + WebView2 + actual Rust IPC (no transport mock)',
  startedAt: new Date().toISOString(), root, binarySha256: createHash('sha256').update(binaryBytes).digest('hex'), phases: [], errors: [] }
const server = await createServer({ server: { host: 'localhost', port: 1494, strictPort: true, hmr: false, watch: null } })
await server.listen()
let active, sequence = 0, snapshotPath
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, description, timeout = 20000) {
  const end = Date.now() + timeout
  let last
  do {
    try { const result = await read(); if (result) return result } catch (error) { last = error }
    await wait(40)
  } while (Date.now() < end)
  throw Error(`${description}: timed out ${last || ''}`)
}
function records() {
  const directory = path.join(profile, 'recovery')
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{32}\.json$/.test(name))
    .map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
}
async function exact(text, id) {
  const record = await until(() => records().find(record => record.text === text && (!id || record.id === id)), `exact persisted body ${JSON.stringify(text)}`)
  assert.equal(record.checksum, createHash('sha256').update(text).digest('hex'))
  assert.equal(records().length, 1, 'continuous updates must use one snapshot ID')
  report.phases.push({ body: text, id: record.id, checksum: record.checksum })
  return record
}
async function launch() {
  const index = sequence++, port = 9740 + index
  const child = spawn(binary, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(root, `webview-${index}`),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } })
  active = { child }
  let diagnostic = ''
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8192) })
  child.stdout.on('data', () => {})
  await until(async () => {
    assert.equal(child.exitCode, null, `native app exited early: ${diagnostic}`)
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(400) })).ok } catch { return false }
  }, 'WebView2 endpoint', 30000)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  active.browser = browser
  const page = await until(() => browser.contexts().flatMap(context => context.pages()).find(page => !page.url().startsWith('devtools:')), 'WebView2 page')
  active.page = page
  page.on('pageerror', error => report.errors.push(error.message))
  await page.waitForFunction(() => document.querySelector('.app:not([inert])') && !document.querySelector('.startup-overlay'), null, { timeout: 30000 })
  report.webviewVersion = browser.version()
  report.phases.push({ launch: index, port })
  return page
}
async function crash() {
  if (!active) return
  const run = active
  active = null
  if (run.child.exitCode === null) {
    const exited = once(run.child, 'exit')
    run.child.kill('SIGKILL')
    await Promise.race([exited, wait(5000)])
  }
  await run.browser?.close().catch(() => {})
}
async function replaceEditor(page, text) {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
}
try {
  let page = await launch()
  await page.locator('.cm-content').first().waitFor()
  await replaceEditor(page, textA)
  const a = await exact(textA)
  snapshotPath = path.join(profile, 'recovery', `${a.id}.json`)
  await page.keyboard.insertText('second B\n')
  await exact(textB, a.id)
  await wait(200)
  await page.keyboard.insertText('third C\n')
  await exact(textC, a.id)
  // Real external conflict + real RecoveryService checkpoint. A previously
  // successful C must not mask a failed forced refresh of that same buffer.
  const externalDisk = 'external disk changed before reload\n'
  fs.writeFileSync(original, externalDisk)
  await page.evaluate(async () => {
    const { manager, files } = document.querySelector('#app').__vue_app__._instance.setupState
    await files.external.check(manager.activeId)
  })
  const beforeCheckpoint = fs.readFileSync(snapshotPath)
  fs.chmodSync(snapshotPath, 0o444)
  const blockedReload = await page.evaluate(async () => {
    const { manager, files } = document.querySelector('#app').__vue_app__._instance.setupState
    const id = manager.activeId
    await files.external.requestReload(id)
    const result = await files.external.confirmReload()
    return { result, text: manager.getText(id), dirty: manager.metadata(id).dirty, blocked: files.external.blocked(id) }
  })
  assert.deepEqual(blockedReload, { result: false, text: textC, dirty: true, blocked: true })
  assert.deepEqual(fs.readFileSync(snapshotPath), beforeCheckpoint)
  assert.equal(fs.readFileSync(original, 'utf8'), externalDisk)
  fs.chmodSync(snapshotPath, 0o666)
  const reloaded = await page.evaluate(async () => {
    const shell = document.querySelector('#app').__vue_app__._instance.setupState
    const { manager, files } = shell, id = manager.activeId
    await files.external.requestReload(id)
    const result = await files.external.confirmReload()
    return { result, text: manager.getText(id), dirty: manager.metadata(id).dirty, listed: shell.recoveryRecords.map(r => r.id) }
  })
  assert.deepEqual(reloaded, { result: true, text: externalDisk, dirty: false, listed: [a.id] })
  await exact(textC, a.id)
  await replaceEditor(page, 'ordinary save after external reload\n')
  await page.keyboard.press('Control+s')
  await until(() => fs.readFileSync(original, 'utf8') === 'ordinary save after external reload\n', 'normal save after reload')
  await exact(textC, a.id)
  report.phases.push({ failedExternalCheckpointPreservedLocal: true, sameTextFailureNotMasked: true,
    externalReloadSucceeded: true, checkpointSurvivedOrdinarySave: true })
  await crash()

  // Later + real original file save must leave the exact old body C untouched.
  page = await launch()
  await page.locator('.recovery-dialog').waitFor()
  await exact(textC, a.id)
  await page.getByRole('button', { name: /稍后处理|暂不处理/ }).first().click()
  await replaceEditor(page, diskB)
  await page.keyboard.press('Control+s')
  await until(() => fs.readFileSync(original, 'utf8') === diskB, 'real original file save B')
  await exact(textC, a.id)
  await page.evaluate(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.openRecovery() })
  await page.locator('.recovery-row').waitFor()
  assert.equal(await page.locator('.recovery-row').count(), 1)
  await page.screenshot({ path: path.join(root, 'later-save-preserved.png') })
  await crash()

  // Different original baseline => a pathless draft. A real readonly target
  // injects failure through Rust; an old valid JSON must not count as success.
  seedSession()
  page = await launch()
  await page.locator('.recovery-row').waitFor()
  await exact(textC, a.id)
  const before = fs.readFileSync(snapshotPath)
  fs.chmodSync(snapshotPath, 0o444)
  const restored = await page.evaluate(async () => {
    const shell = document.querySelector('#app').__vue_app__._instance.setupState
    return await shell.restoreRecovery(shell.recoveryRecords[0])
  })
  assert.equal(restored, false, 'readonly native refresh must report failure')
  assert.deepEqual(fs.readFileSync(snapshotPath), before, 'failed native refresh changed last valid bytes')
  await page.locator('.recovery-dialog .error').filter({ hasText: '快照更新未成功' }).waitFor()
  const recovered = await page.evaluate(() => {
    const { manager } = document.querySelector('#app').__vue_app__._instance.setupState
    const doc = manager.activeDocument
    return { path: doc.path, token: doc.fileToken, dirty: doc.dirty, text: manager.getText(doc.id) }
  })
  assert.equal(recovered.path, '')
  assert(!recovered.token && recovered.dirty)
  assert.equal(recovered.text, textC)
  assert.equal(fs.readFileSync(original, 'utf8'), diskB)
  report.phases.push({ nativeRestoreFailure: true, preservedBytes: true, pathlessDraft: true })
  await page.screenshot({ path: path.join(root, 'native-restore-write-failed.png') })
  fs.chmodSync(snapshotPath, 0o666)
  await page.getByRole('button', { name: /稍后处理|暂不处理/ }).first().click()
  await page.locator('.cm-content').last().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('continued D\n')
  await exact(textD, a.id)
  assert.equal(fs.readFileSync(original, 'utf8'), diskB)
  await crash()

  seedSession()
  page = await launch()
  await page.locator('.recovery-row').waitFor()
  await exact(textD, a.id)
  await page.locator('.recovery-row').getByRole('button', { name: /删除恢复稿|丢弃/ }).first().click()
  const confirmBtn = page.locator('.btn-danger-confirm')
  if (await confirmBtn.count()) {
    await confirmBtn.first().click()
  }
  await until(() => !fs.existsSync(snapshotPath), 'explicit discard removes physical snapshot')
  assert.equal(fs.readFileSync(original, 'utf8'), diskB)
  await crash()

  // Scenario 1: Original file clean, edited with textE, snapshot written with valid diskVersion.
  // Force crash, restart, baseline matches, click "打开恢复稿", dialog detaches, focus transferred.
  // Press Control+s, original file written on disk, dirty state cleared, snapshot automatically cleaned up!
  seedSession()
  page = await launch()
  await page.locator('.cm-content').first().waitFor()
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+End')
  const textE = diskB + 'extra E\n'
  await page.keyboard.insertText('extra E\n')
  const recordE = await until(() => records().find(r => r.text === textE), 'snapshot E written')
  assert.equal(recordE.path, path.toNamespacedPath(fs.realpathSync.native(original)))
  await wait(500)
  await crash()

  // Restart after crash:
  page = await launch()
  await page.locator('.recovery-dialog').waitFor()
  const rowE = page.locator('.recovery-row').first()
  assert(await rowE.innerText().then(t => t.includes('原文件存在') || t.includes('原文件完整')), 'must recognize original file')
  await rowE.getByRole('button', { name: /打开恢复稿|恢复/ }).first().click()
  await page.locator('.recovery-dialog').waitFor({ state: 'detached', timeout: 10000 })
  await until(async () => {
    return await page.evaluate(expected => {
      const { manager } = document.querySelector('#app').__vue_app__._instance.setupState
      return manager.activeDocument?.dirty && manager.activeDocument?.fileToken && manager.getText(manager.activeId) === expected
    }, textE)
  }, 'original document restored with token and dirty')

  // Direct Control+s save
  await page.keyboard.press('Control+s')
  await until(() => fs.readFileSync(original, 'utf8') === textE, 'original file updated via Control+s')
  await until(async () => {
    return await page.evaluate(() => {
      const { manager } = document.querySelector('#app').__vue_app__._instance.setupState
      return !manager.activeDocument?.dirty
    })
  }, 'document is clean after save')
  await until(() => records().length === 0, 'snapshot cleanly removed after successful save')
  report.phases.push({ restoredSaveLoopDirectControlS: true, diskUpdated: true, snapshotCleaned: true })
  await page.screenshot({ path: path.join(root, 'restored-saved-clean.png') })
  await crash()

  seedSession()
  page = await launch()
  await page.evaluate(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.openRecovery() })
  await page.locator('.recovery-dialog .empty').waitFor()
  assert.equal(records().length, 0)
  assert.deepEqual(report.errors, [])
  report.passed = true
  report.completedAt = new Date().toISOString()
  report.completedAt = new Date().toISOString()
} catch (error) {
  report.failure = String(error.stack || error)
  await active?.page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (snapshotPath && fs.existsSync(snapshotPath)) fs.chmodSync(snapshotPath, 0o666)
  await crash()
  await server.close()
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(report, null, 2))
  console.log(`Native recovery evidence: ${root}`)
}
console.log('PASS native A -> B -> C -> restart; later + save; real failed restore; continued D -> restart; explicit discard -> restart')
