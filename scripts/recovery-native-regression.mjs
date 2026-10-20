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
assert(fs.existsSync(binary), 'missing isolated recovery build')
assert(fs.readFileSync(binary).includes(Buffer.from('com.markumo.recovery-audit')), 'refusing non-isolated binary')
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
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webProfile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
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
  await run.page.getByRole('button', { name: '暂不处理' }).click()
  await run.page.locator('.recovery-dialog').waitFor({ state: 'detached' })
  await terminate(run)

  // Third launch: repeat startup must still show the record, then restore it.
  run = await launch()
  report.launches.push({ phase: 'restore', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  const rows = await run.page.locator('.recovery-row').count()
  assert(rows >= 1, 'recovery record was lost after repeated startup')
  await run.page.locator('.recovery-row').getByRole('button', { name: '恢复', exact: true }).first().click()
  await run.page.locator('.recovery-dialog').waitFor({ state: 'detached' })
  await run.page.waitForFunction(value => document.querySelector('.cm-content')?.textContent?.includes(value), marker, { timeout: 20000 })
  const dirty = await run.page.locator('.dirty-item').first().textContent()
  assert(dirty?.includes('未保存修改'), 'restored document must stay dirty')
  await terminate(run)

  // Fourth launch: the restored dirty document must have generated a new
  // snapshot, so it is offered again rather than silently becoming saved.
  run = await launch()
  report.launches.push({ phase: 'after-restore', port: run.port })
  await run.page.locator('.recovery-dialog').waitFor({ timeout: 20000 })
  assert(await run.page.locator('.recovery-row').count() >= 1, 'restored dirty content was not protected by a new snapshot')
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
