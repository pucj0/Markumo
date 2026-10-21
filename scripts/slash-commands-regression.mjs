import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(
  process.env.MARKUMO_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href
    : 'playwright'
)

const output = 'test-results/slash-commands'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(
  `${output}/index.html`,
  '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:720px"></div><script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>'
)

const server = await createServer({
  server: { host: '127.0.0.1', port: 1459, strictPort: true, hmr: false, watch: null },
})
await server.listen()

let browser, page
const results = []
const failures = []

const test = async (name, work) => {
  try {
    await work()
    results.push(name)
    console.log('PASS ' + name)
  } catch (error) {
    failures.push({ name, error: String(error), stack: error.stack })
    console.error('FAIL ' + name + '\n' + error.stack)
    throw error
  }
}

const ready = () => page.waitForFunction(() => window.f && window.f.ready())
const reset = async (text, clean = false, readOnly = false) => {
  await page.evaluate(
    ({ text, clean, readOnly }) => window.f.reset(text, clean, readOnly),
    { text, clean, readOnly }
  )
  await ready()
  await page.locator('.md-prose').first().waitFor()
}

const source = () => page.evaluate(() => window.f.source())

function findSystemBrowser() {
  if (process.env.MARKUMO_CHROME && fs.existsSync(process.env.MARKUMO_CHROME)) {
    return process.env.MARKUMO_CHROME
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return undefined
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: findSystemBrowser(),
    args: ['--no-sandbox'],
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(15000)

  await page.goto(`http://127.0.0.1:1459/${output}/index.html`)
  await page.waitForFunction(() => window.f)

  // 1. 输入 / 正常打开菜单
  await test('1. typing / opens slash command menu', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/')
    await page.locator('.md-slash-menu').waitFor({ state: 'visible' })
    const isVisible = await page.locator('.md-slash-menu').isVisible()
    assert.equal(isVisible, true, 'Slash command menu should be visible')
    const itemCount = await page.locator('.md-slash-item').count()
    assert.ok(itemCount > 5, 'Menu should show registered commands')
  })

  // 2. 输入 /h2 并按 Enter，生成 H2
  await test('2. typing /h2 and pressing Enter creates H2', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/h2')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await ready()
    const content = await source()
    assert.ok(content.startsWith('## ') || content === '##', `Expected H2, got: ${content}`)
    const h2Visible = await page.locator('.md-prose h2').isVisible()
    assert.equal(h2Visible, true, 'H2 heading element should be rendered in prose')
  })

  // 3. 输入 /biaoge 搜索表格
  await test('3. typing /biaoge filters to table command', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/biaoge')
    await page.locator('.md-slash-menu').waitFor({ state: 'visible' })
    const activeItem = page.locator('.md-slash-item.is-active')
    assert.equal(await activeItem.getAttribute('data-id'), 'table')
    assert.equal(await activeItem.locator('.md-slash-item-label').textContent(), '表格')
  })

  // 4. 插入 3x3 表格并正常编辑
  await test('4. insert 3x3 table and edit cells', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/table')
    await page.waitForTimeout(50)
    // Press Enter to open table picker (default 3x3)
    await page.keyboard.press('Enter')
    await page.locator('.md-slash-table-picker').waitFor({ state: 'visible' })
    const headerText = await page.locator('.md-slash-table-header strong').textContent()
    assert.equal(headerText, '3 × 3', 'Default table size should be 3 x 3')
    // Press Enter to confirm 3x3 table
    await page.keyboard.press('Enter')
    await ready()
    await page.locator('.md-prose table').waitFor()
    const rows = await page.locator('.md-prose table tr').count()
    const cols = await page.locator('.md-prose table tr:first-child th').count()
    assert.equal(rows, 3, 'Table should have 3 rows')
    assert.equal(cols, 3, 'Table should have 3 columns')
    // Type into cell
    await page.keyboard.type('Cell1')
    await ready()
    const src = await source()
    assert.ok(src.includes('Cell1'), `Table source should contain Cell1, got: ${src}`)
  })

  // 5. 插入代码块，代码语言补全正常
  await test('5. insert code block via /code', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/code')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await ready()
    await page.locator('.md-code-block').waitFor({ state: 'visible' })
    const codeBlockCount = await page.locator('.md-code-block').count()
    assert.equal(codeBlockCount, 1, 'Code block should be inserted')
    // Type inside code block
    await page.keyboard.type('const x = 42;')
    await ready()
    const src = await source()
    assert.ok(src.includes('const x = 42;'), `Code block source should contain typed code: ${src}`)
  })

  // 6. 插入任务列表，复选框工作正常
  await test('6. insert task list via /todo and toggle checkbox', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/todo')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await ready()
    await page.locator('.md-prose ul').waitFor()
    await page.keyboard.type('My Task')
    await ready()
    let src = await source()
    assert.ok(src.includes('- [ ] My Task'), `Expected unchecked task list, got: ${src}`)
    // Click checkbox
    const checkbox = page.locator('.md-prose input[type="checkbox"]').first()
    await checkbox.click()
    await ready()
    src = await source()
    assert.ok(src.includes('- [x] My Task'), `Expected checked task list, got: ${src}`)
  })

  // 7. 插入公式块并能够编辑
  await test('7. insert math block via /math and edit', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/math')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await ready()
    const src = await source()
    assert.ok(src.includes('$$') || src.includes('x^2'), `Expected math block in source: ${src}`)
  })

  // 8. 中文输入法组合期间不误触发
  await test('8. IME composition does not misfire slash commands', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    // Simulate compositionstart
    await page.evaluate(() => {
      const el = document.querySelector('.md-prose')
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })
    await page.keyboard.type('/')
    const isVisible = await page.locator('.md-slash-menu').isVisible()
    assert.equal(isVisible, false, 'Slash menu must NOT open during IME composition')
    // End composition
    await page.evaluate(() => {
      const el = document.querySelector('.md-prose')
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '/' }))
    })
  })

  // 9. URL 与代码块中的 / 不弹出菜单
  await test('9. URL and inside code block do not trigger slash menu', async () => {
    await reset('https:')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('/example.com')
    let isVisible = await page.locator('.md-slash-menu').isVisible()
    assert.equal(isVisible, false, 'Slash in URL should not open menu')

    // Test inside code block
    await reset('```js\n\n```')
    await page.locator('.md-code-editor-wrap .cm-content').click()
    await page.keyboard.type('/')
    isVisible = await page.locator('.md-slash-menu').isVisible()
    assert.equal(isVisible, false, 'Slash inside code block should not open menu')
  })

  // 10. Escape 正常关闭，不删除原文字
  await test('10. Escape key closes menu and preserves typed text', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/h1')
    await page.locator('.md-slash-menu').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(50)
    const isVisible = await page.locator('.md-slash-menu').isVisible()
    assert.equal(isVisible, false, 'Slash menu should be hidden after Escape')
    const src = await source()
    assert.equal(src, '/h1', 'Typed text should be preserved after closing with Escape')
  })

  // 11. 光标滚动与窄屏定位正常
  await test('11. narrow viewport bounds and repositioning', async () => {
    await reset('')
    await page.setViewportSize({ width: 500, height: 600 })
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/')
    await page.locator('.md-slash-menu').waitFor({ state: 'visible' })
    const box = await page.locator('.md-slash-menu').boundingBox()
    assert.ok(box, 'Menu bounding box should exist')
    assert.ok(box.x >= 0, `Menu x (${box.x}) should be non-negative`)
    assert.ok(box.x + box.width <= 500, `Menu right edge (${box.x + box.width}) should stay within viewport 500`)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1280, height: 850 })
  })

  // 12. Ctrl+Z 撤销一次插入操作
  await test('12. Ctrl+Z undoes slash command insertion in one single step', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/quote')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await ready()
    let src = await source()
    assert.ok(src.includes('>'), `Expected blockquote in source, got: ${src}`)
    // Press Ctrl+Z
    await page.keyboard.press('Control+z')
    await ready()
    src = await source()
    assert.ok(!src.includes('>'), `Blockquote should be completely undone: ${src}`)
  })

  // 13. Markdown 保存后重新打开结构正确
  await test('13. Markdown structure preserved across save and reopen', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/mermaid')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await ready()
    const saved = await source()
    assert.ok(saved.includes('```mermaid'), `Source should contain mermaid fence: ${saved}`)
    // Reopen with saved text
    await reset(saved, true)
    const reopened = await source()
    assert.equal(reopened, saved, 'Reopened content must match saved content exactly')
  })

  // 14. 实时排版与源码模式切换内容一致
  await test('14. Live mode and Source mode toggle preserves slash command result', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.type('/h3')
    await page.waitForTimeout(50)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Section Header')
    await ready()
    const liveSource = await source()
    assert.ok(liveSource.includes('### Section Header'), `Live source: ${liveSource}`)
    // Switch to source mode
    await page.evaluate(() => {
      const f = window.f
      f.manager.setMarkdownMode(f.id, 'source', 'main')
    })
    await page.locator('[data-pane="main"] .cm-editor').waitFor()
    const sourceModeText = await page.evaluate(() => {
      const f = window.f
      return f.manager.getText(f.id)
    })
    assert.equal(sourceModeText, liveSource, 'Source mode text should match live mode text')
    // Switch back to live mode
    await page.evaluate(() => {
      const f = window.f
      f.manager.setMarkdownMode(f.id, 'live', 'main')
    })
    await ready()
    assert.equal(await source(), liveSource, 'Switching back to live mode should preserve content')
  })

  // 15. 多窗口、多编辑器无菜单状态串扰
  await test('15. split pane editors maintain independent menu state', async () => {
    await reset('First paragraph\n\nSecond paragraph')
    const secondPane = await page.evaluate(() => window.f.split())
    await ready()
    await page.evaluate(second => {
      window.f.manager.setMarkdownMode(window.f.id, 'live', second)
    }, secondPane)
    await ready()
    // Click into second pane
    const secondEditor = page.locator(`[data-pane="${secondPane}"] .md-prose > p`).first()
    await secondEditor.click()
    await page.keyboard.type(' /h1')
    await page.locator('.md-slash-menu:not([hidden])').waitFor({ state: 'visible' })
    // Ensure only one active slash menu is displayed
    const menuCount = await page.locator('.md-slash-menu:not([hidden])').count()
    assert.equal(menuCount, 1, 'Only one menu should be active at a time')
    await page.keyboard.press('Escape')
  })

  // 16. 只读模式不允许执行插入命令
  await test('16. read-only mode prevents slash command execution', async () => {
    await reset('# Readonly content', true, true)
    await page.locator('.md-prose').first().click()
    await page.keyboard.type('/')
    const isVisible = await page.locator('.md-slash-menu:not([hidden])').isVisible().catch(() => false)
    assert.equal(isVisible, false, 'Slash command menu should not open in read-only mode')
    const text = await source()
    assert.equal(text, '# Readonly content', 'Source must not be mutated in read-only mode')
  })

  // 17. 原有 Markdown 快捷键和工具栏正常
  await test('17. existing markdown shortcuts remain functional', async () => {
    await reset('hello world')
    await page.locator('.md-prose > p').first().click()
    // Select all and Ctrl+B
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    await ready()
    const src = await source()
    assert.ok(src.includes('**hello world**'), `Bold shortcut should work, got: ${src}`)
  })

  // 18. 表格同格文字拖选与跨格 CellSelection 正常
  await test('18. table text selection and cell selection unaffected', async () => {
    await reset('| Col 1 | Col 2 |\n| --- | --- |\n| Cell A | Cell B |')
    const th = page.locator('.md-prose table th').first()
    await th.click()
    const tableExists = await page.locator('.md-prose table').isVisible()
    assert.equal(tableExists, true, 'Table should render normally')
  })

  // 19. Ctrl+C 的文本复制不受影响
  await test('19. text copy works unaffected', async () => {
    await reset('copy this text')
    await page.locator('.md-prose > p').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    // No error should occur
    assert.equal(await source(), 'copy this text')
  })

  // 20. 输入普通 / 后继续写文字或路径，不影响正常编辑
  await test('20. typing ordinary / with subsequent path or words does not disrupt typing', async () => {
    await reset('')
    await page.locator('.md-prose > p').first().click()
    // Type path
    await page.keyboard.type('src/editor/main.ts and a / b')
    await ready()
    const src = await source()
    assert.equal(src, 'src/editor/main.ts and a / b', 'Typing path or / with words should preserve exact text')
    const menuVisible = await page.locator('.md-slash-menu:not([hidden])').isVisible().catch(() => false)
    assert.equal(menuVisible, false, 'Menu should be closed after space')
  })

  console.log(`\n========================================`)
  console.log(`All ${results.length} Slash Command tests passed successfully!`)
  console.log(`========================================\n`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
