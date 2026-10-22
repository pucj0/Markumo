// Native crash-recovery probe: real release app, isolated app profile, abrupt
// process termination, restart and restore. It never touches the production
// application data directory.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'

const root = path.resolve('test-results/recovery-native')
const binary = path.join(root, 'markumo-isolated.exe')
const appData = path.join(root, 'profile')
const webData = path.join(root, 'webview')
const marker = `RECOVERY_NATIVE_${Date.now()}`
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true })
assert(fs.existsSync(binary), 'missing isolated recovery build')
assert(fs.readFileSync(binary).includes(Buffer.from('com.markumo.recovery-audit')) || fs.readFileSync(binary).includes(Buffer.from('com.markumo.recovery-update-audit')), 'refusing non-isolated binary')
fs.rmSync(appData, { recursive: true, force: true })
fs.rmSync(webData, { recursive: true, force: true })
fs.mkdirSync(appData, { recursive: true })
fs.mkdirSync(webData, { recursive: true })
const report = { marker, startedAt: new Date().toISOString(), launches: [], errors: [], recoveryFiles: [] }
let sequence = 0
let active = null

async function launch() {
  const index = sequence++
  const port = 9720 + index
  const webProfile = path.join(webData, `run-${index}`)
  fs.mkdirSync(webProfile, { recursive: true })
  const child = spawn(binary, [], {
    windowsHide: true,
    stdio: 'pipe',
    // The save pipeline stages its rollback backup in the process temp dir.
    // Keep it inside this isolated profile instead of inheriting a possibly
    // restricted host TEMP.
    env: { ...process.env, TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), WEBVIEW2_USER_DATA_FOLDER: webProfile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  })
  child.on('error', error => report.errors.push(String(error)))
  let diagnostic = ''
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4096) })
  const deadline = Date.now() + 30000
  while (true) {
    if (child.exitCode !== null) throw Error(`native app exited early: ${diagnostic}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
      if (response.ok) break
    } catch { /* wait for real WebView2 endpoint */ }
    if (Date.now() > deadline) throw Error('WebView2 debug endpoint timed out')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  report.webviewVersion = browser.version()
  let page
  while (!page) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => !candidate.url().startsWith('devtools:'))
    if (!page && Date.now() > deadline) throw Error('native page timed out')
    if (!page) await new Promise(resolve => setTimeout(resolve, 25))
  }
  page.on('pageerror', error => report.errors.push(error.message))
  await page.waitForFunction(() => document.querySelector('.app:not([inert])') && !document.querySelector('.startup-overlay'), null, { timeout: 30000 })
  active = { child, browser, page, port }
  return active
}

async function terminate(run) {
  const exited = once(run.child, 'exit')
  run.child.kill('SIGKILL')
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))])
  await run.browser.close().catch(() => {})
  if (active === run) active = null
}

function recoveryFiles() {
  const dir = path.join(appData, 'recovery')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, '')))
}

// Rust canonicalizes local Windows paths to `\\?\E:\...`; the CLI argument is
// the plain form. Compare normalized paths, not raw strings.
function samePath(left, right) {
  if (!left || !right) return false
  const normalize = value => value
    .replace(/^\\\\\?\\/, '')
    .replace(/^\/\/\?\//, '')
    .replace(/\//g, '\\')
    .toLowerCase()
  return normalize(left) === normalize(right)
}

// Start the next scenario with no leftover drafts or session tabs.
function resetProfile() {
  fs.rmSync(path.join(appData, 'recovery'), { recursive: true, force: true })
  fs.rmSync(path.join(appData, 'last-session.json'), { force: true })
  fs.rmSync(path.join(appData, 'files.json'), { force: true })
}

// Put a real file in the application's recent list so it can be opened from the
// command palette inside the session-owning window (where Recovery is active).
function seedRecent(file) {
  fs.mkdirSync(appData, { recursive: true })
  const preferences = {
    recent: [{ path: file, name: path.basename(file) }],
    layout: { mode: 'single', sidebarVisible: false, sidebarWidth: 254 },
  }
  fs.writeFileSync(path.join(appData, 'files.json'), JSON.stringify(preferences), 'utf8')
}

async function openRecent(page, name) {
  await page.getByRole('menuitem', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: '最近打开', exact: true }).click()
  // The same file can appear under both its plain and verbatim path spellings;
  // either entry opens the same document.
  await page.getByRole('menuitem', { name, exact: false }).first().click()
}

try {
  // First launch: create an untitled document, type, wait for debounce, then
  // kill the process without a close handshake.
  let run = await launch()
  report.launches.push({ phase: 'edit', port: run.port })
  if (!(await run.page.locator('.cm-content').count())) {
    await run.page.getByRole('button', { name: '新建文件' }).first().click()
  }
  const editor = run.page.locator('.cm-content').first()
  await editor.waitFor()
  await editor.click()
  await run.page.keyboard.type(marker)
  await run.page.waitForTimeout(4000)
  const written = recoveryFiles()
  report.recoveryFiles = written.map(record => ({ id: record.id, name: record.name, chars: record.charCount, checksum: record.checksum.length }))
  assert(written.some(record => record.text.includes(marker)), 'recovery snapshot did not contain typed marker')
  await terminate(run)

  // Second launch: the recovery UI must appear; choosing "later" must keep it.
  run = await launch()
  report.launches.push({ phase: 'later', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  assert(await run.page.locator('.recovery-row').count() >= 1, 'recovery row missing after restart')
  await run.page.getByRole('button', { name: /稍后处理|暂不处理/ }).first().click()
  await run.page.locator('.recovery-dialog').waitFor({ state: 'detached' })
  await terminate(run)

  // Third launch: repeat startup must still show the record, then restore it.
  run = await launch()
  report.launches.push({ phase: 'restore', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  const rows = await run.page.locator('.recovery-row').count()
  assert(rows >= 1, 'recovery record was lost after repeated startup')
  await run.page.locator('.recovery-row').getByRole('button', { name: /打开恢复稿|恢复/ }).first().click()
  await run.page.locator('.recovery-dialog').waitFor({ state: 'detached' })
  await run.page.waitForFunction(value => document.querySelector('.cm-content')?.textContent?.includes(value), marker, { timeout: 20000 })
  const dirty = await run.page.locator('.dirty-item').first().textContent()
  assert(dirty?.includes('未保存修改'), 'restored document must stay dirty')
  // Scenario B, step 3: keep editing the restored draft and let the new
  // snapshot become durable before the abrupt exit.
  const restored = `${marker}-EDITED`
  const editorAfterRestore = run.page.locator('.cm-content').first()
  await editorAfterRestore.click()
  await run.page.keyboard.press('Control+End')
  await run.page.keyboard.type('-EDITED')
  await run.page.waitForTimeout(4000)
  assert(recoveryFiles().some(record => record.text.includes(restored)), 'edited restored draft was not snapshotted')
  await terminate(run)

  // Fourth launch: the newest restored text, not the older snapshot, must be
  // offered. Restore it once more and confirm the editor content.
  run = await launch()
  report.launches.push({ phase: 'after-restore', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  assert(await run.page.locator('.recovery-row').count() >= 1, 'restored dirty content was not protected by a new snapshot')
  assert(recoveryFiles().some(record => record.text.includes(restored)), 'latest restored draft is not on disk')
  await run.page.locator('.recovery-row').getByRole('button', { name: /打开恢复稿|恢复/ }).first().click()
  await run.page.locator('.recovery-dialog').waitFor({ state: 'detached' })
  await run.page.waitForFunction(value => document.querySelector('.cm-content')?.textContent?.includes(value), restored, { timeout: 20000 })
  await terminate(run)

  // Lifecycle A on a real desktop file: choose "later", then edit and save the
  // original file. The unhandled draft must survive and be offered again.
  resetProfile()
  const scenarioFile = path.join(root, 'scenario-a.txt')
  fs.writeFileSync(scenarioFile, 'A', 'utf8')
  seedRecent(scenarioFile)
  run = await launch()
  report.launches.push({ phase: 'defer-edit', port: run.port })
  // Open the original file inside the session-owning window, exactly as the
  // recent-file command does. The document then has active crash recovery.
  await openRecent(run.page, path.basename(scenarioFile))
  await run.page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'A', null, { timeout: 20000 })
  const scenarioEditor = run.page.locator('.cm-content').first()
  await scenarioEditor.click()
  await run.page.keyboard.press('Control+End')
  await run.page.keyboard.type('B')
  await run.page.waitForTimeout(4000)
  const scenarioDrafts = recoveryFiles().filter(record => samePath(record.path, scenarioFile))
  report.deferDraft = scenarioDrafts.map(record => ({ id: record.id, path: record.path, text: record.text, chars: record.charCount }))
  assert(scenarioDrafts.some(record => record.text === 'AB'), 'real-file draft was not snapshotted')
  await terminate(run)

  // Reopen the file, choose "later", edit A -> C and save normally. This is the
  // regression the old path-based auto-claim caused: onSaved() would delete the
  // unhandled B draft.
  run = await launch()
  report.launches.push({ phase: 'defer-save', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  assert(await run.page.locator('.recovery-row').count() >= 1, 'real-file draft missing after restart')
  const fileRow = run.page.locator('.recovery-row').filter({ hasText: 'scenario-a.txt' }).first()
  const fileRowText = await fileRow.innerText()
  assert(fileRowText.includes('原文件存在'), 'real-file draft was misclassified as missing or remote')
  await run.page.getByRole('button', { name: /稍后处理|暂不处理/ }).first().click()
  await run.page.locator('.recovery-dialog').waitFor({ state: 'detached' })
  // The session may already have restored the tab; otherwise open it via the
  // recent-file command. Both paths keep the document in this window.
  await openRecent(run.page, path.basename(scenarioFile))
  await run.page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'A', null, { timeout: 20000 })
  const savedEditor = run.page.locator('.cm-content').first()
  await savedEditor.click()
  await run.page.keyboard.press('Control+End')
  await run.page.keyboard.type('C')
  await run.page.waitForFunction(() => document.querySelector('.dirty-item')?.textContent?.includes('未保存修改'), null, { timeout: 20000 })
  // A focus/watcher check can briefly mark the file as "checking"; a user
  // simply repeats the save. Keep the test focused on the recovery lifecycle.
  const saveDeadline = Date.now() + 20000
  while (Date.now() < saveDeadline && fs.readFileSync(scenarioFile, 'utf8') !== 'AC') {
    await run.page.keyboard.press('Control+s')
    await run.page.waitForTimeout(700)
  }
  assert(fs.readFileSync(scenarioFile, 'utf8') === 'AC', 'ordinary save did not write the original file')
  const retained = recoveryFiles().filter(record => samePath(record.path, scenarioFile))
  report.retainedDraft = retained.map(record => ({ id: record.id, path: record.path, text: record.text }))
  assert(retained.some(record => record.text === 'AB'), 'ordinary save deleted the unclaimed real-file draft')
  await terminate(run)

  // Repeated restart still offers the untouched draft.
  run = await launch()
  report.launches.push({ phase: 'defer-restart', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  const finalRows = await run.page.locator('.recovery-row').count()
  assert(finalRows >= 1, 'unclaimed real-file draft was lost after another restart')
  const finalRowText = await run.page.locator('.recovery-row').filter({ hasText: 'scenario-a.txt' }).first().innerText()
  assert(finalRowText.includes('磁盘内容已变化') && !finalRowText.includes('原文件已删除'), 'real-file draft lost its valid disk association')
  assert(recoveryFiles().some(record => samePath(record.path, scenarioFile) && record.text === 'AB'), 'real-file draft content changed or disappeared')
  report.deferRestartRows = finalRows
  await terminate(run)
  report.passed = true
  report.completedAt = new Date().toISOString()
} catch (error) {
  report.failure = String(error.stack || error)
  throw error
} finally {
  if (active) {
    active.child.kill('SIGKILL')
    await active.browser.close().catch(() => {})
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(report, null, 2))
}
console.log(`PASS native crash recovery ${marker}`)
