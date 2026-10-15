import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Disposable fixtures, real WebView2, Rust IPC and disk. Never execute file contents.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'test-results/file-types-native', String(Date.now()))
const profile = join(output, 'profile')
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const pids = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process lightedit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'], { encoding: 'utf8' }).trim()
assert.equal(pids, '', 'Save and close existing LightEdit before running this isolated native test.')
await mkdir(profile, { recursive: true })
await writeFile(join(profile, 'editor-settings.json'), JSON.stringify({ autoSave: false }))
const paths = ['script.bat', 'script.cmd', 'notes.class', 'notes.custom', 'no-extension', 'Sample.class'].map(name => join(output, name))
const source = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文\r\noriginal')])
// Valid minimal class: Sample extends java.lang.Object, Java 8, no executable methods.
const classBytes = Buffer.from('cafebabe00000034000501000653616d706c650700010100106a6176612f6c616e672f4f626a6563740700030021000200040000000000000000', 'hex')
await Promise.all(paths.map((path, i) => writeFile(path, i === paths.length - 1 ? classBytes : source, { flag: 'wx' })))
const env = { ...process.env, LIGHTEDIT_DEV_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229', CARGO_NET_OFFLINE: 'true' }
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
env[pathKey] = join(process.env.USERPROFILE, '.cargo/bin') + ';' + env[pathKey]
const child = spawn(process.execPath, [join(root, 'scripts/tauri.mjs'), 'dev', '--no-watch', '--', '--', ...paths], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let logs = '', exitCode, browser, page, failure
child.stdout.on('data', value => { logs += value }); child.stderr.on('data', value => { logs += value })
child.on('exit', code => { exitCode = code })
const results = [], errors = []
const editor = () => page.getByRole('textbox', { name: '文本编辑器', exact: true })
async function test(name, callback) { await callback(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`) }
async function waitDisk(path, expected) {
  for (let i = 0; i < 60; i++) { if ((await readFile(path)).equals(expected)) return; await pause(100) }
  assert.deepEqual(await readFile(path), expected)
}
try {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (exitCode !== undefined) throw new Error(`Native startup failed ${exitCode}: ${logs.slice(-2000)}`)
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9229'); break } catch { await pause(250) }
  }
  assert.ok(browser, 'WebView2 debugger available')
  for (let i = 0; i < 100; i++) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://localhost:1420'))
    if (page) break
    await pause(100)
  }
  assert.ok(page); page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('tab', { name: /Sample.class/ }).waitFor({ timeout: 15000 })
  for (const path of paths.slice(0, -1)) {
    const name = path.split(/[\\/]/).pop()
    await test(`${name}: plain text, edit, undo/redo, UTF-8 BOM/CRLF save`, async () => {
      await page.getByRole('tab', { name, exact: true }).click()
      await editor().focus(); await editor().press('Control+End'); await page.keyboard.insertText('修改')
      await editor().press('Control+z'); await editor().press('Control+y'); await editor().press('Control+s')
      await waitDisk(path, Buffer.concat([source, Buffer.from('修改')]))
      assert.equal(await page.locator('.status .lang-item').inputValue(), 'Plain Text')
    })
  }
  await test('binary .class: editable Hex, actual byte save, shared panes and invalid edit protection', async () => {
    await page.getByRole('tab', { name: 'Sample.class', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.status').textContent.includes('HEX 字节'))
    const hex = await page.evaluate(() => { const m = document.querySelector('#app').__vue_app__._instance.setupState.manager; return m.saveSnapshot(m.activeId).text })
    assert.ok(hex.startsWith('CA FE BA BE'))
    await editor().focus(); await editor().press('Control+s'); await pause(300)
    assert.deepEqual(await readFile(paths.at(-1)), classBytes)
    const changed = hex.replace('00 34', '00 35')
    await editor().press('Control+a'); await page.keyboard.insertText(changed); await editor().press('Control+s')
    const expected = Buffer.from(classBytes); expected[7] = 0x35
    await waitDisk(paths.at(-1), expected)
    await page.evaluate(() => { const m = document.querySelector('#app').__vue_app__._instance.setupState.manager; m.splitEditor() })
    const editors = page.getByRole('textbox', { name: '文本编辑器', exact: true }); assert.equal(await editors.count(), 2)
    await editors.first().focus(); await editors.first().press('Control+Home'); await page.keyboard.insertText('G')
    assert.equal(await editors.last().innerText(), await editors.first().innerText())
    await editors.first().press('Control+s')
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('十六进制'))
    assert.deepEqual(await readFile(paths.at(-1)), expected)
    assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty), true)
    await editors.first().press('Control+z'); await editors.first().press('Control+s')
    await page.waitForFunction(() => !document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty)
    await page.screenshot({ path: join(output, 'editable-class.png') })
  })
  await test('recent files reopen real byte data', async () => {
    const metadata = await page.evaluate(async path => {
      const file = await window.__TAURI_INTERNALS__.invoke('open_recent', { path, encoding: null })
      await window.__TAURI_INTERNALS__.invoke('release_file', { token: file.token })
      return { encoding: file.encoding, readOnly: file.readOnly, text: file.text }
    }, await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.path))
    assert.equal(metadata.encoding, 'Hex'); assert.equal(metadata.readOnly, false); assert.ok(metadata.text.startsWith('CA FE BA BE'))
  })
  assert.deepEqual(errors, [])
} catch (error) {
  failure = error; console.error(String(error))
  try { await page?.screenshot({ path: join(output, 'failure.png') }) } catch {}
} finally {
  // Close only the isolated window this script created, whose content is disposable.
  try { if (page && browser?.isConnected()) await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: 'main' })) } catch {}
  for (let i = 0; i < 30 && exitCode === undefined; i++) await pause(100)
  if (exitCode === undefined) child.kill()
  await writeFile(join(output, 'native.log'), logs)
  await writeFile(join(output, 'results.json'), JSON.stringify({ realRustIPC: true, results, errors, failure: failure ? String(failure) : null }, null, 2))
}
if (failure) process.exitCode = 1
