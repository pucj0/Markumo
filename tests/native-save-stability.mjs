import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Windows WebView2 + real Tauri IPC + real disk. Only disposable fixtures.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'test-results/native-save-stability')
const mode = process.argv.includes('--reproduce-watch') ? 'before' : 'after'
const require = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)
const { chromium } = require('playwright')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function appPids() {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process lightedit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).map(Number)
}
assert.deepEqual(appPids(), [], 'Close your existing desktop app before this isolated native regression.')
await mkdir(output, { recursive: true })
const data = join(output, `profile-${mode}`)
const temp = join(data, 'temp'), webview = join(data, 'webview')
await Promise.all([mkdir(temp, { recursive: true }), mkdir(webview, { recursive: true })])
const fixture = join(root, 'src-tauri', `save-stability-${Date.now()}.txt`)
await writeFile(fixture, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('开头\r\n第二行')]), { flag: 'wx' })
const env = { ...process.env, TEMP: temp, TMP: temp, WEBVIEW2_USER_DATA_FOLDER: webview,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9225', LIGHTEDIT_DEV_DATA_DIR: data, CARGO_NET_OFFLINE: 'true' }
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
env[pathKey] = join(process.env.USERPROFILE, '.cargo/bin') + ';' + env[pathKey]
let entry = join(root, 'scripts/tauri.mjs')
if (mode === 'before') {
  entry = join(output, 'watched-launcher.mjs')
  await writeFile(entry, `import {run} from '@tauri-apps/cli'; await run(${JSON.stringify(['dev', '--config', JSON.stringify({ app: { appDirectoriesOverride: data } }), '--', '--', fixture])}, 'tauri');`)
}
const child = spawn(process.execPath, [entry, ...(mode === 'after' ? ['dev', '--no-watch', '--', '--', fixture] : [])], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let logs = '', browser, page, failure
child.stdout.on('data', chunk => { logs += chunk.toString() })
child.stderr.on('data', chunk => { logs += chunk.toString() })
let exitCode
child.on('exit', code => { exitCode = code })
async function connect() {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    if (exitCode !== undefined) throw new Error(`CLI exited ${exitCode}: ${logs.slice(-1800)}`)
    try {
      const result = await fetch('http://127.0.0.1:9225/json/version')
      if (result.ok) return await chromium.connectOverCDP('http://127.0.0.1:9225')
    } catch {}
    await pause(250)
  }
  throw new Error(`WebView2 CDP timeout: ${logs.slice(-1800)}`)
}
const results = { mode, fixture, realRustIPC: true }
try {
  browser = await connect()
  for (let attempt = 0; attempt < 80; attempt++) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://localhost:1420'))
    if (page) break
    await pause(250)
  }
  assert.ok(page, 'native frontend page available')
  const editor = () => page.getByRole('textbox', { name: '文本编辑器', exact: true })
  await page.getByRole('tab', { name: /save-stability-/ }).waitFor({ timeout: 15000 })
  assert.equal(await page.evaluate(() => !!window.isTauri), true)
  const beforePid = appPids()[0]
  const beforeOrigin = await page.evaluate(() => performance.timeOrigin)
  // Keep another dirty document open while saving the real file.
  await editor().click(); await editor().press('Control+n')
  await page.keyboard.insertText('另一份未保存草稿🚀')
  const draftTab = await page.getByRole('tab').filter({ hasText: 'Untitled' }).last().getAttribute('aria-label')
  await page.getByRole('tab', { name: /save-stability-/ }).click()
  await editor().click(); await editor().press('Control+a')
  await page.keyboard.insertText('真实保存中文\n无末尾换行')
  await editor().press('Control+s')
  const expected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('真实保存中文\r\n无末尾换行')])
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await readFile(fixture)).equals(expected)) break
    await pause(100)
  }
  assert.deepEqual(await readFile(fixture), expected, 'actual disk bytes preserve BOM/CRLF/no-final-newline')
  await pause(mode === 'before' ? 12000 : 4000)
  const afterPid = appPids()[0]
  const restarted = beforePid !== afterPid || page.isClosed() || !browser.isConnected()
  Object.assign(results, { beforePid, afterPid, restarted, actualDiskBytes: 'PASS' })
  if (mode === 'before') assert.equal(restarted, true, 'reproduce default dev restart when saving under src-tauri')
  else {
    assert.equal(restarted, false, 'Rust process must remain alive with same PID')
    assert.equal(await page.evaluate(() => performance.timeOrigin), beforeOrigin, 'frontend must not reload')
    assert.equal(await page.locator('.cm-editor').count(), 1)
    const draft = page.getByRole('tab').filter({ hasText: 'Untitled' }).last()
    await draft.click()
    assert.equal(await editor().innerText(), '另一份未保存草稿🚀')
    assert.match(await page.locator('.dirty-item').innerText(), /未保存/)
    Object.assign(results, { draftTab, dirtyDraftPreserved: 'PASS', frontendReload: false })
  }
  console.log(`PASS ${mode}: ${JSON.stringify(results)}`)
} catch (error) { failure = error; results.failure = String(error); console.error(String(error)) }
finally {
  // Only our dedicated app exists (checked before launch); all its content is fixtures.
  try {
    if (!browser?.isConnected()) browser = await connect()
    const current = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://localhost:1420'))
    if (current) await current.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: 'main' }))
  } catch {}
  for (let attempt = 0; attempt < 30 && exitCode === undefined; attempt++) await pause(100)
  if (exitCode === undefined) child.kill()
  await writeFile(join(output, `${mode}.log`), logs)
  await writeFile(join(output, `${mode}.json`), JSON.stringify(results, null, 2))
  if (!appPids().length) await unlink(fixture)
}
if (failure) process.exitCode = 1
