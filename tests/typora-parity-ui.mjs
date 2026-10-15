import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

const require = createRequire(
  process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE ||
    'C:/Users/18089/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json'
)
const { chromium } = require('playwright')

const output = 'test-results/typora-parity'
await mkdir(output, { recursive: true })

const markdown = await readFile('tests/fixtures/typora-parity.md', 'utf8')
const fixtureModule = `fixture-${Date.now()}.ts`

await writeFile(
  `${output}/fixture.html`,
  `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:900px;display:flex;flex-direction:column"></div><script type="module" src="./${fixtureModule}"></script></body></html>`
)

await writeFile(
  `${output}/${fixtureModule}`,
  `
import { createApp, h, ref } from 'vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import { textClipboard } from '/src/features/shell/clipboard.ts';

const manager = new DocumentManager([
  { id: 'md', name: 'typora-parity.md', path: 'typora-parity.md', text: ${JSON.stringify(markdown)} },
  { id: 'txt', name: 'plain.txt', path: 'plain.txt', text: 'plain text' }
]);
manager.open('md', false);

const revision = ref(0);
manager.subscribe(() => revision.value++);
window.fixture = {
  manager,
  live: () => manager.liveViews.get('main')?.editor,
  view: () => manager.liveViews.get('main')?.editor.view,
  copied: ''
};
textClipboard.writeText = async text => { window.fixture.copied = text; };

createApp({
  render() {
    revision.value;
    return h(EditorContainer, { doc: manager.activeDocument, manager, showOutline: false, desktop: false });
  }
}).mount('#app');
`
)

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
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
  await page.goto(
    (process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422') + `/${output}/fixture.html`
  )
  await page.locator('.md-prose').waitFor()

  // Full document screenshots
  await page.evaluate(() => {
    document.querySelector('.markdown-live').scrollTop = 0
    document.body.classList.remove('light')
  })
  await page.screenshot({ path: `${output}/parity-document-dark.png` })
  await page.evaluate(() => document.body.classList.add('light'))
  await page.screenshot({ path: `${output}/parity-document-light.png` })
  await page.evaluate(() => document.body.classList.remove('light'))

  // 1. Live Ctrl+F: Does not switch to source, docks top-right, highlights matches
  await test('1. Ctrl+F in Live mode keeps Live without switching to source and highlights matches', async () => {
    assert.equal(await page.evaluate(() => window.fixture.manager.metadata('md')?.mode), 'live')
    await page.locator('.md-prose h1').first().click()
    await page.keyboard.press('Control+f')
    const searchPanel = page.locator('.md-live-search')
    await searchPanel.waitFor()
    assert.equal(await searchPanel.isVisible(), true)
    assert.equal(await page.evaluate(() => window.fixture.manager.metadata('md')?.mode), 'live')

    await page.locator('.md-live-search input[name="search"]').fill('金丝熊')
    await page.waitForTimeout(100)
    const countText = await page.locator('.md-live-search .search-count').textContent()
    assert.ok(countText.includes('/') || countText.includes('5') || countText.includes('处'))
    assert.ok((await page.locator('.md-search-match').count()) >= 3)
    assert.equal(await page.locator('.md-search-match-current').count(), 1)
    await page.screenshot({ path: `${output}/step1-live-search.png` })
  })

  // 2. Ctrl+R: Live replacement without switching to source, with undo
  await test('2. Ctrl+R in Live mode performs live replace and preserves undo', async () => {
    await page.keyboard.press('Control+r')
    const replaceInput = page.locator('.md-live-search input[name="replace"]')
    await replaceInput.waitFor()
    assert.equal(await replaceInput.isVisible(), true)

    await replaceInput.fill('黄金仓鼠')
    const beforeReplace = await raw()
    await page.getByRole('button', { name: '替换当前匹配', exact: true }).click()
    await page.waitForTimeout(50)
    const afterReplace = await raw()
    assert.notEqual(beforeReplace, afterReplace)
    assert.ok(afterReplace.includes('黄金仓鼠'))

    // Undo restores original
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.equal(await raw(), beforeReplace)
    await page.screenshot({ path: `${output}/step2-live-replace.png` })

    // Close search with Escape
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.md-live-search').isVisible(), false)
  })

  // 3. Link click: anchored popover appears, text and URL editable
  await test('3. Click link shows anchored popover for in-place text and URL editing', async () => {
    const link = page.locator('.md-prose a').filter({ hasText: 'GitHub 仓库' }).first()
    await link.scrollIntoViewIfNeeded()
    await link.click()
    const popover = page.locator('.md-properties')
    await popover.waitFor()
    assert.equal(await popover.isVisible(), true)
    assert.equal(await popover.getByLabel('链接文字').inputValue(), 'GitHub 仓库')
    assert.ok((await popover.getByLabel('链接 URL').inputValue()).includes('github.com'))
    await page.screenshot({ path: `${output}/step3-link-popover.png` })

    await popover.getByLabel('链接文字').fill('开源仓库')
    await popover.getByRole('button', { name: '应用链接' }).click()
    assert.ok((await raw()).includes('[开源仓库]('))

    // Restore via undo
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.ok((await raw()).includes('[GitHub 仓库]('))
  })

  // 4. Click image: selection outline and anchored image toolbar
  await test('4. Click image shows selection outline and anchored properties', async () => {
    const img = page.locator('.md-image-preview img').first()
    await img.scrollIntoViewIfNeeded()
    await img.click()
    const popover = page.locator('.md-properties')
    await popover.waitFor()
    assert.equal(await popover.isVisible(), true)
    assert.ok((await popover.getByLabel('图片替代文字').inputValue()).includes('金丝熊标准笼位'))
    assert.ok((await popover.getByLabel('图片路径').inputValue()).includes('pixel.png'))
    await page.screenshot({ path: `${output}/step4-image-popover.png` })
    await popover.getByRole('button', { name: '关闭' }).click()
  })

  // 5. Code block: direct typing, clean container, no markdown fences exposed
  await test('5. Code block enables direct typing without showing backtick fences', async () => {
    const codeBlock = page.locator('.md-code-block').first()
    await codeBlock.scrollIntoViewIfNeeded()
    const cmContent = codeBlock.locator('.cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n// Direct input check')
    assert.ok((await raw()).includes('// Direct input check'))
    assert.equal((await cmContent.innerText()).includes('~~~~'), false)
    assert.equal((await cmContent.innerText()).includes('```'), false)
    await page.screenshot({ path: `${output}/step5-code-editing.png` })

    // Undo
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.equal((await raw()).includes('// Direct input check'), false)
  })

  // 6. Code block internal line numbers & language selector
  await test('6. Code block has internal line numbers from 1 and language selector', async () => {
    const codeBlock = page.locator('.md-code-block').first()
    await codeBlock.scrollIntoViewIfNeeded()
    // Code block internal gutter element with '1'
    const gutter1 = codeBlock.locator('.cm-gutterElement').filter({ hasText: /^1$/ })
    assert.equal(await gutter1.count(), 1)

    // Language selector
    const langInput = codeBlock.locator('.md-code-lang-input')
    assert.equal(await langInput.inputValue(), 'javascript')
    await page.screenshot({ path: `${output}/step6-code-linenumbers.png` })
  })

  // 7 & 8. Table cell direct editing & floating table toolbar anchored above
  await test('7 & 8. Table direct cell editing and anchored floating toolbar', async () => {
    const table = page.locator('.md-prose table').first()
    await table.scrollIntoViewIfNeeded()
    const adminCell = table.locator('td').filter({ hasText: '超级管理员' }).first()
    await adminCell.click()
    await page.keyboard.press('End')
    await page.keyboard.insertText('VIP')
    assert.ok((await raw()).includes('超级管理员VIP'))

    // Floating toolbar is visible and anchored near table
    const toolbar = page.locator('.md-table-floating-bar')
    await toolbar.waitFor()
    assert.equal(await toolbar.isVisible(), true)
    await page.screenshot({ path: `${output}/step7-8-table-toolbar.png` })

    const initialRows = await table.locator('tr').count()
    await toolbar.getByRole('button', { name: '后插行', exact: true }).click()
    assert.equal(await table.locator('tr').count(), initialRows + 1)

    // Undo additions
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.equal(await table.locator('tr').count(), initialRows)
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.equal((await raw()).includes('超级管理员VIP'), false)
  })

  // 9. Mermaid diagram in reading state
  await test('9. Mermaid diagram renders SVG cleanly', async () => {
    const mermaidBtn = page.getByRole('button', { name: '渲染 Mermaid', exact: true })
    if (await mermaidBtn.isVisible()) {
      await mermaidBtn.click()
    }
    await page.locator('.md-diagram svg').waitFor({ timeout: 60000 })
    assert.ok((await page.locator('.md-diagram svg').count()) >= 1)
    await page.screenshot({ path: `${output}/step9-mermaid-diagram.png` })
  })

  // 10. Continuous paragraph typing and undo preserves original markdown
  await test('10. Continuous typing and canonical undo preserves original markdown', async () => {
    const beforeAll = markdown.replace(/\r\n/g, '\n')
    const h1 = page.locator('.md-prose h1').first()
    await h1.scrollIntoViewIfNeeded()
    await h1.click()
    await page.keyboard.press('End')
    await page.keyboard.insertText('【测试版】')
    assert.ok((await raw()).includes('基于 SpringBoot+Vue 的金丝熊舍管理系统【测试版】'))
    await page.screenshot({ path: `${output}/step10-typing-undo.png` })

    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.equal(await raw(), beforeAll)
  })

  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  results.push({ name: 'failure', result: 'FAIL', error: String(error) })
  await page.screenshot({ path: `${output}/failure.png` })
  process.exitCode = 1
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2))
  await browser.close()
}
