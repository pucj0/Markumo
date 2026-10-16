import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/fleet-tab-drag'
await mkdir(output, { recursive: true })

const sampleMarkdown = `# LightEdit Fleet Test

Welcome to LightEdit multi-pane editor.

\`\`\`javascript
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
\`\`\`

| Feature | Status |
| :--- | :--- |
| Fleet Drag | Supported |
| Multi-view | Supported |
`

const fixtureModule = `fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:900px;display:flex;flex-direction:column"></div><script type="module" src="./${fixtureModule}"></script></body></html>`)
await writeFile(`${output}/${fixtureModule}`, `
import { createApp, h, ref } from 'vue'
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import EditorContainer from '/src/components/layout/EditorContainer.vue'
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import { textClipboard } from '/src/features/shell/clipboard.ts'

const sampleMarkdown = ${JSON.stringify(sampleMarkdown)}

const manager = new DocumentManager([
  { id: 'readme', name: 'README.md', path: 'README.md', text: sampleMarkdown },
  { id: 'notes', name: 'notes.txt', path: 'notes.txt', text: 'Some quick notes' },
])
manager.open('notes', false)
manager.open('readme', false)

const revision = ref(0)
manager.subscribe(() => revision.value++)
window.fixture = {
  manager,
  copied: '',
  live: (pane = 'main') => manager.liveViews.get(pane)?.editor,
  view: (pane = 'main') => manager.views.get(pane),
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

const raw = (id = 'readme') => page.evaluate((docId) => window.fixture.manager.getText(docId), id)

try {
  await page.goto((process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422') + `/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. Single Pane Markdown Live mode initial state', async () => {
    // 检查模式切换器存在，且当前激活的是“实时排版”
    const switcher = page.locator('.md-mode-switcher')
    assert.equal(await switcher.count(), 1, 'Markdown switcher should be visible')
    const activeBtn = switcher.locator('.md-mode-btn.active')
    assert.equal(await activeBtn.innerText(), '实时排版')

    // 截图：单 Pane Markdown Live
    await page.screenshot({ path: `${output}/single-pane-live.png` })
  })

  await test('2. Segmented control quickly toggles between Live, Source, and Split in-place', async () => {
    const switcher = page.locator('.md-mode-switcher')

    // 切换为源码模式
    await switcher.locator('.md-mode-btn', { hasText: '源码' }).click()
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.editor-host .cm-editor').isVisible(), true, 'CodeMirror should be visible')
    assert.equal(await page.locator('.md-prose').isVisible(), false, 'ProseMirror should be hidden')

    // 切换为双栏模式
    await switcher.locator('.md-mode-btn', { hasText: '双栏' }).click()
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.editor-host .cm-editor').isVisible(), true, 'CodeMirror should be visible in split')
    assert.equal(await page.locator('.split-preview-pane').isVisible(), true, 'Split preview should be visible')

    // 截图：单 Pane Markdown Split
    await page.screenshot({ path: `${output}/single-pane-split.png` })

    // 切回实时排版
    await switcher.locator('.md-mode-btn', { hasText: '实时排版' }).click()
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.md-prose').isVisible(), true)
  })

  await test('3. Drag tab to right edge creates right pane (Fleet style)', async () => {
    const pane = page.locator('.pane').first()
    const paneBox = await pane.boundingBox()
    assert.ok(paneBox, 'Pane box exists')

    const tab = page.locator('.tab[data-document="readme"]')
    const tabBox = await tab.boundingBox()
    assert.ok(tabBox, 'Tab box exists')

    await page.mouse.move(tabBox.x + 20, tabBox.y + 10)
    await page.mouse.down()
    await page.mouse.move(tabBox.x + 40, tabBox.y + 30, { steps: 5 })

    // 动态计算并移动到编辑区右侧边缘
    await page.mouse.move(paneBox.x + paneBox.width - 30, paneBox.y + paneBox.height / 2, { steps: 10 })
    await page.waitForTimeout(100)

    // 截图：拖拽右侧 DropZone 高亮
    await page.screenshot({ path: `${output}/drag-right-dropzone.png` })

    // 松开鼠标，完成右拆分
    await page.mouse.up()
    await page.waitForTimeout(200)

    // 验证形成了左右两个 Pane
    const leafIds = await page.evaluate(() => window.fixture.manager.layout.getAllLeafIds())
    assert.equal(leafIds.length, 2, 'Should have 2 panes')
    assert.equal(await page.locator('.pane').count(), 2)

    // 截图：左右两个独立 Pane
    await page.screenshot({ path: `${output}/split-two-panes-horizontal.png` })
  })

  await test('4. Same file across multiple panes has independent display modes and synced edits', async () => {
    // 在左侧 Pane 打开 readme 副本（同文件多视图）
    await page.evaluate(() => window.fixture.manager.open('readme', false, 'main'))
    await page.waitForTimeout(100)

    const panes = page.locator('.pane')
    const leftPane = panes.nth(0)
    const rightPane = panes.nth(1)

    // 左侧 Pane 处于 Live 模式，右侧 Pane 通过右侧顶部的切换器切为 Source 模式
    const rightSwitcher = rightPane.locator('.md-mode-switcher')
    await rightSwitcher.locator('.md-mode-btn', { hasText: '源码' }).click()
    await page.waitForTimeout(100)

    // 验证：左侧为 Live (ProseMirror 可见)，右侧为 Source (CodeMirror 可见)
    assert.equal(await leftPane.locator('.md-prose').isVisible(), true, 'Left pane should be Live')
    assert.equal(await rightPane.locator('.editor-host .cm-editor').isVisible(), true, 'Right pane should be Source')

    // 截图：同一 README.md 的 Live + Source
    await page.screenshot({ path: `${output}/same-file-live-and-source.png` })

    // 在右侧源码中修改
    const cmContent = rightPane.locator('.cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.type('# Updated Header\n\n')

    // 验证左侧 Live 实时同步更新
    await page.waitForTimeout(150)
    const leftH1 = await leftPane.locator('.md-prose h1').first().innerText()
    assert.ok(leftH1.includes('Updated Header'), `Left Live should sync edit (got "${leftH1}")`)
  })

  await test('5. Drag tab to bottom edge creates bottom pane', async () => {
    const leftPane = page.locator('.pane').first()
    const leftPaneBox = await leftPane.boundingBox()
    assert.ok(leftPaneBox, 'Left pane box exists')
    const leftTab = leftPane.locator('.tab').first()
    const tabBox = await leftTab.boundingBox()
    assert.ok(tabBox, 'Tab box exists')

    // 按住 Ctrl 拖拽到左侧 Pane 下边缘创建下方分栏副本
    await page.keyboard.down('Control')
    await page.mouse.move(tabBox.x + 20, tabBox.y + 10)
    await page.mouse.down()
    await page.mouse.move(tabBox.x + 20, tabBox.y + 40, { steps: 5 })
    await page.mouse.move(leftPaneBox.x + leftPaneBox.width / 2, leftPaneBox.y + leftPaneBox.height - 30, { steps: 10 })
    await page.waitForTimeout(100)

    // 截图：拖拽下方 DropZone 高亮
    await page.screenshot({ path: `${output}/drag-bottom-dropzone.png` })

    await page.mouse.up()
    await page.keyboard.up('Control')
    await page.waitForTimeout(150)

    // 验证嵌套分栏成功
    const leafCount = await page.evaluate(() => window.fixture.manager.layout.getAllLeafIds().length)
    assert.ok(leafCount >= 3, 'Should have at least 3 panes nested')

    // 截图：嵌套分栏布局
    await page.screenshot({ path: `${output}/nested-split-panes.png` })
  })

  await test('6. Split Preview code block visual parity and resizer', async () => {
    // 将所有分栏合并，回到单 Pane 测试双栏预览
    await page.evaluate(() => window.fixture.manager.mergeAllPanes())
    await page.waitForTimeout(100)

    // 切到双栏模式
    const switcher = page.locator('.md-mode-switcher')
    await switcher.locator('.md-mode-btn', { hasText: '双栏' }).click()
    await page.waitForTimeout(100)

    const preview = page.locator('.split-preview-pane')
    assert.equal(await preview.isVisible(), true)

    // 检查代码块：无大语言标题栏，具有小型 SVG 复制代码按钮
    const previewFence = preview.locator('.md-preview-fence').first()
    assert.equal(await previewFence.count(), 1)
    assert.equal(await previewFence.locator('.md-preview-fence-header').count(), 0, 'Should NOT have old bulky header')

    const copyBtn = previewFence.locator('.md-code-copy')
    assert.equal(await copyBtn.count(), 1, 'Copy button exists')

    // 截图：双栏预览与代码块
    await page.screenshot({ path: `${output}/split-preview-codeblock.png` })

    // 测试拖动分隔条调整比例
    const resizer = page.locator('.split-resizer')
    const resizerBox = await resizer.boundingBox()
    assert.ok(resizerBox, 'Resizer box exists')

    await page.mouse.move(resizerBox.x + 2, resizerBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(resizerBox.x - 150, resizerBox.y + 100, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)

    // 截图：调整比例后的双栏
    await page.screenshot({ path: `${output}/split-resized-ratio.png` })
  })

} finally {
  await browser.close()
  if (errors.length) {
    console.error('Page errors encountered:', errors)
  }
}
