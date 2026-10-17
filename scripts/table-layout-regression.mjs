import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(
  process.env.MARKUMO_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href
    : 'playwright'
)

const output = 'test-results/table-layout'
fs.mkdirSync(output, { recursive: true })
const module = `fixture-${Date.now()}.ts`

fs.writeFileSync(
  `${output}/fixture.html`,
  `<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`
)

fs.writeFileSync(
  `${output}/${module}`,
  `
import { createApp, h, ref } from 'vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import '/src/editor/markdown/styles.css';

const source = \`## 前置标题

紧接着表格的前置正文段落。

| 标题 A | 标题 B |
| :--- | ---: |
| 数据 1 | 数据 2 |

## 下置标题

这是表格下方的说明文字段落。
\`;

const manager = new DocumentManager([
  { id: 'md', name: 'table.md', path: 'table.md', text: source }
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
`
)

const server = await createServer({ server: { port: 1427, strictPort: false } })
await server.listen()
const port = server.httpServer.address().port

let browser
let page
const results = []
const errors = []

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

async function getTableGeometry(p) {
  return p.evaluate(() => {
    const toolbar = document.querySelector('.md-table-tools.is-active') || document.querySelector('.md-table-tools')
    const table = document.querySelector('.md-prose table')
    const headings = document.querySelectorAll('.md-prose h2')
    const prevHeading = headings[0]
    const nextHeading = headings[1]
    const paragraphs = document.querySelectorAll('.md-prose p')
    const prevParagraph = paragraphs[0]
    const nextParagraph = paragraphs[1]

    const rToolbar = toolbar?.getBoundingClientRect()
    const rTable = table?.getBoundingClientRect()
    const rPrevHeading = prevHeading?.getBoundingClientRect()
    const rNextHeading = nextHeading?.getBoundingClientRect()
    const rPrevP = prevParagraph?.getBoundingClientRect()
    const rNextP = nextParagraph?.getBoundingClientRect()

    return {
      toolbar: rToolbar ? { x: rToolbar.x, y: rToolbar.y, width: rToolbar.width, height: rToolbar.height } : null,
      table: rTable ? { x: rTable.x, y: rTable.y, width: rTable.width, height: rTable.height, top: rTable.top } : null,
      prevHeadingTop: rPrevHeading ? rPrevHeading.top : null,
      nextHeadingTop: rNextHeading ? rNextHeading.top : null,
      prevParagraphBottom: rPrevP ? rPrevP.bottom : null,
      nextParagraphTop: rNextP ? rNextP.top : null,
    }
  })
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}),
  })

  page = await browser.newPage({ viewport: { width: 1200, height: 780 } })
  page.on('pageerror', error => errors.push(error.message))

  await page.goto(`http://localhost:${port}/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. Initial blurred state: table toolbar is hidden (display: none), clean reading view', async () => {
    // Focus outside table
    await page.locator('.md-prose h2').first().click()

    const toolbar = page.locator('.md-table-tools')
    assert.equal(await toolbar.isHidden(), true, 'Table toolbar must be hidden by default when blurred')

    // Screenshot blurred state
    await page.screenshot({ path: `${output}/01-table-blurred.png` })
  })

  await test('2. Click table cell (focused): toolbar appears above table, ZERO shift of table or downstream content', async () => {
    const geoBefore = await getTableGeometry(page)

    // Click into the first cell
    await page.locator('.md-prose td').first().click()

    const toolbar = page.locator('.md-table-tools')
    assert.equal(await toolbar.isVisible(), true, 'Table toolbar must appear when table is focused')

    const geoAfter = await getTableGeometry(page)

    // Table top must not shift
    assert.ok(
      Math.abs(geoBefore.table.top - geoAfter.table.top) <= 1,
      `Table top must NOT shift on focus (before: ${geoBefore.table.top}, after: ${geoAfter.table.top})`
    )

    // Next heading must not shift
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1,
      `Next heading must NOT shift on table focus (before: ${geoBefore.nextHeadingTop}, after: ${geoAfter.nextHeadingTop})`
    )

    // Next paragraph must not shift
    assert.ok(
      Math.abs(geoBefore.nextParagraphTop - geoAfter.nextParagraphTop) <= 1,
      `Next paragraph must NOT shift on table focus (before: ${geoBefore.nextParagraphTop}, after: ${geoAfter.nextParagraphTop})`
    )

    // Toolbar is right above table
    assert.ok(
      geoAfter.toolbar.y + geoAfter.toolbar.height <= geoAfter.table.top + 0.5,
      'Toolbar bottom is positioned above table top'
    )

    // Screenshot focused state
    await page.screenshot({ path: `${output}/02-table-focused.png` })
  })

  await test('3. Click outside table (blur): toolbar hides again, ZERO shift of table or downstream content', async () => {
    const geoBefore = await getTableGeometry(page)

    // Click onto the heading below the table
    await page.locator('.md-prose h2').last().click()

    const toolbar = page.locator('.md-table-tools')
    await toolbar.waitFor({ state: 'hidden' })
    assert.equal(await toolbar.isHidden(), true, 'Toolbar must be hidden again when blurred')

    const geoAfter = await getTableGeometry(page)

    assert.ok(
      Math.abs(geoBefore.table.top - geoAfter.table.top) <= 1,
      `Table top must NOT shift when blurred (before: ${geoBefore.table.top}, after: ${geoAfter.table.top})`
    )
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1,
      `Next heading must NOT shift when table blurred`
    )

    // Screenshot blurred again
    await page.screenshot({ path: `${output}/03-table-blurred-again.png` })
  })

  await test('4. Multiple tables: each table has its own toolbar, only the focused table shows toolbar', async () => {
    const multiSource = `## 表格一

| A1 | B1 |
| --- | --- |
| 1 | 2 |

## 表格二

| X1 | Y1 |
| --- | --- |
| 3 | 4 |

## 尾部`

    await page.evaluate(src => {
      const m = window.fixture.manager
      m.dispatch('md', { changes: { from: 0, to: m.getState('md').doc.length, insert: src } })
    }, multiSource)

    const table1 = page.locator('.md-prose table').nth(0)
    const table2 = page.locator('.md-prose table').nth(1)
    const toolbars = page.locator('.md-table-tools')

    // Blur all
    await page.locator('.md-prose h2').last().click()
    assert.equal(await toolbars.nth(0).isHidden(), true, 'Toolbar 1 hidden when blurred')
    assert.equal(await toolbars.nth(1).isHidden(), true, 'Toolbar 2 hidden when blurred')

    const t1Before = (await table1.boundingBox()).y
    const t2Before = (await table2.boundingBox()).y

    // Focus table 1: only toolbar 1 appears
    await table1.locator('td').first().click()
    assert.equal(await toolbars.nth(0).isVisible(), true, 'Toolbar 1 appears on table 1 focus')
    assert.equal(await toolbars.nth(1).isHidden(), true, 'Toolbar 2 remains hidden')

    const t1After1 = (await table1.boundingBox()).y
    const t2After1 = (await table2.boundingBox()).y
    assert.ok(Math.abs(t1Before - t1After1) <= 1, 'Table 1 does not shift on focus')
    assert.ok(Math.abs(t2Before - t2After1) <= 1, 'Table 2 does not shift when Table 1 focused')

    // Focus table 2: only toolbar 2 appears
    await table2.locator('td').first().click()
    assert.equal(await toolbars.nth(0).isHidden(), true, 'Toolbar 1 hides when table 2 focused')
    assert.equal(await toolbars.nth(1).isVisible(), true, 'Toolbar 2 appears on table 2 focus')

    const t1After2 = (await table1.boundingBox()).y
    const t2After2 = (await table2.boundingBox()).y
    assert.ok(Math.abs(t1Before - t1After2) <= 1, 'Table 1 does not shift when Table 2 focused')
    assert.ok(Math.abs(t2Before - t2After2) <= 1, 'Table 2 does not shift when Table 2 focused')

    // Screenshot multi table focus
    await page.screenshot({ path: `${output}/04-table-multi-focus.png` })
  })

  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  results.push({ name: 'failure', result: 'FAIL', error: String(error) })
  await page.screenshot({ path: `${output}/failure.png` })
  process.exitCode = 1
} finally {
  await fs.promises.writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2))
  await browser?.close()
  await server.close()
}
