import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'

const output = 'test-results/table-layout'
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

const source = '## 前置标题\\n\\n紧接着表格的前置正文段落。\\n\\n| 标题 A | 标题 B |\\n| :--- | ---: |\\n| 数据 1 | 数据 2 |\\n\\n## 下置标题\\n\\n这是表格下方的说明文字段落。';

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

async function getTableGeometry() {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.md-table-tools')
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

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

try {
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()

  await test('1. Initial blurred state: table toolbar directly displayed above table, geometry stable', async () => {
    // Focus outside table
    await page.locator('.md-prose h2').first().click()

    const toolbar = page.locator('.md-table-tools')
    assert.equal(await toolbar.isVisible(), true, 'Table toolbar must be visible initially even when table is blurred')

    const geo = await getTableGeometry()
    assert.ok(geo.toolbar && geo.table, 'Toolbar and table exist')
    assert.ok(Math.abs(geo.toolbar.height - 24) <= 1, `Toolbar height ~24px (got ${geo.toolbar.height})`)
    assert.ok(geo.toolbar.y + geo.toolbar.height <= geo.table.top + 0.5, 'Toolbar is positioned right above table')
    assert.ok(Math.abs(geo.toolbar.width - geo.table.width) <= 2, 'Toolbar width matches table width')

    // Screenshot initial blurred state
    await page.screenshot({ path: `${output}/01-table-blurred.png` })
  })

  await test('2. Click table cell: zero layout displacement (table top & next heading shift <= 1px)', async () => {
    const geoBefore = await getTableGeometry()

    // Click into the first cell
    await page.locator('.md-prose td').first().click()

    const geoAfter = await getTableGeometry()

    // Table top must not shift
    assert.ok(
      Math.abs(geoBefore.table.top - geoAfter.table.top) <= 1,
      `Table top must not shift on focus (before: ${geoBefore.table.top}, after: ${geoAfter.table.top})`
    )

    // Next heading must not shift
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1,
      `Next heading must not shift on table focus (before: ${geoBefore.nextHeadingTop}, after: ${geoAfter.nextHeadingTop})`
    )

    // Next paragraph must not shift
    assert.ok(
      Math.abs(geoBefore.nextParagraphTop - geoAfter.nextParagraphTop) <= 1,
      `Next paragraph must not shift on table focus (before: ${geoBefore.nextParagraphTop}, after: ${geoAfter.nextParagraphTop})`
    )

    // Screenshot focused state
    await page.screenshot({ path: `${output}/02-table-focused.png` })
  })

  await test('3. Click outside table: zero layout displacement on blur', async () => {
    const geoBefore = await getTableGeometry()

    // Click onto the heading below the table
    await page.locator('.md-prose h2').last().click()

    const geoAfter = await getTableGeometry()

    assert.ok(
      Math.abs(geoBefore.table.top - geoAfter.table.top) <= 1,
      `Table top must not shift when blurred (before: ${geoBefore.table.top}, after: ${geoAfter.table.top})`
    )
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1,
      `Next heading must not shift when table blurred`
    )

    // Toolbar remains visible
    const toolbar = page.locator('.md-table-tools')
    assert.equal(await toolbar.isVisible(), true)

    // Screenshot blurred again
    await page.screenshot({ path: `${output}/03-table-blurred-again.png` })
  })

  await test('4. Open table menu (更多操作): menu floats as overlay without shifting table or headings', async () => {
    await page.locator('.md-prose td').first().click()
    const geoBefore = await getTableGeometry()

    const toolbar = page.locator('.md-table-tools')
    const moreBtn = toolbar.getByRole('button', { name: '更多操作', exact: true })
    await moreBtn.click()

    const menu = toolbar.locator('.md-table-menu')
    await menu.waitFor({ state: 'visible' })

    const geoOpen = await getTableGeometry()

    assert.ok(
      Math.abs(geoBefore.table.top - geoOpen.table.top) <= 1,
      `Table top must not shift when table menu opened`
    )
    assert.ok(
      Math.abs(geoBefore.nextHeadingTop - geoOpen.nextHeadingTop) <= 1,
      `Next heading must not shift when table menu opened`
    )

    // Screenshot menu opened
    await page.screenshot({ path: `${output}/04-table-menu-opened.png` })

    // Press Escape to dismiss menu
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })

    const geoClosed = await getTableGeometry()
    assert.ok(Math.abs(geoBefore.table.top - geoClosed.table.top) <= 1, 'Table top unchanged after closing menu')
  })

  await test('5. Table alignment toggle: cell alignment changes without layout shift', async () => {
    await page.locator('.md-prose td').first().click()
    const geoBefore = await getTableGeometry()

    const toolbar = page.locator('.md-table-tools')
    const centerBtn = toolbar.getByRole('button', { name: '居中对齐', exact: true })
    await centerBtn.click()

    const cellStyle = await page.locator('.md-prose td').first().getAttribute('style')
    assert.ok(cellStyle?.includes('text-align: center;'), 'Cell should be centered')

    const geoAfter = await getTableGeometry()
    assert.ok(Math.abs(geoBefore.table.top - geoAfter.table.top) <= 1, 'Table top unchanged after alignment')
    assert.ok(Math.abs(geoBefore.nextHeadingTop - geoAfter.nextHeadingTop) <= 1, 'Next heading unchanged after alignment')

    // Screenshot centered table cell
    await page.screenshot({ path: `${output}/05-table-aligned-center.png` })

    // Undo alignment
    await page.evaluate(() => window.fixture.manager.command('undo'))
  })

  await test('6. Multiple tables: each table has its own toolbar directly above it, neither jumps', async () => {
    const multiSource = '## 表格一\n\n| A1 | B1 |\n| --- | --- |\n| 1 | 2 |\n\n## 表格二\n\n| X1 | Y1 |\n| --- | --- |\n| 3 | 4 |\n\n## 尾部'
    await reset(multiSource)

    const toolbars = page.locator('.md-table-tools')
    assert.equal(await toolbars.count(), 2, 'Both tables must have their own toolbar')
    assert.equal(await toolbars.nth(0).isVisible(), true, 'Toolbar 1 visible')
    assert.equal(await toolbars.nth(1).isVisible(), true, 'Toolbar 2 visible')

    // Check geometry of table 1 and table 2
    const table1 = page.locator('.md-prose table').nth(0)
    const table2 = page.locator('.md-prose table').nth(1)

    const t1Before = (await table1.boundingBox()).y
    const t2Before = (await table2.boundingBox()).y

    // Click into table 1
    await table1.locator('td').first().click()
    const t1After1 = (await table1.boundingBox()).y
    const t2After1 = (await table2.boundingBox()).y
    assert.ok(Math.abs(t1Before - t1After1) <= 1, 'Table 1 does not shift on focus')
    assert.ok(Math.abs(t2Before - t2After1) <= 1, 'Table 2 does not shift when Table 1 focused')

    // Click into table 2
    await table2.locator('td').first().click()
    const t1After2 = (await table1.boundingBox()).y
    const t2After2 = (await table2.boundingBox()).y
    assert.ok(Math.abs(t1Before - t1After2) <= 1, 'Table 1 does not shift when Table 2 focused')
    assert.ok(Math.abs(t2Before - t2After2) <= 1, 'Table 2 does not shift when Table 2 focused')

    // Screenshot multiple tables
    await page.screenshot({ path: `${output}/06-multiple-tables.png` })
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
