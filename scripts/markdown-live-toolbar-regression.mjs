// Actual App mount with mocked Tauri IPC: Nomo-inspired toolbar geometry,
// mode switch, formatting, table picker, width/search/outline, collapse,
// responsive pane routing, read-only and code-block isolation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/markdown-toolbar'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import '/src/styles/main.css';
import '/src/editor/markdown/styles.css';
import '/src/editor/core/searchPanel.css';
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
  if (command === 'recovery_list') return { records: [], warnings: [] };
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
const activeSelection = () => page.evaluate(() => {
  const selection = window.appTest.setup.manager.getState(window.appTest.setup.manager.activeId).selection.main
  return { from: selection.from, to: selection.to, empty: selection.empty }
})

try {
  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(() => window.appTest?.setup?.settingsReady, null, { timeout: 30000 })

  await test('toolbar uses a 44px full-width Nomo-style row with left groups and right utilities', async () => {
    const id = await newDoc('# Title\n\nTarget paragraph.\n\n```js\ncode\n```\n')
    const geometry = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-pane-id="main"] .md-live-toolbar')
      const documentArea = document.querySelector('[data-pane-id="main"] .pane-document')
      const buttons = [...toolbar.querySelectorAll('.md-toolbar-btn')]
      const icons = [...toolbar.querySelectorAll('.md-toolbar-icon')]
      const rect = toolbar.getBoundingClientRect(), next = documentArea.getBoundingClientRect()
      return {
        height: rect.height,
        width: Math.round(rect.width),
        paneWidth: Math.round(documentArea.getBoundingClientRect().width),
        beforeEditor: toolbar.parentElement?.nextElementSibling === documentArea,
        toolbarAbove: rect.bottom <= next.top + 1,
        modeInToolbar: !!toolbar.querySelector('.md-mode-switcher'),
        oldModeControl: document.querySelectorAll('.pane-mode-control').length,
        minButton: Math.min(...buttons.map(button => button.getBoundingClientRect().width)),
        minButtonHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
        iconSize: toolbar.querySelector('.md-toolbar-format .md-toolbar-icon')?.getBoundingClientRect().width,
        overflow: toolbar.scrollWidth <= toolbar.clientWidth + 1,
        groups: [...toolbar.children].filter(element => element.classList.contains('md-toolbar-group')).map(element => element.className),
        utilityClasses: [...toolbar.querySelector('.md-toolbar-utilities').children].map(element => element.className),
        headingText: toolbar.querySelector('.md-toolbar-heading-btn')?.textContent?.trim(),
      }
    })
    assert.equal(geometry.height, 44)
    assert.equal(geometry.width, geometry.paneWidth)
    assert.equal(geometry.beforeEditor, true)
    assert.equal(geometry.toolbarAbove, true)
    assert.equal(geometry.modeInToolbar, true)
    assert.equal(geometry.oldModeControl, 0)
    assert.equal(geometry.minButton, 32)
    assert.equal(geometry.minButtonHeight, 32)
    assert.equal(geometry.iconSize, 17)
    assert.equal(geometry.overflow, true)
    assert.equal(geometry.headingText, 'H1')
    assert(geometry.groups.some(value => value.includes('md-toolbar-format')))
    assert(geometry.groups.some(value => value.includes('md-toolbar-lists')))
    assert(geometry.groups.some(value => value.includes('md-toolbar-insert')))
    assert(geometry.groups.some(value => value.includes('md-toolbar-more-group')))
    assert(geometry.utilityClasses.some(value => value.includes('md-toolbar-search')))
    assert(geometry.utilityClasses.some(value => value.includes('md-toolbar-width')))
    assert(geometry.utilityClasses.some(value => value.includes('md-mode-switcher')))
    assert(geometry.utilityClasses.some(value => value.includes('md-toolbar-outline')))
    assert(geometry.utilityClasses.some(value => value.includes('md-toolbar-collapse')))
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="撤销"],.md-live-toolbar button[aria-label="重做"]').count(), 0)

    const a11y = await page.evaluate(() => {
      const toolbar = document.querySelector('.md-live-toolbar')
      return {
        heading: toolbar.querySelector('.md-toolbar-heading-btn')?.getAttribute('aria-label'),
        emptyLabels: [...toolbar.querySelectorAll('button')].filter(button => !button.getAttribute('aria-label')).length,
        moreHaspopup: toolbar.querySelector('button[aria-label="更多 Markdown 操作"]')?.getAttribute('aria-haspopup'),
        moreExpanded: toolbar.querySelector('button[aria-label="更多 Markdown 操作"]')?.getAttribute('aria-expanded'),
        shortcutTitles: [...toolbar.querySelectorAll('button[title]')].filter(button => /\(.*\)/.test(button.getAttribute('title'))).length,
        modeLabels: [...toolbar.querySelectorAll('.md-mode-switcher button')].map(button => button.getAttribute('aria-label')),
      }
    })
    assert.equal(a11y.heading, '段落样式')
    assert.equal(a11y.emptyLabels, 0)
    assert.equal(a11y.moreHaspopup, 'menu')
    assert.equal(a11y.moreExpanded, 'false')
    assert(a11y.shortcutTitles >= 8)
    assert.deepEqual(a11y.modeLabels, ['实时排版模式', '源码模式', '双栏模式'])
    await page.locator('.md-live-toolbar button[aria-label="加粗"]').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '斜体')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '加粗')

    await page.locator('.md-live-toolbar [aria-label="源码模式"]').click()
    await page.waitForFunction(() => window.appTest.setup.manager.getMarkdownMode(window.appTest.setup.manager.activeId) === 'source')
    const sourceSlider = await page.locator('.md-mode-slider').evaluate(el => getComputedStyle(el).transform)
    assert.notEqual(sourceSlider, 'none')
    assert.equal(await page.locator('.md-live-toolbar').count(), 1)
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="加粗"]').isDisabled(), false)
    assert.equal(await page.locator('.md-live-toolbar [aria-label="源码模式"]').getAttribute('aria-pressed'), 'true')
    await page.locator('.md-live-toolbar [aria-label="实时排版模式"]').click()
    await page.waitForFunction(() => window.appTest.setup.manager.liveReady('main'), null, { timeout: 60000 })
    await closeMain(id)
  })

  await test('settings checkbox hides and restores the Markdown toolbar', async () => {
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

  await test('selection, heading menu, active state, focus and keyboard undo/redo stay canonical', async () => {
    const id = await newDoc('# Title\n\nSelect target here.\n\nTail paragraph.\n')
    await page.locator('.md-prose h1').click()
    assert.equal((await page.locator('.md-toolbar-heading-btn').textContent()).trim(), 'H1')
    await page.locator('.md-toolbar-heading-btn').click()
    await page.getByRole('menuitemradio', { name: '正文', exact: true }).click()
    assert.equal((await page.locator('.md-toolbar-heading-btn').textContent()).trim(), '正文')
    await page.locator('.md-toolbar-heading-btn').click()
    await page.getByRole('menuitemradio', { name: 'H1', exact: true }).click()
    assert.equal((await page.locator('.md-toolbar-heading-btn').textContent()).trim(), 'H1')
    await page.locator('.md-prose p').nth(1).click()
    await page.keyboard.press('Control+a')
    const before = await source()
    assert.equal((await activeSelection()).empty, false)
    await page.locator('.md-live-toolbar button[aria-label="加粗"]').click()
    const formatted = await source()
    assert(formatted !== before && formatted.includes('**'))
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="加粗"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.md-prose')), true)
    assert.equal((await activeSelection()).empty, false)
    await page.keyboard.press('Control+z')
    assert.equal(await source(), before)
    await page.keyboard.press('Control+Shift+z')
    assert.equal(await source(), formatted)
    const topBefore = await page.locator('.md-live-toolbar').evaluate(el => el.getBoundingClientRect().top)
    await page.evaluate(() => { const root = document.querySelector('.markdown-live'); if (root) root.scrollTop = root.scrollHeight })
    assert.equal(await page.locator('.md-live-toolbar').evaluate(el => el.getBoundingClientRect().top), topBefore)
    await closeMain(id)
  })

  await test('visual table picker inserts the hovered row/column size as one isolated edit', async () => {
    const id = await newDoc('Intro\n\nTail\n')
    const before = await source()
    await page.locator('.md-live-toolbar button[aria-label="插入表格"]').click()
    await page.locator('.md-table-picker').waitFor()
    assert.equal(await page.locator('.md-table-picker-grid .md-table-picker-cell').count(), 30)
    await page.locator('.md-table-picker-cell[aria-label="插入 4 行 5 列表格"]').hover()
    assert.equal((await page.locator('.md-table-picker-head strong').textContent()).trim(), '4 × 5')
    await page.locator('.md-table-picker-cell[aria-label="插入 4 行 5 列表格"]').click()
    const table = await source()
    const tableLines = table.split('\n').filter(line => line.startsWith('|'))
    assert.equal(tableLines.length, 5)
    assert.equal(tableLines[0].split('|').length, 7)
    assert(/^\| --- \| --- \| --- \| --- \| --- \|$/m.test(table))
    await page.keyboard.press('Control+z')
    assert.equal(await source(), before)
    await closeMain(id)
  })

  await test('code blocks disable rich formatting but keep mode/search/collapse and the language selector unobstructed', async () => {
    const id = await newDoc('Intro\n\n```js\nconst x = 1\n```\n\nTail\n')
    const before = await source()
    await page.locator('.md-code-block .cm-content').click()
    await page.waitForTimeout(80)
    for (const label of ['加粗', '斜体', '删除线', '行内代码', '插入链接', '插入图片', '插入表格', '插入代码块', '插入数学公式']) {
      assert.equal(await page.locator(`.md-live-toolbar button[aria-label="${label}"]`).isDisabled(), true, label)
    }
    assert.equal(await page.locator('.md-toolbar-heading-btn').isDisabled(), true)
    assert.equal(await page.locator('.md-live-toolbar [aria-label="实时排版模式"]').isDisabled(), false)
    assert.equal(await page.locator('.md-code-block').getByRole('button', { name: /^代码语言：/ }).isVisible(), true)
    const rects = await page.evaluate(() => ({ toolbar: document.querySelector('.md-live-toolbar').getBoundingClientRect(), language: document.querySelector('.md-code-block button[aria-label^="代码语言"]')?.getBoundingClientRect() }))
    assert(rects.language && rects.toolbar.bottom <= rects.language.top)
    await page.locator('.md-live-toolbar button[aria-label="加粗"]').click({ force: true })
    assert.equal(await source(), before)
    await closeMain(id)
  })

  await test('read-only Markdown keeps navigation utilities available and disables mutations', async () => {
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
    assert.equal(await page.locator('.md-toolbar-heading-btn').isDisabled(), true)
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="搜索与替换"]').isDisabled(), false)
    assert.equal(await page.locator('.md-live-toolbar [aria-label="实时排版模式"]').isDisabled(), false)
    await page.locator('.md-live-toolbar button[aria-label="更多 Markdown 操作"]').click()
    assert.equal(await page.locator('.md-more-menu button').first().isDisabled(), true)
    await page.keyboard.press('Escape')
    await closeMain(id)
  })

  await test('table picker and width popover close on viewport resize and window blur without losing selection', async () => {
    const id = await newDoc('Target paragraph.\n')
    await page.locator('.md-prose p').click()
    await page.keyboard.press('Control+a')
    const selection = await activeSelection()
    await page.locator('.md-live-toolbar button[aria-label="插入表格"]').click()
    await page.locator('.md-table-picker').waitFor()
    await page.setViewportSize({ width: 980, height: 700 })
    await page.waitForFunction(() => !document.querySelector('.md-table-picker'))
    await page.setViewportSize({ width: 1200, height: 850 })
    await page.locator('.md-live-toolbar button[aria-label="内容宽度"]').click()
    await page.locator('.md-width-popover').waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => !document.querySelector('.md-width-popover'))
    assert.deepEqual(await activeSelection(), selection)
    await closeMain(id)
  })

  await test('right-side search, width, outline and collapse work without moving the editor selection', async () => {
    const id = await newDoc('# Title\n\nTarget paragraph.\n')
    await page.locator('.md-live-toolbar button[aria-label="内容宽度"]').click()
    const range = page.locator('.md-width-popover input[type="range"]')
    await range.evaluate(input => { input.value = '1020'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    assert.equal(await page.evaluate(() => window.appTest.setup.manager.getMarkdownTypography().width), 1020)
    await page.keyboard.press('Escape')
    await page.locator('.md-live-toolbar button[aria-label="搜索与替换"]').click()
    await page.waitForFunction(() => !!(document.querySelector('.md-live-search') || document.querySelector('.fleet-search')))
    await page.keyboard.press('Escape')
    await page.locator('.md-live-toolbar button[aria-label="显示大纲"]').click()
    await page.locator('.outline-sidebar').waitFor()
    await page.locator('.md-live-toolbar button[aria-label="隐藏大纲"]').click()
    await page.waitForFunction(() => !document.querySelector('.outline-sidebar'))
    await page.locator('.md-prose p').click()
    await page.keyboard.press('Control+a')
    const selection = await activeSelection()
    await page.locator('.md-live-toolbar button[aria-label="折叠 Markdown 工具栏"]').click()
    await page.waitForFunction(() => !document.querySelector('.md-live-toolbar'))
    assert.equal(await page.locator('.md-toolbar-reveal').isVisible(), true)
    assert.deepEqual(await activeSelection(), selection)
    await page.locator('.md-toolbar-reveal').click()
    await page.locator('.md-live-toolbar').waitFor()
    assert.deepEqual(await activeSelection(), selection)
    await closeMain(id)
  })

  await test('math button opens a real secondary menu with only the supported block formula', async () => {
    const id = await newDoc('Target paragraph.\n')
    const before = await source()
    await page.locator('.md-live-toolbar button[aria-label="插入数学公式"]').click()
    await page.locator('.md-math-menu').waitFor()
    assert.equal(await page.locator('.md-math-menu [role="menuitem"]').count(), 1)
    assert.match(await page.locator('.md-math-menu').innerText(), /公式块/)
    await page.locator('.md-math-menu [role="menuitem"]').click()
    await page.waitForFunction(() => window.appTest.setup.manager.getText(window.appTest.setup.manager.activeId).includes('$$'))
    await page.keyboard.press('Control+z')
    assert.equal(await source(), before)
    await page.locator('.md-live-toolbar [aria-label="源码模式"]').click()
    await page.waitForFunction(() => window.appTest.setup.manager.getMarkdownMode(window.appTest.setup.manager.activeId) === 'source')
    assert.equal(await page.locator('.md-live-toolbar button[aria-label="插入数学公式"]').isDisabled(), true)
    await page.locator('.md-live-toolbar [aria-label="实时排版模式"]').click()
    await page.waitForFunction(() => window.appTest.setup.manager.liveReady('main'), null, { timeout: 60000 })
    await closeMain(id)
  })

  await test('two Markdown panes keep independent segmented modes, responsive groups and target routing', async () => {
    const a = await newDoc('Alpha target here.\n')
    const secondary = await page.evaluate(() => window.appTest.setup.manager.splitPane('right', 'main'))
    const b = await page.evaluate(secondary => {
      const manager = window.appTest.setup.manager
      const id = manager.openFile({ token: 'beta-toolbar', path: '/fixtures/beta.md', name: 'beta.md', kind: 'text', text: 'Beta target here.\n', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false, version: 'v1' }, false, secondary)
      manager.setMarkdownMode(id, 'live', secondary)
      return { id, secondary }
    }, secondary)
    await page.waitForFunction(secondary => window.appTest.setup.manager.liveReady(secondary), secondary)
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar').waitFor()
    assert.equal(await page.locator('.md-live-toolbar').count(), 2)
    const responsive = await page.evaluate(() => {
      const pane = document.querySelector('[data-pane-id="secondary"]')
      return {
        lists: getComputedStyle(pane.querySelector('.md-toolbar-lists')).display,
        insert: getComputedStyle(pane.querySelector('.md-toolbar-insert')).display,
        format: getComputedStyle(pane.querySelector('.md-toolbar-format')).display,
        overflow: pane.querySelector('.md-live-toolbar').scrollWidth <= pane.querySelector('.md-live-toolbar').clientWidth + 1,
      }
    })
    assert.deepEqual(responsive, { lists: 'none', insert: 'none', format: 'flex', overflow: true })
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar [aria-label="源码模式"]').click()
    await page.waitForFunction(secondary => window.appTest.setup.manager.getMarkdownMode(window.appTest.setup.manager.activeId, secondary) === 'source', secondary)
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar [aria-label="实时排版模式"]').click()
    await page.waitForFunction(secondary => window.appTest.setup.manager.liveReady(secondary), secondary)
    await page.locator('[data-pane-id="secondary"] .md-prose p').first().click()
    await page.keyboard.press('Control+a')
    await page.locator('[data-pane-id="secondary"] .md-live-toolbar button[aria-label="加粗"]').click()
    const changed = await page.evaluate(({ a, b }) => ({ a: window.appTest.setup.manager.getText(a), b: window.appTest.setup.manager.getText(b.id) }), { a, b })
    assert(changed.b.includes('**Beta target here.**') || changed.b.includes('**Beta target here**'))
    assert.equal(changed.a, 'Alpha target here.\n')
    await page.keyboard.press('Control+z')
    assert.equal(await page.evaluate(id => window.appTest.setup.manager.getText(id), b.id), 'Beta target here.\n')
    await page.evaluate(id => window.appTest.setup.manager.close(id, true, 'secondary'), b.id)
    await page.evaluate(secondary => window.appTest.setup.manager.closePane(secondary), secondary)
    await closeMain(a)
  })

  await test('More exposes only supported commands and keeps a bounded, blur-safe popover', async () => {
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
      const items = await page.locator('.md-more-menu button').allTextContents()
      for (const expected of ['脚注', '链接引用', '公式块', '内容目录', 'YAML Front Matter']) assert(items.some(item => item.includes(expected)), expected)
      const rect = await page.locator('.md-more-menu').boundingBox()
      assert(rect && rect.x >= 0 && rect.x + rect.width <= 1200)
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await page.waitForFunction(marker => window.appTest.setup.manager.getText(window.appTest.setup.manager.activeId).includes(marker), marker)
      await page.keyboard.press('Control+z')
      assert.equal(await source(), before)
    }
    await page.locator('.md-live-toolbar button[aria-label="更多 Markdown 操作"]').click()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => !document.querySelector('.md-more-menu'))
    await closeMain(id)
  })

  assert.deepEqual(errors, [])
  console.log(`PASS all ${results.length} Markdown toolbar regressions`)
} finally {
  await browser.close()
  await server.close()
}
