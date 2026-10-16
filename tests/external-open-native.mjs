// Real end-to-end check of external file routing without Playwright: the release
// binary is driven through the WebView2 CDP endpoint, so tab counts, the active
// document and the editor text are read from the actual rendered DOM.
//
// The binary must be built with its own bundle identifier and an isolated app
// data directory (see 保存机制与外部文件打开修复.md), so a user's running
// LightEdit is neither joined nor disturbed.
//
// This is the only test in the repository that observes the production DOM of the
// installed application, so it also guards against render-reactivity regressions
// that unit tests cannot see.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const port = Number(process.env.LIGHTEDIT_CDP_PORT || 9241)
const executable = process.env.LIGHTEDIT_TEST_EXE || join(root, 'src-tauri/target/release/lightedit.exe')
const output = join(root, 'test-results/external-open-cdp', String(Date.now()))
const profile = join(output, 'profile')
const fixtures = join(output, 'fixtures')
// Chinese and spaces are part of the path contract.
const alpha = join(fixtures, '测试 Alpha.txt')
const beta = join(fixtures, '贝塔 Beta.md')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = [], errors = [], started = []
let socket, messageId = 0
const pending = new Map()

function testProcesses() {
  const listed = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-Process lightedit -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${executable.replace(/'/g, "''")}' } | Select-Object -ExpandProperty Id; exit 0`],
    { encoding: 'utf8' })
  return listed.stdout.trim().split(/\s+/).filter(Boolean).map(Number)
}
async function launch(args) {
  const child = spawn(executable, args, {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  })
  started.push(child.pid)
  const exited = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 30000)
    child.once('exit', code => { clearTimeout(timer); resolve(code) })
  })
  return exited
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  const listed = await response.json()
  return listed.filter(target => target.type === 'page' && /^(tauri:\/\/|https?:\/\/tauri\.localhost)/.test(target.url || ''))
}
async function connect() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      const pages = await targets()
      if (pages.length) {
        socket = new WebSocket(pages[0].webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true })
          socket.addEventListener('error', reject, { once: true })
        })
        socket.addEventListener('message', event => {
          const message = JSON.parse(event.data)
          const entry = pending.get(message.id)
          if (entry) { pending.delete(message.id); entry(message) }
        })
        return
      }
    } catch { /* WebView2 not listening yet */ }
    await pause(300)
  }
  throw new Error('CDP endpoint did not become available')
}
function send(method, params = {}) {
  const id = ++messageId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, message => {
      clearTimeout(timer)
      if (message.error) return reject(new Error(JSON.stringify(message.error)))
      resolve(message.result)
    })
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.result?.subtype === 'error') throw new Error(result.result.description || 'evaluate failed')
  return result.result?.value
}
async function waitFor(expression, seconds = 30) {
  const deadline = Date.now() + seconds * 1000
  let last
  while (Date.now() < deadline) {
    try { last = await evaluate(expression); if (last) return last } catch (error) { last = String(error) }
    await pause(250)
  }
  throw new Error(`Timed out waiting for: ${expression} (last: ${JSON.stringify(last)})`)
}
// Reads the rendered editor, never internal state, so this also proves the pane
// really re-rendered after the document changed.
const UI = `(()=>({
  tabs: Array.from(document.querySelectorAll('.tab')).map(tab => tab.querySelector('.filename')?.textContent?.trim() || ''),
  active: document.querySelector('.tab.active .filename')?.textContent?.trim() || null,
  dirty: Boolean(document.querySelector('.tab.active .unsaved')),
  editorText: document.querySelector('.cm-content')?.innerText ?? null,
  emptyPanes: document.querySelectorAll('.pane-empty').length,
  visibleEditors: Array.from(document.querySelectorAll('.editor-host')).filter(host => host.style.display !== 'none').length,
  panes: document.querySelectorAll('.pane').length,
  statusPath: document.querySelector('.status')?.innerText?.split('\\n')[0] ?? null
}))()`
const ui = () => evaluate(UI)
async function typeIntoEditor(text) {
  await evaluate(`document.querySelector('.cm-content').focus()`)
  await send('Input.insertText', { text })
  await pause(400)
}

async function test(name, run) { await run(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`) }
try {
  assert.equal(testProcesses().length, 0, 'A leftover isolated test instance is still running; stop it first.')
  await mkdir(profile, { recursive: true }); await mkdir(fixtures, { recursive: true })
  await writeFile(alpha, 'alpha original 内容\r\n')
  await writeFile(beta, '# beta 标题\r\n')
  const firstExit = await launch([alpha])
  assert.equal(firstExit, null, 'The first instance must stay running.')
  await connect()
  await waitFor('document.querySelectorAll(".cm-content").length > 0', 60)
  await pause(1000)

  await test('双击 A.txt：单文件窗口只有一个标签，编辑器可见且没有空状态', async () => {
    const current = await ui()
    assert.deepEqual(current.tabs, ['测试 Alpha.txt'], '文件关联启动必须只打开被双击的文件')
    assert.equal(current.emptyPanes, 0, '已打开文档时不得显示空编辑区')
    assert.equal(current.visibleEditors, 1, '编辑区必须可见')
    assert.equal(current.panes, 1)
    assert.ok(current.editorText.includes('alpha original'), '编辑器必须显示文件内容')
    assert.equal(current.dirty, false)
  })
  await test('重复双击同一文件：不新增窗口、不新增标签、不覆盖未保存内容', async () => {
    await typeIntoEditor('未保存的输入')
    const before = await ui()
    assert.equal(before.dirty, true, '输入后必须显示未保存标记')
    assert.ok(before.editorText.includes('未保存的输入'))
    for (let round = 0; round < 3; round++) {
      assert.equal(await launch([alpha]), 0, '第二个实例必须转发给已有实例后退出')
    }
    await pause(2000)
    const after = await ui()
    assert.deepEqual(after.tabs, before.tabs, '重复双击不得创建重复标签')
    assert.equal(after.editorText, before.editorText, '重复双击不得重新加载文件覆盖未保存修改')
    assert.equal(after.dirty, true)
    assert.equal((await targets()).length, 1, '重复双击不得创建新窗口')
  })
  await test('双击 B.md：在同一窗口成为第二个标签', async () => {
    assert.equal(await launch([beta]), 0)
    await pause(2500)
    const current = await ui()
    assert.equal((await targets()).length, 1, '打开不同文件不得创建新窗口')
    assert.deepEqual(current.tabs.slice().sort(), ['测试 Alpha.txt', '贝塔 Beta.md'].sort(), '不同文件应作为新标签加入同一窗口')
    assert.equal(current.active, '贝塔 Beta.md', '新打开的标签应被激活')
    assert.ok(current.editorText.includes('beta 标题'))
  })
  await test('并发双击同一文件：仍只有一个窗口和一组标签', async () => {
    const before = await ui()
    const exits = await Promise.all([launch([alpha]), launch([alpha]), launch([alpha]), launch([alpha])])
    for (const code of exits) assert.equal(code, 0)
    await pause(2500)
    const after = await ui()
    assert.equal((await targets()).length, 1)
    assert.deepEqual(after.tabs.slice().sort(), before.tabs.slice().sort(), '并发双击不得产生重复标签')
    assert.equal(after.active, '测试 Alpha.txt', '再次打开 A.txt 应激活它已有的标签')
  })
  await test('未保存内容仍在，磁盘文件未被写入，主会话未被污染', async () => {
    const current = await ui()
    assert.ok(current.editorText.includes('未保存的输入'), '切换到其他标签再切回不得丢失未保存内容')
    assert.equal(await readFile(alpha, 'utf8'), 'alpha original 内容\r\n', '未保存的编辑不得写入磁盘')
    assert.equal(await readFile(beta, 'utf8'), '# beta 标题\r\n')
    let owned = false
    try { owned = (await readFile(join(profile, 'com.lightedit.routetest/last-session.json'), 'utf8')).includes('Alpha') } catch { owned = false }
    assert.equal(owned, false, '文件关联窗口不得写入主会话')
  })
  assert.deepEqual(errors, [])
} catch (error) { errors.push(String(error)); console.error(String(error)) }
finally {
  if (socket) {
    try { await evaluate('window.__TAURI_INTERNALS__.invoke("plugin:window|destroy",{label:"main"})') } catch { /* already gone */ }
    socket.close()
  }
  await pause(500)
  for (const id of started) { try { process.kill(id) } catch { /* already exited */ } }
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'cdp-results.json'), JSON.stringify({ executable, results, errors, port }, null, 2))
}
console.log(`Evidence: ${output}`)
if (errors.length) { console.log(`FAILED ${errors.length} check(s)`); process.exitCode = 1 }
else console.log(`PASS ${results.length} real-DOM external-open groups`)
