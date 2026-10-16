import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

import { chromium, browserOptions } from './helpers/markdown-browser.mjs'
import { selectCodeLanguage } from './helpers/code-language.mjs'

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

const browser = await chromium.launch(browserOptions)
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
const results = []
const errors = []

page.on('pageerror', e => errors.push(e.stack || e.message))

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

  await test('0. Initial opening automatically renders SVG and inline/block KaTeX without clicks', async () => {
    await page.locator('.md-diagram svg').waitFor({ timeout: 60000 })
    assert.ok((await page.locator('.md-diagram svg').textContent()).includes('新生幼崽登记'))
    await page.locator('.md-inline-math .katex').first().waitFor()
    await page.locator('.md-math-output .katex-display').waitFor()
    const diagram = page.locator('.md-code-block').filter({ has: page.locator('.md-diagram svg') })
    assert.equal(await diagram.locator('.md-code-editor-wrap').isVisible(), false)
    assert.equal(await page.getByRole('button', { name: '渲染 Mermaid', exact: true }).isVisible(), false)
    assert.equal(await raw(), markdown.replace(/\r\n/g, '\n'))
    await page.screenshot({ path: `${output}/initial-default.png` })
  })

  // Full document screenshots
  await page.evaluate(() => {
    document.querySelector('.markdown-live').scrollTop = 0
    document.body.classList.remove('light')
  })
  await page.screenshot({ path: `${output}/parity-document-dark.png` })
  await page.evaluate(() => document.body.classList.add('light'))
  await page.locator('.md-diagram svg').waitFor()
  await page.screenshot({ path: `${output}/parity-document-light.png` })
  await page.evaluate(() => document.body.classList.remove('light'))

  // Record actual settings and every requested visual element. These are
  // LightEdit observations; comparison remains UNVERIFIED without a reference.
  const visual = { viewport: page.viewportSize(), deviceScaleFactor: 1, reference: null, comparison: 'UNVERIFIED', themes: {} }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.body.classList.toggle('light', theme === 'light'), theme)
    await page.locator('.md-diagram svg').waitFor()
    await page.evaluate(() => document.fonts.ready)
    const observations = {}
    for (const [name, selector] of Object.entries({ heading: '.md-prose h1', paragraph: '.md-prose > p', list: '.md-prose ol', table: '.md-prose table', code: '.md-code-block', image: '.md-live-image', link: '.md-prose a', math: '.md-math-output', diagram: '.md-diagram svg' })) {
      const element = page.locator(selector).first()
      await element.scrollIntoViewIfNeeded()
      observations[name] = await element.evaluate(el => {
        const css = getComputedStyle(el), rect = el.getBoundingClientRect(), prose = document.querySelector('.md-prose')
        return { width: rect.width, height: rect.height, fontSize: css.fontSize, lineHeight: css.lineHeight, fontFamily: css.fontFamily, margin: css.margin, contentWidth: prose.getBoundingClientRect().width, zoom: getComputedStyle(document.body).zoom }
      })
      await page.screenshot({ path: `${output}/visual-${theme}-${name}.png` })
    }
    visual.themes[theme] = observations
  }
  await writeFile(`${output}/visual-observations.json`, JSON.stringify(visual, null, 2))
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
  await test('3. Click link exposes native inline Markdown at a collapsed caret, without a popover', async () => {
    const link = page.locator('.md-prose a').filter({ hasText: 'GitHub 仓库' }).first()
    await link.scrollIntoViewIfNeeded()
    await link.click()
    await page.locator('.md-inline-source-input').waitFor()
    assert.equal(await page.locator('.md-properties').isVisible(), false)
    assert.equal(await page.evaluate(()=>document.getSelection().isCollapsed), true)
    await page.screenshot({ path: `${output}/step3-link-inline.png` })
    await page.locator('.md-inline-source-input').fill('[开源仓库](https://github.com/pucj0/lightEdit)')
    await page.keyboard.press('Escape')
    assert.ok((await raw()).includes('[开源仓库]('))

    // Restore via undo
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.ok((await raw()).includes('[GitHub 仓库]('))
  })

  // 4. Click image: selection outline and anchored image toolbar
  await test('4. Image click exposes source above preview; context menu explicitly opens mapped properties', async () => {
    const img = page.locator('.md-image-preview img').first()
    await img.scrollIntoViewIfNeeded()
    await img.click()
    await page.locator('.md-inline-source-input').waitFor()
    assert.equal(await img.isVisible(), true)
    assert.ok((await page.locator('.md-local-source').boundingBox()).y < (await img.boundingBox()).y)
    await img.click({button:'right'})
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
    assert.equal(await codeBlock.locator('.md-code-lang > button').textContent(), 'JavaScript')
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
    await page.locator('.md-diagram svg').waitFor({ timeout: 60000 })
    assert.ok((await page.locator('.md-diagram svg').count()) >= 1)
    await page.screenshot({ path: `${output}/step9-mermaid-diagram.png` })
    const block = page.locator('.md-code-block').filter({ has: page.locator('.md-diagram svg') })
    await block.getByRole('button', { name: '编辑图表源码', exact: true }).click()
    assert.equal(await block.locator('.md-code-editor-wrap').isVisible(), true)
    await block.getByRole('button', { name: '完成编辑', exact: true }).click()
    assert.equal(await block.locator('.md-code-editor-wrap').isVisible(), false)
    await block.locator('.md-diagram svg').waitFor()
  })

  await test('11. Inline and block formula edits render automatically and share undo', async () => {
    for (const selector of ['.md-inline-math', '.md-math-output']) {
      const before = await raw(), formula = page.locator(selector).first()
      await formula.click()
      await formula.getByLabel('公式源码', { exact: true }).fill('x^2+1')
      assert.equal(await page.getByRole('button', { name: '应用公式', exact: true }).count(), 0)
      await page.waitForFunction(()=>document.querySelector('.md-math-editing annotation')?.textContent === 'x^2+1')
      await formula.getByLabel('公式源码', { exact: true }).press('Escape')
      await formula.locator('.katex').waitFor()
      assert.ok((await raw()).includes('x^2+1'))
      await page.evaluate(() => window.fixture.manager.command('undo'))
      assert.equal(await raw(), before)
    }
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

  await test('12. Image targets map across panes and stale apply/delete cannot touch an identical neighbour', async () => {
    const source = 'before\n\n![first](./assets/pixel.png)\n\n![second](./assets/pixel.png)\n'
    await page.evaluate(source => {
      const m = window.fixture.manager
      m.dispatch('md', { changes: { from: 0, to: m.getState('md').doc.length, insert: source } })
      m.focusPane('main', false); m.splitEditor()
    }, source)
    await page.waitForFunction(() => document.querySelectorAll('.md-prose').length === 2)
    const main = page.locator('.main-pane'), image = main.locator('.md-live-image img').first()
    await image.click({button:'right'})
    await page.evaluate(() => {
      const m = window.fixture.manager, v = [...m.liveViews.entries()].find(([p]) => p !== 'main')[1].editor.view
      v.dispatch(v.state.tr.insertText('远端前插 ', 1))
    })
    await main.getByLabel('图片替代文字').fill('mapped-first')
    await main.getByRole('button', { name: '应用图片', exact: true }).click()
    assert.ok((await raw()).includes('![mapped-first]'))
    assert.ok((await raw()).includes('![second]'))
    await image.click({button:'right'})
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.main-pane .md-properties button')]
      window.oldImageHandlers = buttons.filter(b => /应用图片|删除图片/.test(b.textContent)).map(b => b.onclick)
      const m = window.fixture.manager, v = [...m.liveViews.entries()].find(([p]) => p !== 'main')[1].editor.view
      let pos
      v.state.doc.descendants((node, at) => { if (pos === undefined && node.type.name === 'image') pos = at })
      v.dispatch(v.state.tr.delete(pos, pos + 1))
    })
    assert.equal(await main.locator('.md-properties').isVisible(), false)
    const before = await raw()
    await page.evaluate(() => window.oldImageHandlers.forEach(fn => fn(new MouseEvent('click'))))
    assert.equal(await raw(), before)
    assert.ok(before.includes('![second]'))
    await page.evaluate(() => { const m = window.fixture.manager; m.focusPane('main', false); m.mergeAllPanes() })
    await page.waitForFunction(() => document.querySelectorAll('.md-prose').length === 1)
  })

  await test('13. Live replacements preserve marks, URL, table and code, refresh after pane edits, undo once', async () => {
    const source = '# Unchanged\n\nfoo**bar**[baz](https://example.com)\n\n| Key | Value |\n| :--- | ---: |\n| 中文 | keep |\n\n```js\nconst item42 = 1\n```\n'
    await page.evaluate(source => {
      const m = window.fixture.manager
      m.dispatch('md', { changes: { from: 0, to: m.getState('md').doc.length, insert: source } })
      m.focusPane('main', false); m.splitEditor()
    }, source)
    await page.waitForFunction(() => document.querySelectorAll('.md-prose').length === 2)
    const main = page.locator('.main-pane'), panel = main.locator('.md-live-search')
    await main.locator('.md-prose h1').click(); await page.keyboard.press('Control+r')
    await panel.locator('input[name="search"]').fill('foobarbaz')
    await panel.locator('input[name="replace"]').fill('FOOBARBAZ')
    await page.evaluate(() => {
      const m = window.fixture.manager, v = [...m.liveViews.entries()].find(([p]) => p !== 'main')[1].editor.view
      v.dispatch(v.state.tr.insertText('远端 ', 1))
    })
    const before = await raw()
    await panel.getByRole('button', { name: '全部替换', exact: true }).click()
    assert.equal(await raw(), before.replace('foo**bar**[baz]', 'FOO**BAR**[BAZ]'))
    await page.evaluate(() => { const m = window.fixture.manager; m.focusPane('main', false); m.command('undo') })
    assert.equal(await raw(), before)
    await panel.locator('input[name="search"]').fill('(?<=const )(?<name>item)(\\d+)')
    await panel.locator('input[name="re"]').check()
    await panel.locator('input[name="replace"]').fill('$<name>_$2')
    await panel.getByRole('button', { name: '全部替换', exact: true }).click()
    assert.equal(await raw(), before.replace('item42', 'item_42'))
    assert.equal(await main.locator('.md-prose').isVisible(), true)
    assert.equal(await page.evaluate(() => window.fixture.manager.metadata('md').mode), 'live')
    await page.evaluate(() => { const m = window.fixture.manager; m.focusPane('main', false); m.command('undo') })
    assert.equal(await raw(), before)
    await panel.locator('input[name="search"]').fill('中文')
    await panel.locator('input[name="replace"]').fill('汉字')
    await panel.getByRole('button', { name: '全部替换', exact: true }).click()
    assert.equal(await raw(), before.replace('中文', '汉字'))
    await page.evaluate(() => { const m = window.fixture.manager; m.focusPane('main', false); m.command('undo'); m.mergeAllPanes() })
    assert.equal(await raw(), before)
  })

  await test('14. Protected block transitions to/from rendered math; changing code language to Mermaid defaults to SVG', async () => {
    await page.waitForFunction(() => document.querySelectorAll('.md-prose').length === 1)
    await page.evaluate(() => {
      const m = window.fixture.manager
      m.dispatch('md', { changes: { from: 0, to: m.getState('md').doc.length, insert: '---\ntitle: fixture\n---\n\nend' } })
      const v = window.fixture.view()
      v.dispatch(v.state.tr.setNodeMarkup(0, undefined, { ...v.state.doc.firstChild.attrs, source: '$$\ny=1\n$$' }))
    })
    await page.locator('.md-math-output .katex').waitFor()
    await page.evaluate(() => {
      const v = window.fixture.view()
      v.dispatch(v.state.tr.setNodeMarkup(0, undefined, { ...v.state.doc.firstChild.attrs, source: ':::unknown\nprotected' }))
    })
    assert.equal(await page.locator('.md-math-output').count(), 0)
    await page.locator('.md-protected').waitFor()
    await page.evaluate(() => {
      const m = window.fixture.manager
      m.dispatch('md', { changes: { from: 0, to: m.getState('md').doc.length, insert: '```text\ngraph LR\n A[中文] --> B[End]\n```' } })
    })
    const code = page.locator('.md-code-block')
    await selectCodeLanguage(code,'mermaid','Mermaid')
    await code.locator('.md-diagram svg').waitFor()
    assert.equal(await code.locator('.md-code-editor-wrap').isVisible(), false)
    const before = await raw()
    await page.evaluate(() => document.body.classList.add('light'))
    await code.locator('.md-diagram svg').waitFor()
    assert.ok((await code.locator('.md-diagram svg').textContent()).includes('中文'))
    assert.equal(await raw(), before)
    await selectCodeLanguage(code,'text','Plain Text')
    assert.equal(await code.locator('.md-code-editor-wrap').isVisible(), true)
    assert.equal(await code.locator('.md-diagram').isVisible(), false)
  })

  await test('15. YAML and TOC have no permanent source controls; metadata edits stay local and undo exactly',async()=>{
    const source='---\ntitle: original\n---\n\n# Heading\n\n[toc]\n\nend'
    await page.evaluate(source=>{const m=window.fixture.manager;m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:source}})},source)
    const yaml=page.locator('.md-yaml-preview')
    assert.equal(await yaml.locator('..').locator('details').isVisible(),false)
    assert.equal(await page.locator('.md-toc').locator('..').locator('details').isVisible(),false)
    assert.equal(await raw(),source)
    await yaml.click()
    const input=page.locator('.md-extension').filter({has:page.locator('.md-yaml-preview')}).locator('textarea')
    await input.fill('---\ntitle: updated\n---');await input.press('Escape')
    assert.equal(await raw(),source.replace('title: original','title: updated'))
    assert.equal(await yaml.isVisible(),true)
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),source)
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
