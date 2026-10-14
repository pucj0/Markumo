import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const require = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.LIGHTEDIT_TEST_BROWSER || undefined })
const url = process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1420'
const output = 'test-results/phase3'
const results = [], errors = []
let page
await mkdir(output, { recursive: true })
const editor = () => page.getByRole('textbox', { name: '文本编辑器', exact: true })
async function openFileMenu() { await page.locator('[role=menubar]').getByRole('menuitem', { name: '文件', exact: true }).click(); return page.getByRole('menuitem', { name: '打开文件', exact: true }) }
async function contents(text) {
  await editor().click(); await editor().press('Control+a'); await page.keyboard.insertText(text)
  await page.waitForFunction(expected => document.querySelector('.status').textContent.includes(`${expected.toLocaleString()} 字符`), text.length)
}
async function nativeStub() {
  // Explicit IPC contract fixture, never a real disk/native-dialog test.
  await page.addInitScript(() => {
    const callbacks = new Map(), listeners = new Map()
    let next = 0
    const file = { token: 'fixture-1', path: 'E:\\fixtures\\中文.md', name: '中文.md', text: '# 中文\r\n正文',
      encoding: 'UTF-8', bom: true, eol: 'CRLF', readOnly: false, version: 'disk-1' }
    const contract = { calls: [], destroyed: false, failure: false, cancel: false, hold: false, releaseSave: null,
      pending: [], recent: [], layout: { mode: 'single', sidebarVisible: false, sidebarWidth: 254 },
      emit: async event => { for (const [id, listener] of listeners) if (listener.event === event) await callbacks.get(listener.handler)({ event, id, payload: null }) },
      queue: () => { contract.pending.push({ ...file }); return contract.emit('files-pending') },
    }
    window.fileContract = contract
    window.isTauri = true
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => listeners.delete(id) }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: callback => { const id = ++next; callbacks.set(id, callback); return id },
      unregisterCallback: id => callbacks.delete(id),
      invoke: async (command, args) => {
        contract.calls.push({ command, args })
        if (command === 'plugin:event|listen') { const id = ++next; listeners.set(id, args); return id }
        if (command === 'plugin:event|unlisten') return listeners.delete(args.eventId)
        if (command === 'plugin:window|destroy') { contract.destroyed = true; return }
        if (command === 'plugin:window|set_theme') return
        if (command === 'file_preferences') return { recent: contract.recent, layout: contract.layout }
        // Explicit-save/dirty cases are independent of automatic-save coverage.
        if (command === 'load_editor_settings') return { defaultMdMode: 'source', autoSave: false }
        if (command === 'save_editor_settings') return
        if (command === 'restore_workspace_folders') return []
        if (command === 'persist_layout') { contract.layout = args.layout; return }
        if (command === 'drain_pending') { const files = contract.pending.splice(0); return { files, errors: [] } }
        if (command === 'open_dialog') { contract.recent = [{ path: file.path, name: file.name }]; return { files: [{ ...file }], errors: [] } }
        if (command === 'open_recent' || command === 'reopen_file') return { ...file, token: 'fixture-reopened' }
        if (command === 'save_dialog') return contract.cancel ? null : { token: 'target-1', path: 'E:\\fixtures\\saved.txt', version: null }
        if (command === 'save_file') {
          if (contract.hold) await new Promise(done => { contract.releaseSave = done })
          if (contract.failure) throw { code: 'conflict', message: '磁盘冲突，已阻止覆盖' }
          return { ...file, token: args.token, path: args.token === 'target-1' ? 'E:\\fixtures\\saved.txt' : file.path,
            name: args.token === 'target-1' ? 'saved.txt' : file.name, encoding: args.encoding, bom: args.bom, version: 'disk-2' }
        }
        if (command === 'release_file') return
        throw new Error(`unexpected IPC: ${command}`)
      },
    }
  })
}
async function test(name, stub, run) {
  page = await browser.newPage({ viewport: { width: 1200, height: 780 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  if (stub) await nativeStub()
  await page.goto(url); await editor().waitFor()
  if (stub) await page.waitForFunction(() => window.fileContract.calls.some(call => call.command === 'drain_pending'))
  await run(); results.push({ name, result: 'PASS', scope: stub ? 'browser + IPC contract stub; no Rust/disk' : 'browser' })
  console.log(`PASS ${name}`); await page.close()
}
try {
  await test('普通启动为单文件草稿；浏览器禁用磁盘按钮并保留 dirty 关闭保护', false, async () => {
    assert.equal(await page.getByRole('tab').count(), 1)
    assert.equal(await page.locator('.sidebar-wrapper').count(), 0)
    assert.equal(await (await openFileMenu()).isDisabled(), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: '保存文件', exact: true }).isDisabled(), true)
    await contents('中文草稿🚀\n无末尾换行'); await editor().press('Control+s')
    await page.getByRole('status').filter({ hasText: '浏览器仅支持内存编辑' }).waitFor()
    await page.getByRole('button', { name: '关闭 Untitled-1.txt' }).click()
    assert.equal(await page.getByRole('button', { name: '保存并关闭' }).isDisabled(), true)
    await page.getByRole('button', { name: '继续编辑' }).click()
    assert.match(await editor().innerText(), /中文草稿🚀/)
    for (const width of [1200, 800, 680]) {
      await page.setViewportSize({ width, height: 780 })
      const overflow = await page.evaluate(() => document.querySelector('.topbar').scrollWidth > document.querySelector('.topbar').clientWidth)
      assert.equal(overflow, false)
      await page.screenshot({ path: `${output}/single-${width}.png`, animations: 'disabled' })
    }
  })
  await test('IPC 契约：打开、重复打开保护、CRLF/BOM 保存、最近文件与布局', true, async () => {
    await (await openFileMenu()).click()
    await page.getByRole('tab', { name: /中文.md/ }).waitFor()
    await page.getByRole('button', { name: '源码', exact: true }).click()
    assert.match(await editor().innerText(), /# 中文/)
    await editor().press('Control+End'); await page.keyboard.insertText('修改')
    await editor().press('Control+o')
    await page.waitForFunction(() => window.fileContract.calls.filter(call => call.command === 'open_dialog').length === 2)
    assert.equal(await page.getByRole('tab', { name: /中文.md/ }).count(), 1)
    assert.match(await editor().innerText(), /修改/)
    await editor().press('Control+s')
    await page.waitForFunction(() => document.querySelector('.dirty-item').textContent === '已保存')
    const save = await page.evaluate(() => window.fileContract.calls.find(call => call.command === 'save_file'))
    assert.equal(save.args.text, '# 中文\r\n正文修改'); assert.equal(save.args.bom, true); assert.equal(save.args.expectedVersion, 'disk-1')
    await page.getByRole('button', { name: '工作区', exact: true }).click()
    await page.locator('[role=menubar]').getByRole('menuitem',{name:'文件',exact:true}).click()
    const recent = page.getByRole('menuitem',{name:'最近：中文.md',exact:true})
    await recent.waitFor()
    assert.match(await recent.innerText(), /中文.md/)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.fileContract.calls.some(call => call.command === 'persist_layout' && call.args.layout.mode === 'workspace'))
  })
  await test('IPC 契约：取消另存为和冲突保留内容；保存并关闭失败保持弹窗', true, async () => {
    await contents('未保存内容')
    await page.evaluate(() => { window.fileContract.cancel = true })
    await editor().press('Control+s')
    await page.waitForFunction(() => window.fileContract.calls.some(call => call.command === 'save_dialog'))
    assert.match(await page.locator('.dirty-item').innerText(), /未保存/)
    await page.evaluate(() => { window.fileContract.cancel = false; window.fileContract.failure = true })
    await page.getByRole('button', { name: '关闭 Untitled-1.txt' }).click()
    await page.getByRole('button', { name: '保存并关闭' }).click()
    await page.getByRole('status').filter({ hasText: '磁盘冲突' }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: '未保存修改确认' }).isVisible(), true)
    assert.equal(await page.getByRole('tab').count(), 1)
    await page.getByRole('button', { name: '继续编辑' }).click(); assert.equal(await editor().innerText(), '未保存内容')
  })
  await test('IPC 契约：保存期间继续输入仍 dirty；窗口关闭可取消、保存后关闭', true, async () => {
    await (await openFileMenu()).click()
    await page.getByRole('tab', { name: /中文.md/ }).waitFor()
    await contents('快照'); await page.evaluate(() => { window.fileContract.hold = true })
    await editor().press('Control+s')
    await page.waitForFunction(() => window.fileContract.releaseSave !== null)
    await page.keyboard.insertText('后续输入')
    await page.evaluate(() => { window.fileContract.hold = false; window.fileContract.releaseSave() })
    await page.waitForFunction(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return s.manager.activeDocument.lastDiskVersion === 'disk-2' && !s.fileBusy })
    assert.match(await page.locator('.dirty-item').innerText(), /未保存/)
    await page.evaluate(() => window.fileContract.emit('tauri://close-requested'))
    await page.getByRole('dialog', { name: '未保存修改确认' }).waitFor()
    assert.equal(await page.evaluate(() => window.fileContract.destroyed), false)
    await page.getByRole('button', { name: '继续编辑' }).click()
    await page.evaluate(() => window.fileContract.emit('tauri://close-requested'))
    await page.getByRole('button', { name: '保存并关闭' }).click()
    await page.waitForFunction(() => window.fileContract.destroyed)
    const saves = await page.evaluate(() => window.fileContract.calls.filter(call => call.command === 'save_file'))
    assert.equal(saves[1].args.text, '快照后续输入')
  })
  await test('IPC 契约：外部打开事件经待处理队列打开，关闭释放文件授权', true, async () => {
    await page.evaluate(() => window.fileContract.queue())
    await page.getByRole('tab', { name: /中文.md/ }).waitFor()
    await page.getByRole('button', { name: '关闭 中文.md' }).click()
    await page.waitForFunction(() => window.fileContract.calls.some(call => call.command === 'release_file' && call.args.token === 'fixture-1'))
    assert.equal(await page.getByRole('tab', { name: /中文.md/ }).count(), 0)
  })
  assert.deepEqual(errors, [])
  await writeFile(`${output}/results.json`, JSON.stringify({ url, browser: browser.version(), results, errors, nativeDiskTests: 'NOT RUN' }, null, 2))
  console.log(`PASS ${results.length} groups; errors: 0; Rust/disk NOT RUN`)
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, animations: 'disabled' })
  await writeFile(`${output}/results.json`, JSON.stringify({ url, results, errors, failure: String(error) }, null, 2))
  throw error
} finally { await browser.close() }
