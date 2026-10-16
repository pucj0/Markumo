import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/markdown-image-deletion'
await mkdir(output, { recursive: true })
const module = `fixture-${Date.now()}.ts`

await writeFile(`${output}/fixture.html`, `<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`)
await writeFile(`${output}/${module}`, `
import { createApp, h, ref } from 'vue';
import { NodeSelection } from 'prosemirror-state';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import '/src/editor/markdown/styles.css';

window.NodeSelection = NodeSelection;
const manager = new DocumentManager([
  { id: 'md', name: 'test.md', path: 'test.md', text: 'initial' }
]);
manager.open('md', false);
document.body.classList.add('light');
const rev = ref(0);
manager.subscribe(() => rev.value++);
window.fixture = {
  manager,
  live: () => manager.liveViews.get('main')?.editor,
  view: () => manager.liveViews.get('main')?.editor.view
};
createApp({
  render() {
    rev.value;
    return h(EditorContainer, { doc: manager.activeDocument, manager, showOutline: false, desktop: false });
  }
}).mount('#app');
`)

const browser = await chromium.launch(browserOptions)
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
const results = []
const errors = []
page.on('pageerror', e => errors.push(e.message))

const raw = () => page.evaluate(() => window.fixture.manager.getText('md'))

async function reset(source) {
  await page.evaluate(source => {
    const m = window.fixture.manager
    m.dispatch('md', { changes: { from: 0, to: m.getState('md').doc.length, insert: source } })
  }, source)
  await page.locator('.md-prose').waitFor()
}

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

try {
  await page.route('**/logo.png', route => route.fulfill({ path: 'tests/fixtures/language-experience/logo.png', contentType: 'image/png' }))
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('Scenario A: Property popup "删除图片" on code_block + standalone image + heading deletes whole paragraph without ghost line', async () => {
    const source = '```java\nSystem.out.println("Hello");\n```\n\n![logo](./logo.png)\n\n## 下一章节'
    await reset(source)
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalWidth > 0)

    // Right-click image to open property popup
    const image = page.locator('.md-live-image img')
    await image.click({ button: 'right' })

    const delBtn = page.getByRole('button', { name: '删除图片', exact: true })
    await delBtn.waitFor()
    await delBtn.click()

    // 1. Image paragraph must be completely deleted
    assert.equal(await raw(), '```java\nSystem.out.println("Hello");\n```\n\n## 下一章节')

    // 2. Document node structure: code_block and heading (no blank paragraph)
    const childTypes = await page.evaluate(() => {
      const doc = window.fixture.view().state.doc
      const types = []
      doc.forEach(n => types.push(n.type.name))
      return types
    })
    assert.deepEqual(childTypes, ['code_block', 'heading'])

    // 3. activeElement must be within editor (not body)
    const activeIsEditor = await page.evaluate(() => {
      return document.activeElement?.closest('.md-prose') !== null
    })
    assert.equal(activeIsEditor, true)

    // 4. Without clicking anywhere, immediately type text
    await page.keyboard.insertText('前置')
    assert.ok((await raw()).includes('前置'))

    // 5. Undo restores original state
    await page.evaluate(() => window.fixture.manager.command('undo'))
    await page.evaluate(() => window.fixture.manager.command('undo'))
    assert.equal(await raw(), source)
  })

  await test('Scenario B: Property popup "删除图片" with inline text preserves surrounding text', async () => {
    const source = '前置文字 ![logo](./logo.png) 后置文字'
    await reset(source)
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalWidth > 0)

    const image = page.locator('.md-live-image img')
    await image.click({ button: 'right' })
    const delBtn = page.getByRole('button', { name: '删除图片', exact: true })
    await delBtn.waitFor()
    await delBtn.click()

    assert.equal(await raw(), '前置文字  后置文字')
    const activeIsEditor = await page.evaluate(() => document.activeElement?.closest('.md-prose') !== null)
    assert.equal(activeIsEditor, true)
  })

  await test('Scenario C: Keyboard deletion of image (NodeSelection) followed immediately by Backspace deletes empty paragraph', async () => {
    const source = '```java\nSystem.out.println("Hello");\n```\n\n![logo](./logo.png)\n\n## 下一章节'
    await reset(source)
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalWidth > 0)

    // Select the image as NodeSelection and focus view
    await page.evaluate(() => {
      const v = window.fixture.view()
      let pos
      v.state.doc.descendants((node, at) => {
        if (node.type.name === 'image' && pos === undefined) pos = at
      })
      v.dispatch(v.state.tr.setSelection(window.NodeSelection.create(v.state.doc, pos)))
      v.focus()
    })

    // Press Backspace: deletes the image node
    await page.keyboard.press('Backspace')

    // Document now has empty paragraph
    const midTypes = await page.evaluate(() => {
      const doc = window.fixture.view().state.doc
      const types = []
      doc.forEach(n => types.push(n.type.name))
      return types
    })
    assert.deepEqual(midTypes, ['code_block', 'paragraph', 'heading'])

    // activeElement must NOT be document.body!
    const activeIsBody = await page.evaluate(() => document.activeElement === document.body)
    assert.equal(activeIsBody, false, 'Focus must not be dropped to body after image deletion')

    // WITHOUT CLICKING ANYWHERE: press Backspace again to delete the empty paragraph
    await page.keyboard.press('Backspace')

    // Empty paragraph must be gone!
    const endTypes = await page.evaluate(() => {
      const doc = window.fixture.view().state.doc
      const types = []
      doc.forEach(n => types.push(n.type.name))
      return types
    })
    assert.deepEqual(endTypes, ['code_block', 'heading'])
    assert.equal(await raw(), '```java\nSystem.out.println("Hello");\n```\n\n## 下一章节')
  })

  await test('Scenario D: Inline source clearing safely exits local source mode without focus loss or ghost line', async () => {
    const source = '段落文字\n\n![logo](./logo.png)\n\n## 章节'
    await reset(source)
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalWidth > 0)

    // Click image to open inline source
    const image = page.locator('.md-live-image img')
    await image.click()
    const input = page.locator('.md-inline-source-input')
    await input.waitFor()

    // Select all text in inline source using Shift+Home and press Backspace
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Backspace')

    // Inline source widget must safely exit
    await page.waitForFunction(() => document.querySelector('.md-inline-source-input') === null)

    // Active element must be within editor (not body)
    const activeIsEditor = await page.evaluate(() => document.activeElement?.closest('.md-prose') !== null)
    assert.equal(activeIsEditor, true)

    // WITHOUT CLICKING ANYWHERE: immediately press Backspace to delete the remaining empty paragraph
    await page.keyboard.press('Backspace')
    assert.equal(await raw(), '段落文字\n\n## 章节')
  })

  await test('Scenario E: Image deletion followed immediately by typing Chinese and English', async () => {
    const source = '![logo](./logo.png)'
    await reset(source)
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalWidth > 0)

    // Click image -> inline source appears -> clear via Shift+Home -> backspace
    const image = page.locator('.md-live-image img')
    await image.click()
    const input = page.locator('.md-inline-source-input')
    await input.waitFor()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Backspace')
    await page.waitForFunction(() => document.querySelector('.md-inline-source-input') === null)

    // Immediately type Chinese and English
    await page.keyboard.insertText('测试文字 Hello World')
    assert.equal(await raw(), '测试文字 Hello World')
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
