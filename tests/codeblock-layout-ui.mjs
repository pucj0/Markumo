import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/codeblock-layout'
await mkdir(output, { recursive: true })
const module = `fixture-${Date.now()}.ts`

await writeFile(`${output}/fixture.html`, `<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`)
await writeFile(`${output}/${module}`, `
import { createApp, h, ref } from 'vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import '/src/editor/markdown/styles.css';

const source = '## 前置章节\\n\\n\`\`\`shell\\necho "Line 1"\\necho "Line 2"\\necho "Line 3"\\n\`\`\`\\n\\n## 下置章节\\n\\n这是一段紧接着下置章节的普通正文。';

const manager = new DocumentManager([
  { id: 'md', name: 'layout.md', path: 'layout.md', text: source }
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

async function getGeometry() {
  return page.evaluate(() => {
    const block = document.querySelector('.md-code-block')
    const surface = block?.querySelector('.md-code-surface')
    const row = block?.querySelector('.md-code-language-row')
    const dock = block?.querySelector('.md-code-language-dock')
    const btn = block?.querySelector('.md-code-lang-btn')
    const input = block?.querySelector('.md-code-language-input')
    const nextHeading = document.querySelectorAll('.md-prose h2')[1]
    const paragraph = document.querySelector('.md-prose p')

    const rBlock = block?.getBoundingClientRect()
    const rSurface = surface?.getBoundingClientRect()
    const rRow = row?.getBoundingClientRect()
    const rDock = dock?.getBoundingClientRect()
    const rBtn = btn?.getBoundingClientRect()
    const rInput = input?.getBoundingClientRect()
    const rHeading = nextHeading?.getBoundingClientRect()
    const rP = paragraph?.getBoundingClientRect()

    return {
      block: rBlock ? { x: rBlock.x, y: rBlock.y, width: rBlock.width, height: rBlock.height } : null,
      surface: rSurface ? { x: rSurface.x, y: rSurface.y, width: rSurface.width, height: rSurface.height } : null,
      row: rRow ? { x: rRow.x, y: rRow.y, width: rRow.width, height: rRow.height } : null,
      dock: rDock ? { x: rDock.x, y: rDock.y, width: rDock.width, height: rDock.height } : null,
      btn: rBtn ? { x: rBtn.x, y: rBtn.y, width: rBtn.width, height: rBtn.height } : null,
      input: rInput ? { x: rInput.x, y: rInput.y, width: rInput.width, height: rInput.height } : null,
      nextHeadingTop: rHeading ? rHeading.top : null,
      paragraphTop: rP ? rP.top : null,
    }
  })
}

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

try {
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. Initial blurred state: language tag hidden by default (display: none), next heading positioned stably', async () => {
    // Click outside to ensure blurred state
    await page.locator('.md-prose h2').first().click()
    const row = page.locator('.md-code-language-row')
    assert.equal(await row.isHidden(), true, 'Language row must be hidden by default when blurred')

    // Screenshot blurred state (clean, no language box)
    await page.screenshot({ path: `${output}/01-codeblock-blurred.png` })
  })

  await test('2 & 3. Focus codeblock (editing): language tag appears at bottom right, overall height identical, next heading top changes <= 1px', async () => {
    const geoBefore = await getGeometry()

    // Click into CodeMirror inside the code block to enter editing mode
    await page.locator('.md-code-block .cm-content').click()

    const row = page.locator('.md-code-language-row')
    assert.equal(await row.isVisible(), true, 'Language tag must appear when editing code block')
    const btn = page.locator('.md-code-lang-btn')
    assert.equal(await btn.textContent(), 'Shell')

    const geoAfter = await getGeometry()

    // Height identical (because tag is absolute positioned at bottom-right)
    assert.ok(
      Math.abs(geoBefore.block.height - geoAfter.block.height) <= 1,
      `Code block height must not change on focus (before: ${geoBefore.block.height}, after: ${geoAfter.block.height})`
    )

    // Next heading Y position variation <= 1px
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1,
      `Next heading top must not shift on focus (before: ${geoBefore.nextHeadingTop}, after: ${geoAfter.nextHeadingTop})`
    )

    // Screenshot focused state
    await page.screenshot({ path: `${output}/02-codeblock-focused.png` })
  })

  await test('4. Click language bar: switch button to input in-place without height or layout shift', async () => {
    const geoBefore = await getGeometry()

    // Click the language button to enter editing mode
    await page.locator('.md-code-lang-btn').click()
    const input = page.locator('.md-code-language-input')
    await input.waitFor({ state: 'visible' })

    const geoAfter = await getGeometry()

    // Dock dimensions and code block height remain unchanged
    assert.ok(Math.abs(geoBefore.block.height - geoAfter.block.height) <= 1, 'Codeblock height unchanged when editing language')
    assert.ok(Math.abs(geoBefore.dock.height - geoAfter.dock.height) <= 1, 'Dock height unchanged when editing language')
    assert.ok(Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1, 'Next heading Y position unchanged when editing language')

    // Input dimensions: compact pill, height ~22px
    assert.ok(geoAfter.input.width >= 50 && geoAfter.input.width <= 220, `Input width valid (got ${geoAfter.input.width})`)
    assert.ok(Math.abs(geoAfter.input.height - 22) <= 2, `Input height ~22px (got ${geoAfter.input.height})`)

    // Screenshot language input active
    await page.screenshot({ path: `${output}/03-language-input-active.png` })
  })

  await test('5 & 6. Language dropdown candidates: opens floating popup, next heading position unchanged; closes without shift', async () => {
    const geoBefore = await getGeometry()

    // Type 'ja' to filter candidates
    await page.locator('.md-code-language-input').fill('ja')
    const menu = page.locator('.md-language-menu')
    await menu.waitFor({ state: 'visible' })

    const geoOpen = await getGeometry()
    // Dropdown is position: fixed floating overlay, does not push next heading
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoOpen.nextHeadingTop) <= 1,
      `Next heading must NOT move when candidates open (before: ${geoBefore.nextHeadingTop}, open: ${geoOpen.nextHeadingTop})`
    )
    assert.ok(
      Math.abs(geoBefore.block.height - geoOpen.block.height) <= 1,
      `Code block height must NOT change when candidates open`
    )

    // Screenshot candidates popup expanded
    await page.screenshot({ path: `${output}/04-language-candidates-expanded.png` })

    // Press Escape to dismiss dropdown
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })

    const geoClosed = await getGeometry()
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoClosed.nextHeadingTop) <= 1,
      `Next heading must NOT move when candidates close`
    )
  })

  await test('7. Select language (choose Java): updates markdown fence & CodeMirror without layout shift', async () => {
    const geoBefore = await getGeometry()

    // Focus code block to reveal language button
    await page.locator('.md-code-block .cm-content').click()
    await page.locator('.md-code-lang-btn').click()
    const input = page.locator('.md-code-language-input')
    await input.waitFor({ state: 'visible' })
    await input.fill('java')
    await page.locator('.md-language-menu').waitFor({ state: 'visible' })

    // Click java option
    const javaOption = page.locator('.md-language-option', { hasText: 'Java' }).first()
    await javaOption.click()

    // Input recovers to button showing 'Java'
    const btn = page.locator('.md-code-lang-btn')
    await btn.waitFor({ state: 'visible' })
    assert.equal(await btn.textContent(), 'Java')

    // Markdown source updated
    assert.ok((await raw()).startsWith('## 前置章节\n\n```java\n'))

    const geoAfter = await getGeometry()
    assert.ok(Math.abs(geoBefore.block.height - geoAfter.block.height) <= 1, 'Code block height unchanged after language selection')
    assert.ok(Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1, 'Next heading Y position unchanged after language selection')

    // Screenshot after language selected
    await page.screenshot({ path: `${output}/05-language-selected-java.png` })
  })

  await test('8. Window resize across different viewport widths: dock stays right-aligned without overlap', async () => {
    // Focus code block
    await page.locator('.md-code-block .cm-content').click()
    for (const width of [1200, 900, 600]) {
      await page.setViewportSize({ width, height: 850 })
      const geo = await getGeometry()
      const surfaceRight = geo.surface.x + geo.surface.width
      const dockRight = geo.dock.x + geo.dock.width
      assert.ok(dockRight <= surfaceRight + 1 && dockRight >= surfaceRight - 16, `Dock right aligns near surface right (offset: ${surfaceRight - dockRight}) at width ${width}`)
    }
    await page.setViewportSize({ width: 1200, height: 850 })
  })

  await test('9. Single-line code block: copy button inside surface does NOT overlap language bar below', async () => {
    const sourceSingle = '```\nnpm install\n```\n\n## 下一章节'
    await reset(sourceSingle)
    const block = page.locator('.md-code-block').first()
    const surface = block.locator('.md-code-surface')
    const row = block.locator('.md-code-language-row')
    const copyBtn = block.locator('.md-code-copy')
    const btn = block.locator('.md-code-lang-btn')

    assert.equal(await btn.textContent(), '代码语言', 'Default label when no language specified is "代码语言"')
    // Default blurred state: language tag is hidden (display: none)
    assert.equal(await row.isHidden(), true)

    // Focus single-line code block: language tag appears
    await block.locator('.cm-content').click()
    assert.equal(await row.isVisible(), true)

    // Hover surface to reveal copy button
    await surface.hover()
    await page.waitForFunction(el => parseFloat(getComputedStyle(el).opacity) > 0.8, await copyBtn.elementHandle())
    const copyBox = await copyBtn.boundingBox()
    const btnBox = await btn.boundingBox()
    assert.ok(copyBox && btnBox, 'Both exist')
    // Copy button is at top right, language button is at bottom right
    assert.ok(copyBox.y < btnBox.y, 'Copy button is above language button')

    await page.screenshot({ path: `${output}/06-single-line-codeblock.png` })
  })

  await test('10. Consecutive code blocks and Dark theme compatibility', async () => {
    const sourceMulti = '```python\nprint(1)\n```\n\n```rust\nfn main() {}\n```\n\n## 尾部章节'
    await reset(sourceMulti)
    await page.locator('.md-prose h2').last().click()

    // Switch to dark theme
    await page.evaluate(() => {
      document.body.classList.remove('light')
      document.body.classList.add('dark')
    })

    const rows = page.locator('.md-code-language-row')
    // Both blurred by default: hidden
    assert.equal(await rows.nth(0).isHidden(), true)
    assert.equal(await rows.nth(1).isHidden(), true)

    // Click second block, second block language row becomes visible, first block remains hidden
    await page.locator('.md-code-block').nth(1).locator('.cm-content').click()
    assert.equal(await rows.nth(1).isVisible(), true)
    assert.equal(await rows.nth(0).isHidden(), true)

    // Screenshot dark theme consecutive code blocks
    await page.screenshot({ path: `${output}/07-dark-theme-consecutive.png` })

    // Restore light theme
    await page.evaluate(() => {
      document.body.classList.remove('dark')
      document.body.classList.add('light')
    })
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
