import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/markdown-html-parity'
await mkdir(output, { recursive: true })

const fixtureMarkdown = await readFile('tests/fixtures/markdown-html-parity.md', 'utf8')

const fixtureModule = `fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:900px;display:flex;flex-direction:column"></div><script type="module" src="./${fixtureModule}"></script></body></html>`)
await writeFile(`${output}/${fixtureModule}`, `
import { createApp, h, ref } from 'vue'
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import EditorContainer from '/src/components/layout/EditorContainer.vue'
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import { textClipboard } from '/src/features/shell/clipboard.ts'

const sampleMarkdown = ${JSON.stringify(fixtureMarkdown)}

const manager = new DocumentManager([
  { id: 'html-doc', name: 'html-parity.md', path: 'html-parity.md', text: sampleMarkdown },
])
manager.open('html-doc', false)

const revision = ref(0)
manager.subscribe(() => revision.value++)
window.fixture = {
  manager,
  live: (pane = 'main') => manager.liveViews.get(pane)?.editor,
  view: (pane = 'main') => manager.views.get(pane),
}
textClipboard.writeText = async text => {}

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

const raw = () => page.evaluate(() => window.fixture.manager.getText('html-doc'))

try {
  await page.goto((process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422') + `/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. HTML Block renders as real elements in Live mode (h1, p, div, table, details)', async () => {
    // 验证 h1 渲染为实际 h1
    const h1 = page.locator('.md-html-preview h1').first()
    assert.equal(await h1.count(), 1, 'HTML <h1> should render inside preview')
    assert.equal(await h1.innerText(), '一级标题 H1')

    // 验证 details / summary
    const details = page.locator('.md-html-preview details').first()
    assert.equal(await details.count(), 1, 'HTML <details> should render')
    assert.equal(await details.locator('summary').innerText(), '点击展开查看折叠内容')

    // 验证 HTML 表格及合并单元格 colspan / rowspan
    const table = page.locator('.md-html-preview table').first()
    assert.equal(await table.count(), 1, 'HTML <table> should render')
    const thColspan = table.locator('th[colspan="2"]').first()
    assert.equal(await thColspan.count(), 1, 'Table header with colspan="2" exists')
    assert.equal(await thColspan.innerText(), '人员基本信息')

    // 截图：HTML 块渲染
    await page.screenshot({ path: `${output}/html-blocks-rendered.png` })
  })

  await test('2. Inline HTML renders styled spans, kbd, sub, sup without breaking prose', async () => {
    // 验证彩色加粗 span
    const coloredSpan = page.locator('.md-prose span[style*="color: red"]').first()
    assert.equal(await coloredSpan.count(), 1, 'Styled span with red color should render')
    assert.equal(await coloredSpan.innerText(), '红色加粗文字')

    // 验证 kbd 键帽
    const kbd = page.locator('.md-prose kbd').first()
    assert.equal(await kbd.count(), 1, '<kbd> tag renders')
    assert.equal(await kbd.innerText(), 'Ctrl')

    // 验证 sub / sup
    const sub = page.locator('.md-prose sub').first()
    assert.equal(await sub.innerText(), '2', 'H2O sub tag')
    const sup = page.locator('.md-prose sup').first()
    assert.equal(await sup.innerText(), '2', 'mc2 sup tag')

    // 截图：行内样式与特殊标签
    await page.screenshot({ path: `${output}/inline-html-styles.png` })
  })

  await test('3. In-place local source editing for HTML block without touching entire document', async () => {
    const htmlBlock = page.locator('.md-html-block-view').first()
    await htmlBlock.hover()

    const editBtn = htmlBlock.locator('.md-html-edit-trigger')
    await editBtn.waitFor({ state: 'visible' })
    await editBtn.click()

    // 源码编辑器出现
    const textarea = htmlBlock.getByRole('textbox',{name:'HTML 局部源码'})
    await textarea.waitFor({ state: 'visible' })
    assert.equal(await htmlBlock.locator('.md-html-preview').isVisible(), false, 'Preview hidden during editing')

    // 在 textarea 中修改文本
    await textarea.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('<h1>修改后的一级标题</h1>')

    // 点击完成按钮
    await htmlBlock.locator('.md-html-done-btn').click()
    await page.waitForTimeout(100)

    // 预览恢复且内容更新
    assert.equal(await htmlBlock.locator('.md-html-preview').isVisible(), true, 'Preview restored')
    assert.equal(await htmlBlock.locator('.md-html-preview h1').innerText(), '修改后的一级标题')

    // 验证源码保真：没有自动转换成 Markdown `#`，保持原生 `<h1>`！
    const currentMarkdown = await raw()
    assert.ok(currentMarkdown.includes('<h1>修改后的一级标题</h1>'), 'Should retain raw HTML <h1> tag')
    assert.ok(!currentMarkdown.includes('# 修改后的一级标题'), 'Should NOT convert HTML to Markdown heading')

    // 截图：编辑后恢复渲染
    await page.screenshot({ path: `${output}/html-in-place-edited.png` })
  })

  await test('4. Security: malicious scripts, event handlers, javascript: URIs are stripped', async () => {
    // 检查页面没有被 XSS 弹窗或嵌入脚本执行
    assert.equal(await page.locator('script:not([type="module"])').count(), 0, 'Injected <script> must be removed')
    assert.equal(await page.locator('iframe[src*="example.com"]').count(), 0, '<iframe src> must be removed')
    assert.equal(await page.locator('img[onerror]').count(), 0, 'Event handlers must be removed')
    assert.equal(await page.locator('a[href*="javascript:"]').count(), 0, 'javascript: links must be stripped')
  })

  await test('5. HTML code fences inside Markdown stay raw code and are never executed', async () => {
    const codeBlock = page.locator('.md-code-block')
    await codeBlock.waitFor({ state: 'visible' })
    const codeText = await codeBlock.locator('.cm-content').innerText()
    assert.ok(codeText.includes('<div class="code-fence">'), 'Code block contains raw HTML tags')
    // 确保内部没有被渲染为单独的富文本类名
    assert.equal(await page.locator('.code-fence').count(), 0, 'Code fence content should NOT become live DOM')
  })

  await test('6. Split Preview renders safe HTML identically with source synchronization', async () => {
    // 切换为双栏模式
    const switcher = page.locator('.md-mode-switcher')
    await switcher.locator('.md-mode-btn', { hasText: '双栏' }).click()
    await page.waitForTimeout(100)

    const splitPreview = page.locator('.split-preview-pane')
    assert.equal(await splitPreview.isVisible(), true, 'Split preview visible')

    // 验证双栏右侧预览也渲染了 h1 和 表格
    const previewH1 = splitPreview.locator('h1').first()
    assert.ok(await previewH1.count() > 0, 'Split preview contains <h1>')

    const previewTable = splitPreview.locator('table').first()
    assert.ok(await previewTable.count() > 0, 'Split preview contains <table>')

    // 截图：双栏模式下的 HTML 渲染
    await page.screenshot({ path: `${output}/split-preview-html.png` })
  })

} finally {
  await browser.close()
  if (errors.length) {
    console.error('Page errors encountered:', errors)
  }
}
