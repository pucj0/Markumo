// Actual App mount with mocked Tauri IPC: toolbar placement, setting, actions,
// selection/active state, read-only, code-block context and multi-pane routing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/markdown-toolbar'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createApp } from 'vue';
import App from '/src/App.vue';
window.isTauri = true;
mockWindows('main');
const launch = { kind: 'app', ownsSession: true, files: { files: [], errors: [] }, roots: [], activePath: null,
  layout: { mode: 'single', sidebarWidth: 254, sidebarVisible: false }, warnings: [] };
mockIPC((command, args) => {
  if (command === 'plugin:event|listen') return args.handler;
  if (command === 'plugin:event|unlisten') return;
  if (command === 'load_editor_settings') return {};
  if (command === 'initialize_launch') return launch;
  if (command === 'get_recent_workspaces') return [];
  if (command === 'file_preferences') return { recent: [], layout: launch.layout };
  if (command === 'drain_pending') return { files: [], errors: [] };
  if (command === 'release_file') return;
  if (command === 'persist_session' || command === 'save_editor_settings' || command === 'persist_layout' ||
      command === 'plugin:window|set_theme' || command === 'plugin:window|destroy' || command === 'report_update_window') return;
  if (command === 'update_runtime') return { version: '1.0.4', platform: 'win32', installSupported: false };
  if (command === 'confirm_update_startup') return null;
  throw Error('Unapproved test IPC: ' + command);
});
const app = createApp(App);
app.mount('#app');
window.appTest = { app, setup: app._instance.setupState };
`)

const port = 1489
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.MARKUMO_CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const results = []
const test = async (name, work) => {
  try { await work(); results.push(name); console.log('PASS ' + name) }
  catch (error) { console.error('FAIL ' + name, error); throw error }
}
const source = () => page.evaluate(() => window.appTest.setup.manager.getText(window.appTest.setup.manager.activeId))
const newDoc = async text => {
  const id = await page.evaluate(async text => {
    const manager = window.appTest.setup.manager
    const id = manager.createUntitled('md')
    manager.dispatch(id, { changes: { from: 0, insert: text } })
    manager.setMarkdownMode(id, 'live', 'main')
    for (let i = 0; i < 120 && !manager.liveReady('main'); i++) await new Promise(resolve => setTimeout(resolve, 25))
    await new Promise(resolve => setTimeout(resolve, 80))
    return id
  }, text)
  await page.locator('[data-pane-id="main"] .md-live-toolbar').waitFor()
  return id
}
const closeMain = id => page.evaluate(id => window.appTest.setup.manager.close(id, true, 'main'), id)

try {
  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(() => window.appTest?.setup?.settingsReady, null, { timeout: 30000 })

  await test('toolbar is below tabs/breadcrumb and above the editor, only in Live mode', async () => {
    const id = await newDoc('# Title\n\nTarget paragraph.\n\n```js\ncode\n```\n')
    const geometry = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-pane-id="main"] .md-live-toolbar')
      const shell = toolbar?.parentElement
      const documentArea = shell?.querySelector('.pane-document')
      const track = document.querySelector('.pane-mode-control')
      const rect = toolbar.getBoundingClientRect(), next = documentArea.getBoundingClientRect()
      return {
        toolbar: !!toolbar,
        beforeEditor: toolbar.nextElementSibling === documentArea,
        toolbarAbove: rect.bottom <= next.top + 1,
        modeSwitchBelow: track.getBoundingClientRect().top >= rect.bottom - 1,
        modeSwitchInEditor: !!track.closest('.pane-document'),
        role: toolbar.getAttribute('role'),
        label: toolbar.getAttribute('aria-label'),
      }
    })
    assert.deepEqual(geometry, { toolbar: true, beforeEditor: true, toolbarAbove: true, modeSwitchBelow: true, modeSwitchInEditor: true, role: 'toolbar', label: 'Markdown 格式工具栏' })
    const a11y = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-pane-id="main"] .md-live-toolbar')
      return {
        select: toolbar.querySelector('select')?.getAttribute('aria-label'),
        emptyLabels: [...toolbar.querySelectorAll('button')].filter(button => !button.getAttribute('aria-label')).length,
        moreHaspopup: toolbar.querySelector('button[aria-label="更多 Markdown 操作"]')?.getAttribute('aria-haspopup'),
        moreExpanded: toolbar.querySelector('button[aria-label="更多 Markdown 操作"]')?.getAttribute('aria-expanded'),
        shortcutTitles: [...toolbar.querySelectorAll('button[title]')].filter(button => /\(.*\)/.test(button.getAttribute('title'))).length,
      }
    })
    assert.equal(a11y.select, '段落样式')
    assert.equal(a11y.emptyLabels, 0)
    assert.equal(a11y.moreHaspopup, 'menu')
    assert.equal(a11y.moreExpanded, 'false')
    assert(a11y.shortcutTitles >= 8)
    await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="加粗"]').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '斜体')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '加粗')
    await page.evaluate(id => window.appTest.setup.manager.setMarkdownMode(id, 'source', 'main'), id)
    await page.waitForFunction(() => !document.querySelector('.md-live-toolbar'))
    await page.evaluate(id => window.appTest.setup.manager.setMarkdownMode(id, 'split', 'main'), id)
    await page.waitForFunction(() => !document.querySelector('.md-live-toolbar'))
    await page.evaluate(id => window.appTest.setup.manager.setMarkdownMode(id, 'live', 'main'), id)
    await page.locator('.md-live-toolbar').waitFor()
    await closeMain(id)
  })

  await test('settings checkbox hides and restores the toolbar', async () => {
    const id = await newDoc('Target paragraph.\n')
    await page.evaluate(() => window.appTest.setup.openSettings())
    const setting = page.locator('#settings-md-toolbar')
    await setting.waitFor()
    assert.equal(await setting.isChecked(), true)
    await setting.uncheck()
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.md-live-toolbar'))
    await page.evaluate(() => window.appTest.setup.openSettings())
    await page.locator('#settings-md-toolbar').waitFor()
    assert.equal(await page.locator('#settings-md-toolbar').isChecked(), false)
    await page.locator('#settings-md-toolbar').check()
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.locator('.md-live-toolbar').waitFor()
    await closeMain(id)
  })

  await test('selection is preserved; bold state, focus, undo and redo route through canonical history', async () => {
    const id = await newDoc('# Title\n\nSelect target here.\n\nTail paragraph.\n')
    await page.locator('.md-prose h1').click()
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar select').inputValue(), '1')
    await page.locator('.md-prose p').nth(1).click()
    await page.keyboard.press('Control+a')
    const before = await source()
    const selectedBefore = await page.evaluate(() => window.appTest.setup.manager.getState(window.appTest.setup.manager.activeId).selection.main.empty)
    assert.equal(selectedBefore, false)
    await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="加粗"]').click()
    const formatted = await source()
    assert(formatted !== before && formatted.includes('**'))
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="加粗"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.md-prose')), true)
    assert.equal(await page.evaluate(() => window.appTest.setup.manager.getState(window.appTest.setup.manager.activeId).selection.main.empty), false)
    await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="撤销"]').click()
    assert.equal(await source(), before)
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="重做"]').isDisabled(), false)
    await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="重做"]').click()
    assert.equal(await source(), formatted)
    const topBefore = await page.locator('.md-live-toolbar').evaluate(el => el.getBoundingClientRect().top)
    await page.evaluate(() => { const root = document.querySelector('.markdown-live'); if (root) root.scrollTop = root.scrollHeight })
    assert.equal(await page.locator('.md-live-toolbar').evaluate(el => el.getBoundingClientRect().top), topBefore)
    await closeMain(id)
  })

  await test('code block disables rich formatting while keeping history and language selector unobstructed', async () => {
    const id = await newDoc('Intro\n\n```js\nconst x = 1\n```\n\nTail\n')
    const before = await source()
    await page.locator('.md-code-block .cm-content').click()
    await page.waitForTimeout(80)
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="加粗"]').isDisabled(), true)
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="插入链接"]').isDisabled(), true)
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar select').isDisabled(), true)
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="代码块"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="撤销"]').isDisabled(), false)
    assert.equal(await page.locator('.md-code-block').getByRole('button', { name: /^代码语言：/ }).isVisible(), true)
    const rects = await page.evaluate(() => ({ toolbar: document.querySelector('.md-live-toolbar').getBoundingClientRect(), language: document.querySelector('.md-code-block button[aria-label^="代码语言"]')?.getBoundingClientRect() }))
    assert(rects.language && rects.toolbar.bottom <= rects.language.top)
    await page.locator('[data-pane-id="main"] .md-live-toolbar button[aria-label="加粗"]').click({ force: true })
    assert.equal(await source(), before)
    await closeMain(id)
  })

  await test('read-only Markdown keeps the toolbar visible but disables formatting and history', async () => {
    const id = await page.evaluate(async () => {
      const manager = window.appTest.setup.manager
      const id = manager.openFile({ token: 'readonly-toolbar', path: '/fixtures/readonly.md', name: 'readonly.md', kind: 'text', text: '# Read only\n\nTarget.\n', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: true, version: 'v1' }, false, 'main')
      manager.setMarkdownMode(id, 'live', 'main')
      for (let i = 0; i < 120 && !manager.liveReady('main'); i++) await new Promise(resolve => setTimeout(resolve, 25))
      await new Promise(resolve => setTimeout(resolve, 80))
      return id
    })
    await page.locator('.md-live-toolbar').waitFor()
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="加粗"]').isDisabled(), true)
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="撤销"]').isDisabled(), true)
    assert.equal(await page.locator('.md-live-toolbar select').isDisabled(), true)
    await page.locator('.md-live-toolbar button[aria-label="更多 Markdown 操作"]').click()
    assert.equal(await page.locator('.md-live-more button').first().isDisabled(), true)
    await page.keyboard.press('Escape')
    await closeMain(id)
  })

  await test('two Markdown panes use independent toolbar state and route commands to their own pane', async () => {
    const a = await newDoc('Alpha target here.\n')
    const secondary = await page.evaluate(() => window.appTest.setup.manager.splitPane('right', 'main'))
    const b = await page.evaluate(secondary => {
      const manager = window.appTest.setup.manager
      const id = manager.openFile({ token: 'beta-toolbar', path: '/fixtures/beta.md', name: 'beta.md', kind: 'text', text: 'Beta target here.\n', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: 'v1' }, false, secondary)
      manager.setMarkdownMode(id, 'live', secondary)
      return { id, secondary }
    }, secondary)
    await page.waitForFunction(({ secondary }) => window.appTest.setup.manager.liveReady(secondary), { secondary })
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar').waitFor()
    assert.equal(await page.locator('.md-live-toolbar').count(), 2)
    const narrow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-pane-id="secondary"] button[aria-label="无序列表"]')).display)
    assert.equal(narrow, 'none')
    const overflow = await page.evaluate(() => { const el = document.querySelector('[data-pane-id="secondary"] .md-live-toolbar'); return el.scrollWidth <= el.clientWidth + 1 })
    assert.equal(overflow, true)
    await page.locator('[data-pane-id="secondary"] .md-prose p').first().click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar button[aria-label="加粗"]').click()
    const changed = await page.evaluate(({ a, b }) => ({ a: window.appTest.setup.manager.getText(a), b: window.appTest.setup.manager.getText(b.id) }), { a, b })
    assert(changed.b.includes('**Beta target here.**') || changed.b.includes('**Beta target here**'))
    assert.equal(changed.a, 'Alpha target here.\n')
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar button[aria-label="撤销"]').click()
    assert.equal(await page.evaluate(id => window.appTest.setup.manager.getText(id), b.id), 'Beta target here.\n')
    assert.equal(await page.evaluate(id => window.appTest.setup.manager.getText(id), a), 'Alpha target here.\n')
    await page.evaluate(id => window.appTest.setup.manager.close(id, true, 'secondary'), b.id)
    await page.evaluate(secondary => window.appTest.setup.manager.closePane(secondary), secondary)
    await closeMain(a)
  })

  await test('more menu exposes existing footnote, reference, math, TOC and YAML commands', async () => {
    const id = await newDoc('Target paragraph.\n')
    const before = await source()
    const cases = [
      ['脚注', '[^1]'],
      ['链接引用', '[1]:'],
      ['公式块', '$$'],
      ['内容目录', '[TOC]'],
      ['YAML Front Matter', 'title: ""'],
    ]
    for (const [label, marker] of cases) {
      await page.locator('.md-live-toolbar button[aria-label="更多 Markdown 操作"]').click()
      const items = await page.locator('.md-live-more button').allTextContents()
      for (const expected of ['脚注', '链接引用', '公式块', '内容目录', 'YAML Front Matter']) assert(items.includes(expected))
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await page.waitForFunction(marker => window.appTest.setup.manager.getText(window.appTest.setup.manager.activeId).includes(marker), marker)
      assert((await source()).includes(marker))
      await page.locator('.md-live-toolbar button[aria-label="撤销"]').click()
      assert.equal(await source(), before)
    }
    await closeMain(id)
  })

  assert.deepEqual(errors, [])
  console.log(`PASS all ${results.length} Markdown toolbar regressions`)
} finally {
  await browser.close()
  await server.close()
}
