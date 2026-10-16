import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/document-conversion'
await mkdir(output, { recursive: true })
const module = `fixture-${Date.now()}.ts`

await writeFile(`${output}/fixture.html`, `<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`)
await writeFile(`${output}/${module}`, `
import { createApp, h, ref } from 'vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import TopBar from '/src/components/layout/TopBar.vue';
import SettingsModal from '/src/components/modals/SettingsModal.vue';
import { ExportController } from '/src/features/document-conversion/ExportController.ts';
import { ImportController } from '/src/features/document-conversion/ImportController.ts';
import { mainMenu } from '/src/features/shell/mainMenu.ts';
import { CommandRegistry } from '/src/features/shell/menuModel.ts';
import { defaultSettings } from '/src/features/shell/editorSettings.ts';
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import '/src/editor/markdown/styles.css';

const source = '# 测试文档标题\\n\\n这是一篇用于导出与导入测试的 **Markdown** 文档。\\n\\n- [x] 功能 A\\n- [ ] 功能 B\\n\\n| 编号 | 名称 |\\n| :--- | :--- |\\n| 001 | Markumo |\\n\\n\`\`\`javascript\\nconsole.log("Export test");\\n\`\`\`\\n\\n> 引用块测试';

const manager = new DocumentManager([
  { id: 'md1', name: 'README.md', path: 'C:/docs/README.md', text: source },
  { id: 'txt1', name: 'plain.txt', path: 'C:/docs/plain.txt', text: 'plain text content' }
]);
manager.open('md1', false);
manager.setMarkdownMode('md1', 'live');
document.body.classList.add('light');

const rev = ref(0);
manager.subscribe(() => rev.value++);

const toastMessage = ref('');
const toast = (msg: string) => { toastMessage.value = msg; };

const exportController = new ExportController(manager, toast);
const importController = new ImportController(manager, toast);
const settings = ref(defaultSettings());
const settingsRef = ref<any>(null);

window.fixture = {
  manager,
  exportController,
  importController,
  openSettings: (id: string) => settingsRef.value?.openSection(id),
  getMainMenu: (canExport: boolean) => mainMenu({
    sidebar: false, outline: false, wrap: false, split: false, focus: false,
    markdown: canExport, composing: false, recentFiles: [], recentWorkspaces: [],
    canExport
  }),
  toastMessage
};

createApp({
  render() {
    rev.value;
    return h('div', { style: 'height:100vh;display:flex;flex-direction:column' }, [
      h(EditorContainer, { doc: manager.activeDocument, manager, showOutline: false, desktop: false }),
      h(SettingsModal, {
        ref: settingsRef,
        theme: 'light',
        uiFontSize: 14,
        fontSize: 14,
        wordWrap: false,
        showOutline: false,
        defaultMdMode: 'live',
        fontFamily: 'system',
        indentSize: 2,
        useTabs: false,
        shortcuts: settings.value.shortcuts,
        autoSave: false,
        autoSaveDelay: 1500,
        imageRules: settings.value.imageRules,
        documentImageRules: null
      })
    ]);
  }
}).mount('#app');
`)

const browser = await chromium.launch(browserOptions)
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
const results = []
const errors = []
page.on('pageerror', e => errors.push(e.message))

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

try {
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. File menu contains "导入 ▸" and "导出 ▸" submenus with full options', async () => {
    const menuMarkdown = await page.evaluate(() => window.fixture.getMainMenu(true))
    const fileGroup = menuMarkdown.find(g => g.id === 'file')
    assert.ok(fileGroup, 'File menu group exists')

    const importSub = fileGroup.items.find(i => i.id === 'import-menu')
    assert.ok(importSub && importSub.type === 'submenu', 'Import submenu exists')
    assert.deepEqual(importSub.children.map(c => c.commandId), ['import-html', 'import-docx'])

    const exportSub = fileGroup.items.find(i => i.id === 'export-menu')
    assert.ok(exportSub && exportSub.type === 'submenu', 'Export submenu exists')
    assert.equal(exportSub.enabled, true, 'Export submenu must be enabled for Markdown')
    assert.ok(exportSub.children.some(c => c.commandId === 'export-pdf'))
    assert.ok(exportSub.children.some(c => c.commandId === 'export-html'))
    assert.ok(exportSub.children.some(c => c.commandId === 'export-html-plain'))
    assert.ok(exportSub.children.some(c => c.commandId === 'export-docx'))
    assert.ok(exportSub.children.some(c => c.commandId === 'export-png'))
    assert.ok(exportSub.children.some(c => c.commandId === 'export-repeat'))
    assert.ok(exportSub.children.some(c => c.commandId === 'export-settings'))
  })

  await test('2. Non-markdown file disables export commands', async () => {
    // Switch to plain text file
    await page.evaluate(() => {
      window.fixture.manager.open('txt1', false)
    })
    const canExport = await page.evaluate(() => window.fixture.exportController.canExportActive())
    assert.equal(canExport, false, 'Non-markdown file cannot be exported')

    const menuPlain = await page.evaluate(() => window.fixture.getMainMenu(false))
    const fileGroup = menuPlain.find(g => g.id === 'file')
    const exportSub = fileGroup.items.find(i => i.id === 'export-menu')
    assert.equal(exportSub?.enabled, false, 'Export submenu must be disabled for non-markdown file')

    // Switch back to markdown
    await page.evaluate(() => {
      window.fixture.manager.open('md1', false)
    })
  })

  await test('3. Export HTML with styling and plain semantic HTML', async () => {
    // Trigger export HTML (styled)
    const styledHtml = await page.evaluate(async () => {
      const { renderMarkdownForExport } = await import('/src/features/document-conversion/ExportRenderer.ts')
      const { buildCompleteHtml } = await import('/src/features/document-conversion/ExportStyles.ts')
      const text = window.fixture.manager.getText('md1')
      const { title, bodyHtml } = await renderMarkdownForExport(text)
      return buildCompleteHtml(title, bodyHtml, true)
    })

    assert.ok(styledHtml.includes('<!DOCTYPE html>'))
    assert.ok(styledHtml.includes('<title>测试文档标题</title>'))
    assert.ok(styledHtml.includes('<style>'))
    assert.ok(styledHtml.includes('class="markumo-document styled"'))
    assert.ok(styledHtml.includes('这是一篇用于导出与导入测试的'))

    // Trigger export HTML (plain)
    const plainHtml = await page.evaluate(async () => {
      const { renderMarkdownForExport } = await import('/src/features/document-conversion/ExportRenderer.ts')
      const { buildCompleteHtml } = await import('/src/features/document-conversion/ExportStyles.ts')
      const text = window.fixture.manager.getText('md1')
      const { title, bodyHtml } = await renderMarkdownForExport(text)
      return buildCompleteHtml(title, bodyHtml, false)
    })

    assert.ok(plainHtml.includes('<!DOCTYPE html>'))
    assert.ok(plainHtml.includes('<title>测试文档标题</title>'))
    assert.ok(!plainHtml.includes('<style>'), 'Plain HTML must NOT contain Markumo style tags')
    assert.ok(plainHtml.includes('class="markumo-document plain"'))
  })

  await test('4. Import HTML converts into new Markdown draft', async () => {
    const sampleHtml = `
      <h1>导入的 HTML 文章</h1>
      <p>这是从 HTML 文件导入的正文内容，包含 <strong>粗体文字</strong> 和 <a href="https://markumo.app">链接</a>。</p>
      <table>
        <tr><th>列 1</th><th>列 2</th></tr>
        <tr><td>数据 1</td><td>数据 2</td></tr>
      </table>
    `
    const importedMarkdown = await page.evaluate(async html => {
      const { importHtmlToMarkdown } = await import('/src/features/document-conversion/HtmlImporter.ts')
      const res = importHtmlToMarkdown(html)
      const id = window.fixture.manager.createUntitled('md')
      window.fixture.manager.dispatch(id, { changes: { from: 0, insert: res.markdown } })
      window.fixture.manager.select(id)
      return { id, text: window.fixture.manager.getText(id) }
    }, sampleHtml)

    assert.ok(importedMarkdown.text.includes('# 导入的 HTML 文章'))
    assert.ok(importedMarkdown.text.includes('**粗体文字**'))
    assert.ok(importedMarkdown.text.includes('| 列 1 | 列 2 |'))
  })

  await test('5. SettingsModal "导入与导出" tab opens, shows Pandoc status and configuration options', async () => {
    // Open settings modal at conversion section
    await page.evaluate(async () => {
      await window.fixture.openSettings('conversion')
    })
    await page.locator('#settings-conversion').waitFor({ state: 'visible' })

    // Check configuration inputs
    assert.equal(await page.locator('#settings-ask-location').isVisible(), true)
    assert.equal(await page.locator('#settings-embed-images').isVisible(), true)
    assert.equal(await page.locator('#settings-pdf-paper').isVisible(), true)
    assert.equal(await page.locator('#settings-pdf-orientation').isVisible(), true)
    assert.equal(await page.locator('#settings-pdf-margins').isVisible(), true)
    assert.equal(await page.locator('#settings-pdf-bg').isVisible(), true)
    assert.equal(await page.locator('#settings-pdf-codewrap').isVisible(), true)

    // Check Pandoc status row
    assert.equal(await page.locator('.pandoc-row').isVisible(), true)

    // Take screenshot of settings modal conversion tab
    await page.screenshot({ path: `${output}/01-settings-conversion.png` })

    // Close settings modal
    await page.locator('.close-btn').click()
    await page.locator('.settingsoverlay').waitFor({ state: 'hidden' })
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
