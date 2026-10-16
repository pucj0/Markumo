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
    // 点击第二段末尾，回车另起一行
    const p = page.locator('.md-prose p').first()
    await p.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    // 输入 ``` 并按 Enter
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')

    await page.locator('.md-code-block').waitFor()
    const text = await raw()
    assert.ok(text.includes('```'), 'Markdown should contain code block')
    // 检查是否有聚焦在嵌入的 CM 内
    const hasCmFocus = await page.evaluate(() => {
      return document.activeElement?.closest('.md-code-block .cm-editor') !== null
    })
    assert.ok(hasCmFocus, 'Focus should be inside CodeMirror')
  })

  await test('2. Type ```java triggers autocomplete with language icon, Enter creates Java code block', async () => {
    // 移到文档末尾
    await page.evaluate(() => {
      const view = window.fixture.view()
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create())
      view.dispatch(tr)
    })
    const lastP = page.locator('.md-prose p').last()
    await lastP.click()
    await page.keyboard.type('```java')

    // 自动补全浮层应显示
    await page.locator('.md-fence-autocomplete').waitFor()
    const isVisible = await page.locator('.md-fence-autocomplete').isVisible()
    assert.ok(isVisible, 'Autocomplete popover should be visible')

    // 检查候选项中有 SVG 图标
    const optionIcon = page.locator('.md-fence-autocomplete .md-language-option svg').first()
    assert.ok(await optionIcon.count() > 0, 'Language option should have an SVG icon')

    // 按 Enter 创建 Java 代码块
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
    // 候选项应包含 jade, java, javascript
    const optionsText = await page.locator('.md-fence-autocomplete .md-language-option').allInnerTexts()
    const joined = optionsText.join(' ').toLowerCase()
    assert.ok(joined.includes('jade') && joined.includes('java') && joined.includes('javascript'), 'Options should contain jade, java, javascript')

    // 没有按方向键选择候选时，按 Enter 必须使用 'ja'，绝不擅自替换为 jade！
    await page.keyboard.press('Enter')
    const text = await raw()
    assert.ok(text.includes('```ja\n') || text.includes('```ja \n'), 'Should preserve user input "ja" and not convert to jade')
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

    // 按 Escape 应关闭浮层，但保留文本
    await page.keyboard.press('Escape')
    const hidden = await page.locator('.md-fence-autocomplete').isHidden()
    assert.ok(hidden, 'Autocomplete should close on Escape')

    // 重新打开并测试 Tab 补全
    await page.keyboard.press('Backspace')
    await page.keyboard.type('a')
    await page.locator('.md-fence-autocomplete').waitFor()
    await page.keyboard.press('Tab')

    // 应该补全了语言名称
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

  await test('6. Language selector: completely hidden when blurred, hover does NOT show, only focused shows', async () => {
    const codeBlock = page.locator('.md-code-block').first()
    const footer = codeBlock.locator('.md-code-footer')

    // 点击正文外部段落，代码块处于失焦状态
    const heading = page.locator('.md-prose h1').first()
    await heading.click()

    // 1. 失焦状态：footer opacity 应为 0 或 pointer-events none
    let opacity = await footer.evaluate(el => getComputedStyle(el).opacity)
    assert.equal(opacity, '0', 'Footer should have opacity 0 when code block is blurred')

    // 2. 鼠标仅悬停（hover）在代码块上，不聚焦：footer 仍应为隐藏 (opacity 0)
    await codeBlock.hover()
    opacity = await footer.evaluate(el => getComputedStyle(el).opacity)
    assert.equal(opacity, '0', 'Footer should NOT show on hover without focus')

    // 3. 点击进入代码块聚焦：footer 显示 (opacity 1)
    await codeBlock.locator('.cm-content').click()
    await page.waitForFunction(el => getComputedStyle(el).opacity === '1', await footer.elementHandle())
    opacity = await footer.evaluate(el => getComputedStyle(el).opacity)
    assert.equal(opacity, '1', 'Footer should show when code block is focused')
  })

  await test('7. Short single-line code block has no excessive 30px bottom blank space', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const schema = view.state.schema
      const codeNode = schema.nodes.code_block.create({ params: 'bash', fence: '```' }, schema.text('npm install'))
      const tr = view.state.tr.insert(view.state.doc.content.size, codeNode)
      view.dispatch(tr)
    })

    const shortBlock = page.locator('.md-code-block').last()
    // 点击正文让其失焦
    await page.locator('.md-prose h1').first().click()

    const box = await shortBlock.boundingBox()
    assert.ok(box, 'Bounding box should exist')
    // 单行代码块总高度应紧凑（约 40-50px，绝不应因 30px footer 留白而暴增到 70-80px+）
    assert.ok(box.height < 65, `Short code block height should be compact (got ${box.height}px)`)
  })

  await test('8. Copy button appears on hover, copies only pure code content without fences or line numbers', async () => {
    const codeBlock = page.locator('.md-code-block').last()
    const copyBtn = codeBlock.locator('.md-code-copy')

    // hover 代码块
    await codeBlock.hover()
    await page.waitForFunction(el => parseFloat(getComputedStyle(el).opacity) > 0.8, await copyBtn.elementHandle())
    const copyOpacity = await copyBtn.evaluate(el => getComputedStyle(el).opacity)
    assert.ok(parseFloat(copyOpacity) > 0.8, 'Copy button should be visible on hover')

    // 检查复制图标尺寸约 14px
    const svgWidth = await copyBtn.locator('svg').evaluate(el => parseFloat(getComputedStyle(el).width))
    assert.ok(svgWidth <= 16 && svgWidth >= 12, `Copy icon width should be ~14px (got ${svgWidth}px)`)

    // 点击复制
    await copyBtn.click()
    const copied = await page.evaluate(() => window.fixture.copied)
    assert.equal(copied, 'npm install', 'Copied text should be strictly pure code without fences or line numbers')
  })

  await test('9. Undo restoring original text after creating code block', async () => {
    await page.evaluate(() => {
      const view = window.fixture.view()
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create())
      view.dispatch(tr)
    })
    const lastP = page.locator('.md-prose p').last()
    await lastP.click()
    await page.keyboard.type('```testundo')
    await page.keyboard.press('Enter')

    // 应该创建了代码块
    let text = await raw()
    assert.ok(text.includes('```testundo'), 'Code block created')

    // 执行 Undo
    await page.evaluate(() => window.fixture.manager.command('undo'))
    text = await raw()
    console.log('Undo text actual:', JSON.stringify(text))
    assert.ok(text.includes('testundo'), 'Undo should restore the typed fence text')
  })

} finally {
  await browser.close()
  if (errors.length) {
    console.error('Page errors encountered:', errors)
  }
}
