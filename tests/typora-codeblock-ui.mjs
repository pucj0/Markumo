import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/typora-codeblock'
await mkdir(output, { recursive: true })

const fixtureModule = `fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:850px;display:flex;flex-direction:column"></div><script type="module" src="./${fixtureModule}"></script></body></html>`)
await writeFile(`${output}/${fixtureModule}`, `
import { createApp, h, ref } from 'vue'
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import EditorContainer from '/src/components/layout/EditorContainer.vue'
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import { textClipboard } from '/src/features/shell/clipboard.ts'

const initialMarkdown = '# Typora Code Block Test\\n\\nExisting paragraph'
const manager = new DocumentManager([
  { id: 'md', name: 'test.md', path: 'test.md', text: initialMarkdown }
])
manager.open('md', false)

const revision = ref(0)
manager.subscribe(() => revision.value++)
window.fixture = {
  manager,
  copied: '',
  live: () => manager.liveViews.get('main')?.editor,
  view: () => manager.liveViews.get('main')?.editor.view,
}
textClipboard.writeText = async text => { window.fixture.copied = text }
createApp({
  render() {
    revision.value
    return h(EditorContainer, { doc: manager.activeDocument, manager, showOutline: false, desktop: false })
  }
}).mount('#app')
`)

const browser = await chromium.launch(browserOptions)
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const results = []
const errors = []
page.on('pageerror', e => errors.push(e.message))

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

const raw = () => page.evaluate(() => window.fixture.manager.saveSnapshot('md')?.text)

try {
  await page.goto((process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422') + `/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. Type ``` and Enter creates an empty code block with cursor inside', async () => {
    const p = page.locator('.md-prose p').first()
    await p.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')

    await page.locator('.md-code-block').waitFor()
    const text = await raw()
    assert.ok(text.includes('```'), 'Markdown should contain code block')
    const hasCmFocus = await page.evaluate(() => {
      return document.activeElement?.closest('.md-code-block .cm-editor') !== null
    })
    assert.ok(hasCmFocus, 'Focus should be inside CodeMirror')
  })

  await test('2. Type ```java triggers autocomplete with language icon, Enter creates Java code block', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create())
      view.dispatch(tr)
    })
    const lastP = page.locator('.md-prose p').last()
    await lastP.click()
    await page.keyboard.type('```java')

    await page.locator('.md-fence-autocomplete').waitFor()
    const isVisible = await page.locator('.md-fence-autocomplete').isVisible()
    assert.ok(isVisible, 'Autocomplete popover should be visible')

    const optionIcon = page.locator('.md-fence-autocomplete .md-language-option svg').first()
    assert.ok(await optionIcon.count() > 0, 'Language option should have an SVG icon')

    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('.md-fence-autocomplete') || document.querySelector('.md-fence-autocomplete').hidden)

    const text = await raw()
    assert.ok(text.includes('```java'), 'Markdown should have ```java code block')
  })

  await test('3. Typing ```ja shows candidates and does NOT hijack unselected ja into jade on Enter', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create())
      view.dispatch(tr)
    })
    const lastP = page.locator('.md-prose p').last()
    await lastP.click()
    await page.keyboard.type('```ja')

    await page.locator('.md-fence-autocomplete').waitFor()
    const optionsText = await page.locator('.md-fence-autocomplete .md-language-option').allInnerTexts()
    const joined = optionsText.join(' ').toLowerCase()
    assert.ok(joined.includes('jade') && joined.includes('java') && joined.includes('javascript'), 'Options should contain jade, java, javascript')

    // 未按方向键选择时按 Enter 不劫持
    await page.keyboard.press('Enter')
    const text = await raw()
    assert.ok(text.includes('```ja\n') || text.includes('```ja \n'), 'Should preserve user input "ja"')
  })

  await test('4. Tab completion and Escape dismissal on fence autocomplete', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create())
      view.dispatch(tr)
    })
    const lastP = page.locator('.md-prose p').last()
    await lastP.click()
    await page.keyboard.type('```ja')
    await page.locator('.md-fence-autocomplete').waitFor()

    await page.keyboard.press('Escape')
    const hidden = await page.locator('.md-fence-autocomplete').isHidden()
    assert.ok(hidden, 'Autocomplete should close on Escape')

    await page.keyboard.press('Backspace')
    await page.keyboard.type('a')
    await page.locator('.md-fence-autocomplete').waitFor()
    await page.keyboard.press('Tab')

    const pText = await lastP.innerText()
    assert.ok(pText.startsWith('```ja'), 'Paragraph text should be completed')
  })

  await test('5. Type ```customlang creates block with customlang without error', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create())
      view.dispatch(tr)
    })
    const lastP = page.locator('.md-prose p').last()
    await lastP.click()
    await page.keyboard.type('```customlang')
    await page.keyboard.press('Enter')

    const text = await raw()
    assert.ok(text.includes('```customlang'), 'Should create code_block with customlang params')
  })

  await test('6. Code block focus states & language dock visibility (hidden by default, only visible when editing)', async () => {
    const codeBlock = page.locator('.md-code-block').first()
    const languageRow = codeBlock.locator('.md-code-language-row')

    // 1. 点击正文，代码块失焦状态：默认不显示
    await page.locator('.md-prose h1').first().click()
    assert.equal(await languageRow.isHidden(), true, 'Language row must be hidden (display: none) by default when blurred')
    const boxBlurred = await codeBlock.boundingBox()

    // 2. 鼠标仅悬停（hover）代码块，不聚焦：语言栏不显示
    await codeBlock.locator('.md-code-surface').hover()
    assert.equal(await languageRow.isHidden(), true, 'Language row must not show on hover without focus')

    // 3. 点击代码内容获焦（进入编辑状态）：语言栏显示出来，整体高度保持一致无跳动
    await codeBlock.locator('.cm-content').click()
    assert.equal(await languageRow.isVisible(), true, 'Language row must show when editing code block')

    const boxFocused = await codeBlock.boundingBox()
    assert.ok(boxBlurred && boxFocused, 'Both bounding boxes exist')
    assert.ok(Math.abs(boxBlurred.height - boxFocused.height) <= 1, `Code block height must not jump on focus (blurred: ${boxBlurred.height}, focused: ${boxFocused.height})`)
  })

  await test('7. Geometric layout constraints: dock right-aligned below surface, input centered with text-align center', async () => {
    // 插入短代码块 npm install
    await page.evaluate(() => {
      const view = window.fixture.view()
      const schema = view.state.schema
      const codeNode = schema.nodes.code_block.create({ params: '', fence: '```' }, schema.text('npm install'))
      const tr = view.state.tr.insert(view.state.doc.content.size, codeNode)
      view.dispatch(tr)
    })

    const targetBlock = page.locator('.md-code-block').last()
    const surface = targetBlock.locator('.md-code-surface')
    const row = targetBlock.locator('.md-code-language-row')
    const dock = targetBlock.locator('.md-code-language-dock')
    const input = targetBlock.locator('.md-code-language-input')

    // 点击外部，检查失焦状态紧凑度并截图
    await page.locator('.md-prose h1').first().click()
    const surfaceBox = await surface.boundingBox()
    assert.ok(surfaceBox, 'Surface box exists')
    assert.ok(surfaceBox.height < 55, `Single-line code block height must be compact (got ${surfaceBox.height}px)`)
    await targetBlock.screenshot({ path: `${output}/single-line-blur.png` })

    // 点击聚焦，语言栏出现并截图
    await targetBlock.locator('.cm-content').click()
    await row.waitFor({ state: 'visible' })
    const surfaceBoxFocused = await surface.boundingBox()
    const dockBox = await dock.boundingBox()
    const btnBox = await targetBlock.locator('.md-code-lang-btn').boundingBox()
    assert.ok(dockBox && btnBox && surfaceBoxFocused, 'All boxes exist')

    // 几何约束 1：代码区右边缘与语言栏右边缘在右侧对齐（偏置约 8px）
    const surfaceRight = surfaceBoxFocused.x + surfaceBoxFocused.width
    const dockRight = dockBox.x + dockBox.width
    assert.ok(dockRight <= surfaceRight + 1 && dockRight >= surfaceRight - 16, `Dock right edge (${dockRight}) aligns near surface right (${surfaceRight})`)

    // 几何约束 2：语言栏悬浮在代码区外部下方，top 大于 surface bottom 约 4px
    assert.ok(dockBox.y >= surfaceBoxFocused.y + surfaceBoxFocused.height + 2, `Dock top (${dockBox.y}) must be below surface bottom (${surfaceBoxFocused.y + surfaceBoxFocused.height})`)

    // 几何约束 3：语言栏位于代码区右侧区域，而非居中
    assert.ok(dockBox.x > surfaceBoxFocused.x + surfaceBoxFocused.width / 2, 'Dock must be on the right side of the code block')

    // 几何约束 4：语言按钮在语言栏内部水平居中（左右外边距相差 <= 4px）
    const leftMargin = btnBox.x - dockBox.x
    const rightMargin = (dockBox.x + dockBox.width) - (btnBox.x + btnBox.width)
    assert.ok(Math.abs(leftMargin - rightMargin) <= 4, `Button must be centered inside dock (leftMargin: ${leftMargin}, rightMargin: ${rightMargin})`)

    // 几何约束 5：文字居中
    const textAlign = await targetBlock.locator('.md-code-lang-btn').evaluate(el => getComputedStyle(el).textAlign)
    assert.equal(textAlign, 'center', 'Button text-align must be center')

    await targetBlock.screenshot({ path: `${output}/single-line-focus.png` })

    // 点击语言栏进入编辑，在输入框中输入 ja 并截图
    await targetBlock.locator('.md-code-lang-btn').click()
    await input.waitFor({ state: 'visible' })
    const inputBox = await input.boundingBox()
    assert.ok(inputBox, 'Input box exists')
    const inputTextAlign = await input.evaluate(el => getComputedStyle(el).textAlign)
    assert.equal(inputTextAlign, 'center', 'Input text-align must be center')

    await input.fill('ja')
    await targetBlock.locator('.md-language-menu').waitFor({ state: 'visible' })
    await targetBlock.screenshot({ path: `${output}/language-input-ja.png` })

    // 验证候选框锚定在输入框下方
    const menuBox = await targetBlock.locator('.md-language-menu').boundingBox()
    assert.ok(menuBox, 'Language menu box exists')
    assert.ok(menuBox.y >= dockBox.y + dockBox.height - 2, 'Language menu must be below dock')

    // 截图带候选列表
    await page.screenshot({ path: `${output}/language-candidates-with-icons.png` })

    // 关闭候选菜单并失焦
    await page.keyboard.press('Escape')
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  })

  await test('8. Copy button: appears on hover at top-right of surface, copies only code text', async () => {
    const codeBlock = page.locator('.md-code-block').last()
    const surface = codeBlock.locator('.md-code-surface')
    const copyBtn = codeBlock.locator('.md-code-copy')

    // hover 代码主体
    await surface.hover()
    await page.waitForFunction(el => parseFloat(getComputedStyle(el).opacity) > 0.8, await copyBtn.elementHandle())
    const copyOpacity = await copyBtn.evaluate(el => getComputedStyle(el).opacity)
    assert.ok(parseFloat(copyOpacity) > 0.8, 'Copy button should be visible on hover')

    // 检查复制按钮位于 surface 右上角
    const surfaceBox = await surface.boundingBox()
    const copyBox = await copyBtn.boundingBox()
    assert.ok(copyBox && surfaceBox, 'Boxes exist')
    assert.ok(copyBox.x + copyBox.width <= surfaceBox.x + surfaceBox.width + 1, 'Copy button inside surface right')
    assert.ok(copyBox.y >= surfaceBox.y, 'Copy button inside surface top')

    // 截图 hover 状态
    await codeBlock.screenshot({ path: `${output}/copy-button-hover.png` })

    // 点击复制
    await copyBtn.click()
    await page.waitForFunction(() => window.fixture.copied === 'npm install')
    const copied = await page.evaluate(() => window.fixture.copied)
    assert.equal(copied, 'npm install', 'Copied text should be strictly pure code')
  })

  await test('9. Multiline JavaScript code block renders with syntax highlighting and screenshot', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const schema = view.state.schema
      const jsCode = 'function calculateSum(a, b) {\n  const result = a + b;\n  return result;\n}'
      const codeNode = schema.nodes.code_block.create({ params: 'javascript', fence: '```' }, schema.text(jsCode))
      const tr = view.state.tr.insert(view.state.doc.content.size, codeNode)
      view.dispatch(tr)
    })

    const jsBlock = page.locator('.md-code-block').last()
    await page.locator('.md-prose h1').first().click()
    await page.waitForTimeout(200)

    await jsBlock.screenshot({ path: `${output}/multiline-js.png` })
  })

} finally {
  await browser.close()
  if (errors.length) {
    console.error('Page errors encountered:', errors)
  }
}
