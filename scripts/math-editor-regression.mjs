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

const output = 'test-results/math-editor'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(
  `${output}/index.html`,
  '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:720px"></div><script type="module" src="./fixture.js"></script>'
)
fs.writeFileSync(
  `${output}/fixture.js`,
  `import '/scripts/fixtures/markdown-live-controller.js';
import * as Vue from 'vue';
import EditorPaneItem from '/src/components/layout/EditorPaneItem.vue';
window.Vue = Vue;
window.EditorPaneItem = EditorPaneItem;`
)

const server = await createServer({
  server: { host: '127.0.0.1', port: 1463, strictPort: true, hmr: false, watch: null },
})
await server.listen()

function findSystemBrowser() {
  if (process.env.MARKUMO_CHROME && fs.existsSync(process.env.MARKUMO_CHROME)) {
    return process.env.MARKUMO_CHROME
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return undefined
}

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

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: findSystemBrowser(),
    args: ['--no-sandbox'],
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(15000)

  await page.goto(`http://127.0.0.1:1463/${output}/index.html`)
  await page.waitForFunction(() => window.f)

  // 1. 块级公式 $$...$$ 编辑及光标可见性（兼容光标动画开启与关闭）
  await test('1. block math editing and caret visibility with smooth caret on/off', async () => {
    await reset('$$\nx^2\n$$', true)
    await page.evaluate(() => window.f.manager.setCaretAnimation('smooth'))
    await page.locator('.md-math-output').click()
    const textarea = page.locator('.md-math-source')
    await textarea.waitFor({ state: 'visible' })

    // Verify caret-color is not transparent when smooth caret is on
    await page.evaluate(() => {
      document.querySelector('.md-prose')?.classList.add('smooth-caret-active')
    })
    const caretColorSmooth = await textarea.evaluate(el => window.getComputedStyle(el).caretColor)
    assert.notEqual(caretColorSmooth, 'rgba(0, 0, 0, 0)', 'Caret must be visible with smooth caret active')
    assert.notEqual(caretColorSmooth, 'transparent', 'Caret must not be transparent')

    // Verify caret-color with smooth caret off
    await page.evaluate(() => {
      document.querySelector('.md-prose')?.classList.remove('smooth-caret-active')
      window.f.manager.setCaretAnimation('off')
    })
    const caretColorOff = await textarea.evaluate(el => window.getComputedStyle(el).caretColor)
    assert.notEqual(caretColorOff, 'rgba(0, 0, 0, 0)', 'Caret must be visible with smooth caret off')
  })

  // 2. 行内公式 $...$ 编辑与回车提交
  await test('2. inline math editing and Enter commit', async () => {
    await reset('Prefix $a+b$ suffix', true)
    await page.locator('.md-inline-math').click()
    const inlineInput = page.locator('.md-inline-math .md-math-source')
    await inlineInput.waitFor({ state: 'visible' })

    const inlineCaret = await inlineInput.evaluate(el => window.getComputedStyle(el).caretColor)
    assert.notEqual(inlineCaret, 'rgba(0, 0, 0, 0)', 'Inline math caret must be visible')

    // Type text into inline math
    await inlineInput.type('+c')
    await page.waitForTimeout(50)
    assert.equal(await inlineInput.isVisible(), true, 'Inline input should remain visible while editing')

    // Press Enter to complete inline math
    await page.keyboard.press('Enter')
    await ready()
    assert.equal(await inlineInput.isHidden(), true, 'Inline input should close on Enter')
    const src = await source()
    assert.ok(src.includes('$a+b+c$'), `Source should contain updated inline math: ${src}`)
  })

  // 3. 点击公式源码区任意位置，能够准确定位光标
  await test('3. click positioning inside math textarea', async () => {
    await reset('$$\n\\frac{1}{2} + \\sqrt{x}\n$$', true)
    await page.locator('.md-math-output').click()
    const textarea = page.locator('.md-math-source')
    await textarea.waitFor({ state: 'visible' })

    // Click near start
    const box = await textarea.boundingBox()
    assert.ok(box, 'Textarea bounding box must exist')
    await page.mouse.click(box.x + 8, box.y + 12)
    const posStart = await textarea.evaluate(el => el.selectionStart)
    assert.ok(posStart < 3, `Cursor near start should be small offset, got: ${posStart}`)

    // Click near end
    await page.mouse.click(box.x + 180, box.y + 12)
    const posEnd = await textarea.evaluate(el => el.selectionStart)
    assert.ok(posEnd > 5, `Cursor near end should be larger offset, got: ${posEnd}`)
  })

  // 4. 鼠标从左向右、从右向左拖动选区，双击选词，Shift 选择
  await test('4. mouse selection: left-to-right, right-to-left, double-click, Shift+Arrow', async () => {
    await reset('$$\nalpha beta gamma\n$$', true)
    await page.locator('.md-math-output').click()
    const textarea = page.locator('.md-math-source')
    await textarea.waitFor({ state: 'visible' })
    const box = await textarea.boundingBox()
    assert.ok(box)

    // Left to right drag
    await page.mouse.move(box.x + 8, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + 50, box.y + 12, { steps: 5 })
    await page.mouse.up()
    let sel = await textarea.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd }))
    assert.ok(sel.end > sel.start, 'Left-to-right drag should select text')

    // Right to left drag
    await page.mouse.move(box.x + 50, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + 8, box.y + 12, { steps: 5 })
    await page.mouse.up()
    sel = await textarea.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd }))
    assert.ok(sel.end > sel.start, 'Right-to-left drag should select text')

    // Double-click word
    await page.mouse.dblclick(box.x + 15, box.y + 12)
    sel = await textarea.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd }))
    assert.ok(sel.end > sel.start, 'Double-click should select word')

    // Shift+Arrow selection
    await page.keyboard.press('Home')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    sel = await textarea.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd }))
    assert.equal(sel.start, 0)
    assert.equal(sel.end, 3)
  })

  // 5. 首尾空格及换行输入不会意外关闭编辑
  await test('5. spaces, newlines, and backslashes do not exit edit mode', async () => {
    await reset('$$\nx\n$$', true)
    await page.locator('.md-math-output').click()
    const textarea = page.locator('.md-math-source')
    await textarea.waitFor({ state: 'visible' })

    // Type spaces at end
    await textarea.type('   ')
    await page.waitForTimeout(50)
    assert.equal(await textarea.isVisible(), true, 'Textarea must not close when typing spaces')

    // Type newline (Enter in display mode)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    assert.equal(await textarea.isVisible(), true, 'Textarea must not close on Enter in display mode')

    // Type backslash and commands
    await textarea.type('\\frac{1}{2}')
    await page.waitForTimeout(50)
    assert.equal(await textarea.isVisible(), true, 'Textarea must not close on backslash')

    const src = await source()
    assert.ok(src.includes('\\frac{1}{2}'), `Source should include fraction: ${src}`)
  })

  // 6. 多行粘贴及撤销/重做
  await test('6. multiline paste and undo/redo within math editor', async () => {
    await reset('$$\ninitial\n$$', true)
    await page.locator('.md-math-output').click()
    const textarea = page.locator('.md-math-source')
    await textarea.waitFor({ state: 'visible' })

    // Select all and replace with multiline paste
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('line1\nline2\nline3')
    await ready()
    let src = await source()
    assert.ok(src.includes('line1\nline2\nline3'), `Source should contain multiline: ${src}`)

    // Undo
    await page.keyboard.press('Control+z')
    await ready()
    src = await source()
    assert.ok(src.includes('initial'), `Undo should restore initial text: ${src}`)

    // Redo
    await page.keyboard.press('Control+y')
    await ready()
    src = await source()
    assert.ok(src.includes('line1\nline2\nline3'), `Redo should restore multiline: ${src}`)
  })

  // 7. 拖拽隔离：原生 textarea 文本拖放不受 Pane 自定义拖拽拦截
  await test('7. drag-and-drop isolation: text drag vs tab drag types in EditorPaneItem', async () => {
    const dragResult = await page.evaluate(async () => {
      const { createApp, h } = window.Vue
      const EditorPaneItem = window.EditorPaneItem
      const container = document.createElement('div')
      document.body.append(container)
      const app = createApp({
        render() {
          return h(EditorPaneItem, {
            manager: window.f.manager,
            paneId: 'main',
            revision: 0,
            desktop: false,
          })
        },
      })
      app.mount(container)
      const paneEl = container.querySelector('[data-pane-id="main"]')
      if (!paneEl) return { found: false }

      // 1. Native text dragover - should NOT be prevented
      const dtText = new DataTransfer()
      dtText.setData('text/plain', 'dragged-text')
      const eventText = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dtText })
      paneEl.dispatchEvent(eventText)

      // 2. Markumo tab dragover - SHOULD be prevented and handled
      const dtTab = new DataTransfer()
      dtTab.setData('application/x-markumo-tab', JSON.stringify({ id: 'tab-1', from: 'main' }))
      const eventTab = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dtTab })
      paneEl.dispatchEvent(eventTab)

      app.unmount()
      container.remove()

      return {
        found: true,
        textPrevented: eventText.defaultPrevented,
        tabPrevented: eventTab.defaultPrevented,
      }
    })

    assert.equal(dragResult.found, true, 'EditorPaneItem should be mountable')
    assert.equal(dragResult.textPrevented, false, 'Native text dragover must NOT be defaultPrevented by pane')
    assert.equal(dragResult.tabPrevented, true, 'Markumo tab dragover must be defaultPrevented by pane')
  })

  // 8. 同一文档多个 Pane 同步数学公式编辑
  await test('8. multi-pane synchronization for math formula', async () => {
    await reset('$$\nx+y\n$$', true)
    const secondary = await page.evaluate(() => window.f.split())
    await ready()
    await page.evaluate(second => {
      window.f.manager.setMarkdownMode(window.f.id, 'live', second)
    }, secondary)
    await ready()

    // Edit math in main pane
    await page.locator('[data-pane="main"] .md-math-output').click()
    const mainInput = page.locator('[data-pane="main"] .md-math-source')
    await mainInput.waitFor({ state: 'visible' })
    await mainInput.type('+z')
    await ready()

    // Check secondary pane rendered KaTeX preview
    const secondaryText = await page.locator(`[data-pane="${secondary}"] .md-math-output`).innerText()
    assert.ok(secondaryText.includes('x') && secondaryText.includes('z'), `Secondary pane should reflect math update: ${secondaryText}`)
  })

  // 9. 从公式编辑器进入普通段落及代码块
  await test('9. transition focus from math editor to paragraph and code block', async () => {
    await reset('Paragraph before\n\n$$\nx^2\n$$\n\n```js\nconst code = 1;\n```', true)
    await page.locator('.md-math-output').click()
    const textarea = page.locator('.md-math-source')
    await textarea.waitFor({ state: 'visible' })

    // Click paragraph before
    await page.locator('.md-prose > p').first().click()
    await page.waitForTimeout(100)
    assert.equal(await textarea.isHidden(), true, 'Math editor should close when clicking paragraph')

    // Click into code block
    await page.locator('.md-code-editor-wrap .cm-content').click()
    await page.keyboard.type('// edit')
    await ready()
    const src = await source()
    assert.ok(src.includes('// edit'), 'Code block should be editable after exiting math')
  })

  // 10. 保存、重新打开及模式切换（Live/Source/Split）
  await test('10. save, reopen, and mode toggle with math formulas', async () => {
    await reset('$$\nE = mc^2\n$$\n\nInline $E=mc^2$ formula', true)
    // Toggle to source mode
    await page.evaluate(() => window.f.manager.setMarkdownMode(window.f.id, 'source', 'main'))
    await page.locator('[data-pane="main"] .cm-editor').waitFor()
    const sourceText = await source()
    assert.ok(sourceText.includes('E = mc^2'), `Source mode should contain formula: ${sourceText}`)

    // Toggle back to live mode
    await page.evaluate(() => window.f.manager.setMarkdownMode(window.f.id, 'live', 'main'))
    await ready()
    await page.locator('.md-math-output').waitFor({ state: 'visible' })
    assert.equal(await source(), sourceText, 'Live mode should preserve exact math syntax')
  })

  console.log(`\n========================================`)
  console.log(`All ${results.length} Math Editor tests passed successfully!`)
  console.log(`========================================\n`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
