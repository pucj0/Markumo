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

const source = '### 前置标题\\n\\n\`\`\`shell\\necho "Line 1"\\n\`\`\`\\n\\n这是紧随代码块下方的普通段落，用于验证悬浮语言栏绝对定位不推动文档流。\\n\\n### 下一个标题\\n\\n这是下一个章节的说明文字。';

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
    const copy = block?.querySelector('.md-code-copy')
    const headings = document.querySelectorAll('.md-prose h3')
    const prevHeading = headings[0]
    const nextHeading = headings[1]
    const paragraph = document.querySelector('.md-prose p')

    const rBlock = block?.getBoundingClientRect()
    const rSurface = surface?.getBoundingClientRect()
    const rRow = row?.getBoundingClientRect()
    const rDock = dock?.getBoundingClientRect()
    const rBtn = btn?.getBoundingClientRect()
    const rInput = input?.getBoundingClientRect()
    const rCopy = copy?.getBoundingClientRect()
    const rPrevH = prevHeading?.getBoundingClientRect()
    const rNextH = nextHeading?.getBoundingClientRect()
    const rP = paragraph?.getBoundingClientRect()

    return {
      block: rBlock ? { x: rBlock.x, y: rBlock.y, width: rBlock.width, height: rBlock.height, bottom: rBlock.bottom, right: rBlock.right } : null,
      surface: rSurface ? { x: rSurface.x, y: rSurface.y, width: rSurface.width, height: rSurface.height, bottom: rSurface.bottom, right: rSurface.right } : null,
      row: rRow ? { x: rRow.x, y: rRow.y, width: rRow.width, height: rRow.height, top: rRow.top, bottom: rRow.bottom, right: rRow.right } : null,
      dock: rDock ? { x: rDock.x, y: rDock.y, width: rDock.width, height: rDock.height, top: rDock.top, bottom: rDock.bottom, right: rDock.right } : null,
      btn: rBtn ? { x: rBtn.x, y: rBtn.y, width: rBtn.width, height: rBtn.height } : null,
      input: rInput ? { x: rInput.x, y: rInput.y, width: rInput.width, height: rInput.height } : null,
      copy: rCopy ? { x: rCopy.x, y: rCopy.y, width: rCopy.width, height: rCopy.height } : null,
      prevHeadingBottom: rPrevH ? rPrevH.bottom : null,
      nextHeadingTop: rNextH ? rNextH.top : null,
      paragraphTop: rP ? rP.top : null,
      paragraphBottom: rP ? rP.bottom : null,
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

  await test('1. Initial unfocused state (Typora Fig 2): language bar is hidden, clean code block', async () => {
    // Focus outside to ensure blurred state
    await page.locator('.md-prose h3').first().click()
    const row = page.locator('.md-code-language-row')
    assert.equal(await row.isHidden(), true, 'Language bar must be hidden (display: none) by default when unfocused')

    const copyBtn = page.locator('.md-code-copy')
    const copyOpacity = await copyBtn.evaluate(el => parseFloat(getComputedStyle(el).opacity))
    assert.equal(copyOpacity, 0, 'Copy button must be hidden when unfocused and unhovered')

    // Screenshot unfocused state matching Typora Fig 2
    await page.screenshot({ path: `${output}/01-codeblock-blurred.png` })
  })

  await test('2. Focused code block (Typora Fig 3): floating language bar outside bottom-right, zero shift of downstream content', async () => {
    const geoBefore = await getGeometry()

    // Click into CodeMirror inside the code block
    await page.locator('.md-code-block .cm-content').click()

    const row = page.locator('.md-code-language-row')
    assert.equal(await row.isVisible(), true, 'Language bar must appear when code block is focused')

    const btn = page.locator('.md-code-lang-btn')
    assert.equal(await btn.textContent(), 'Shell')

    const geoAfter = await getGeometry()

    // Assert 1: Language bar top is greater than code box bottom, distance ~4px
    assert.ok(geoAfter.row.top > geoAfter.surface.bottom, `Language bar top (${geoAfter.row.top}) must be below code box bottom (${geoAfter.surface.bottom})`)
    const gap = geoAfter.row.top - geoAfter.surface.bottom
    assert.ok(Math.abs(gap - 4) <= 2, `Distance between code box bottom and language bar top ~4px (got ${gap}px)`)

    // Assert 2: Language bar right aligns with code box right (difference <= 2px)
    assert.ok(Math.abs(geoAfter.row.right - geoAfter.surface.right) <= 2, `Language bar right (${geoAfter.row.right}) aligns with surface right (${geoAfter.surface.right})`)

    // Assert 3: Language bar dimensions width ~180px, height ~24px
    assert.ok(Math.abs(geoAfter.dock.width - 180) <= 2, `Dock width ~180px (got ${geoAfter.dock.width}px)`)
    assert.ok(Math.abs(geoAfter.dock.height - 24) <= 2, `Dock height ~24px (got ${geoAfter.dock.height}px)`)

    // Assert 4: Downstream paragraph Y coordinate changes <= 1px
    assert.ok(
      Math.abs(geoBefore.paragraphTop - geoAfter.paragraphTop) <= 1,
      `Downstream paragraph top must NOT move (before: ${geoBefore.paragraphTop}, after: ${geoAfter.paragraphTop})`
    )

    // Assert 5: Downstream heading Y coordinate changes <= 1px
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1,
      `Downstream heading top must NOT move (before: ${geoBefore.nextHeadingTop}, after: ${geoAfter.nextHeadingTop})`
    )

    // Screenshot focused state matching Typora Fig 3
    await page.screenshot({ path: `${output}/02-codeblock-focused.png` })
  })

  await test('3. Click language bar: in-place input toggle without height change or paragraph shift', async () => {
    const geoBefore = await getGeometry()

    // Click the language button to switch to input
    await page.locator('.md-code-lang-btn').click()
    const input = page.locator('.md-code-language-input')
    await input.waitFor({ state: 'visible' })

    const geoAfter = await getGeometry()

    // Input dimensions and text alignment
    assert.ok(Math.abs(geoAfter.input.width - 138) <= 4, `Input width ~138px (got ${geoAfter.input.width}px)`)
    assert.ok(Math.abs(geoAfter.input.height - 18) <= 2, `Input height ~18px (got ${geoAfter.input.height}px)`)
    const align = await input.evaluate(el => getComputedStyle(el).textAlign)
    assert.equal(align, 'center', 'Input text-align must be center')

    // Downstream content does not move
    assert.ok(Math.abs(geoBefore.paragraphTop - geoAfter.paragraphTop) <= 1)
    assert.ok(Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1)

    // Screenshot input active
    await page.screenshot({ path: `${output}/03-language-input-active.png` })
  })

  await test('4. Type "ja": floating candidates dropdown opens over content without shifting text', async () => {
    const geoBefore = await getGeometry()

    await page.locator('.md-code-language-input').fill('ja')
    const menu = page.locator('.md-language-menu')
    await menu.waitFor({ state: 'visible' })

    const geoOpen = await getGeometry()
    // Downstream paragraph and heading do not shift
    assert.ok(Math.abs(geoBefore.paragraphTop - geoOpen.paragraphTop) <= 1, 'Paragraph unchanged when dropdown opens')
    assert.ok(Math.abs(geoBefore.nextHeadingTop - geoOpen.nextHeadingTop) <= 1, 'Heading unchanged when dropdown opens')

    // Candidates show with icons
    const options = page.locator('.md-language-option')
    assert.ok((await options.count()) >= 3, 'Candidates list contains options')

    // Screenshot candidates expanded
    await page.screenshot({ path: `${output}/04-language-candidates-ja.png` })

    // Press Escape to dismiss dropdown
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })

    const geoClosed = await getGeometry()
    assert.ok(Math.abs(geoBefore.paragraphTop - geoClosed.paragraphTop) <= 1, 'Paragraph unchanged when dropdown closes')
  })

  await test('5. Select language (choose Java): updates fence and button without layout shift', async () => {
    const geoBefore = await getGeometry()

    await page.locator('.md-code-block .cm-content').click()
    await page.locator('.md-code-lang-btn').click()
    const input = page.locator('.md-code-language-input')
    await input.waitFor({ state: 'visible' })
    await input.fill('java')
    await page.locator('.md-language-menu').waitFor({ state: 'visible' })

    const javaOption = page.locator('.md-language-option', { hasText: 'Java' }).first()
    await javaOption.click()

    const btn = page.locator('.md-code-lang-btn')
    await btn.waitFor({ state: 'visible' })
    assert.equal(await btn.textContent(), 'Java')

    assert.ok((await raw()).includes('```java\n'))

    const geoAfter = await getGeometry()
    assert.ok(Math.abs(geoBefore.paragraphTop - geoAfter.paragraphTop) <= 1)
    assert.ok(Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1)

    // Full page screenshot
    await page.screenshot({ path: `${output}/05-full-page-with-heading.png` })
  })

  await test('6. Copy button at top-right inside surface does NOT intersect language bar at bottom-right outside surface', async () => {
    const block = page.locator('.md-code-block').first()
    const surface = block.locator('.md-code-surface')
    const copyBtn = block.locator('.md-code-copy')
    const row = block.locator('.md-code-language-row')

    // Focus code block
    await block.locator('.cm-content').click()
    assert.equal(await row.isVisible(), true)

    // Hover surface to reveal copy button
    await surface.hover()
    await page.waitForFunction(el => parseFloat(getComputedStyle(el).opacity) > 0.8, await copyBtn.elementHandle())

    const boxCopy = await copyBtn.boundingBox()
    const boxRow = await row.boundingBox()
    assert.ok(boxCopy && boxRow, 'Both bounding boxes exist')

    // Copy button is inside surface top-right (bottom <= surface bottom)
    // Language bar is outside surface bottom-right (top >= surface bottom + 3)
    assert.ok(boxCopy.y + boxCopy.height < boxRow.y, `Copy button bottom (${boxCopy.y + boxCopy.height}) must be strictly above language bar top (${boxRow.y})`)
  })

  await test('7. Multi-line code block also positions floating language bar correctly', async () => {
    const multiSource = '### 前置标题\n\n```javascript\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconsole.log(a + b + c);\n```\n\n下方段落。'
    await reset(multiSource)

    const block = page.locator('.md-code-block').first()
    const row = block.locator('.md-code-language-row')

    // Unfocused
    await page.locator('.md-prose h3').first().click()
    assert.equal(await row.isHidden(), true)
    const pTopBefore = (await page.locator('.md-prose p').boundingBox()).y

    // Focus
    await block.locator('.cm-content').click()
    assert.equal(await row.isVisible(), true)
    const pTopAfter = (await page.locator('.md-prose p').boundingBox()).y
    assert.ok(Math.abs(pTopBefore - pTopAfter) <= 1, 'Multi-line code block does not shift downstream paragraph on focus')

    const geo = await getGeometry()
    assert.ok(geo.row.top > geo.surface.bottom)
    assert.ok(Math.abs(geo.row.right - geo.surface.right) <= 2)
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
