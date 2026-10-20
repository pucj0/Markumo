// Real mouse drags against the live ProseMirror table. The test never reads or
// writes the system clipboard; it dispatches the same ClipboardEvent the editor
// handles natively and inspects its DataTransfer payload.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/table-text-selection'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:720px"></div><script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>')
fs.writeFileSync(`${output}/widget.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./widget-fixture.js"></script>')
fs.writeFileSync(`${output}/widget-fixture.js`, `
import {EditorState, EditorSelection} from '@codemirror/state'
import {EditorView} from '@codemirror/view'
import {markdown} from '@codemirror/lang-markdown'
import {markdownSyntaxExtensions} from '/src/editor/markdown/semantics.ts'
import {livePreviewExtension} from '/src/editor/markdown/livePreview.ts'
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import '/src/editor/markdown/styles.css'
const source = '# 项目\\n\\n| 角色 | 测试账号 | 测试密码 |\\n| --- | --- | --- |\\n| 系统管理员 | admin | 123456 |\\n| 服务人员 | qingjie-01 | 654321 |\\n| 客户 | zhangsan | 000000 |\\n'
const view = new EditorView({
  state: EditorState.create({ doc: source, selection: EditorSelection.cursor(0), extensions: [markdown({ extensions: markdownSyntaxExtensions }), livePreviewExtension()] }),
  parent: document.querySelector('#app'),
})
view.focus()
window.f = { view, source: () => view.state.doc.toString() }
`)

const tableSource = [
  '# 项目',
  '',
  '| 角色 | 测试账号 | 测试密码 |',
  '| --- | --- | --- |',
  '| 系统管理员 | admin | 123456 |',
  '| 服务人员 | qingjie-01 | 654321 |',
  '| 客户 | zhangsan | 000000 |',
  '',
].join('\n')
const blankSource = [
  '| A | B | C |',
  '| --- | --- | --- |',
  '|  | admin | 123456 |',
  '| one |  | three |',
  '',
].join('\n')

const server = await createServer({ server: { host: '127.0.0.1', port: 1461, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
const results = []
const failures = []
let page

const test = async (name, work) => {
  try {
    await work()
    results.push(name)
    console.log('PASS ' + name)
  } catch (error) {
    failures.push({ name, error: String(error), stack: error.stack })
    console.error('FAIL ' + name + '\n' + (error.stack || error))
  }
}

const reset = async (source, clean = false, readOnly = false) => {
  await page.evaluate(({ source, clean, readOnly }) => window.f.reset(source, clean, readOnly), { source, clean, readOnly })
  await page.waitForFunction(() => window.f.ready())
  await page.locator('.md-prose').first().waitFor()
}

const rectFor = async (cellText, part = cellText) => {
  await page.waitForFunction(({ cellText }) => [...document.querySelectorAll('.md-prose td, .md-prose th')]
    .some(candidate => candidate.textContent.includes(cellText)), { cellText })
  return page.evaluate(({ cellText, part }) => {
    const cell = [...document.querySelectorAll('.md-prose td, .md-prose th')]
      .find(candidate => candidate.textContent.includes(cellText))
    if (!cell) throw Error(`Missing table cell ${cellText}`)
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    let node = null
    while ((node = walker.nextNode())) if (node.textContent.includes(part)) break
    if (!node) throw Error(`Missing text ${part} in ${cellText}`)
    const index = node.textContent.indexOf(part)
    const range = document.createRange()
    range.setStart(node, index)
    range.setEnd(node, index + part.length)
    const rect = range.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
  }, { cellText, part })
}

const drag = async (from, to, toEdge = 'start') => {
  await page.mouse.move(from.left + 1, from.top + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(toEdge === 'end' ? to.right - 1 : to.left + 1, to.top + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

const dragWithin = async rect => {
  await page.mouse.move(rect.left + 1, rect.top + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.right - 1, rect.top + rect.height / 2, { steps: 10 })
  await page.mouse.up()
}

const dragToCenter = async (from, to) => {
  await page.mouse.move(from.left + 1, from.top + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.left + to.width / 2, to.top + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

const dragToEnd = async (from, to) => {
  await page.mouse.move(from.left + 1, from.top + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.right - 2, to.top + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

const selectionInfo = () => page.evaluate(() => {
  const selection = window.f.live().view.state.selection
  return {
    type: selection.toJSON().type,
    json: selection.toJSON(),
    empty: selection.empty,
    selectedCells: document.querySelectorAll('.selectedCell').length,
    dom: window.getSelection()?.toString() || '',
  }
})

const clipboard = (cut = false) => page.evaluate(cut => {
  const f = window.f
  const data = new DataTransfer()
  f.live().view.dom.dispatchEvent(new ClipboardEvent(cut ? 'cut' : 'copy', { bubbles: true, cancelable: true, clipboardData: data }))
  return { text: data.getData('text/plain'), html: data.getData('text/html'), source: f.source() }
}, cut)

const source = () => page.evaluate(() => window.f.source())
const activeBar = () => page.locator('.md-table-tools.is-active')

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:1461/${output}/index.html`)
  await page.waitForFunction(() => window.f)

  await test('A. selecting part of one cell copies only those characters', async () => {
    await reset(tableSource)
    const min = await rectFor('admin', 'min')
    await dragWithin(min)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.empty, false)
    assert.equal(selection.selectedCells, 0)
    const copied = await clipboard()
    assert.equal(copied.text, 'min', 'partial cell copy must not include the rest of the cell')
    assert.doesNotMatch(copied.text, /\|/)
    assert.doesNotMatch(copied.text, /admin|123456/)
    assert.match(copied.html, /min/)
    assert.doesNotMatch(copied.html, /123456/)
  })

  await test('B. dragging across cells stays a text selection, never CellSelection', async () => {
    await reset(tableSource)
    const min = await rectFor('admin', 'min')
    const one = await rectFor('123456', '1')
    await drag(min, one, 'end')
    const selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
    const copied = await clipboard()
    assert.doesNotMatch(copied.text, /\|/, 'cross-cell text copy must not become a Markdown table')
    assert.match(copied.text, /min/)
    assert.match(copied.text, /1/)
    assert.doesNotMatch(copied.text, /23456/)
    assert.doesNotMatch(copied.text, /qingjie-01/)
    assert.doesNotMatch(copied.html, /<table>/)
    assert.doesNotMatch(copied.html, /23456|qingjie-01/)
  })

  await test('C. reverse cross-cell drag selects the same visible text', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    const one = await rectFor('123456', '1')
    await drag(one, admin)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
    const copied = await clipboard()
    assert.doesNotMatch(copied.text, /\|/)
    assert.match(copied.text, /admin/)
    assert.doesNotMatch(copied.text, /23456|qingjie-01/)
  })

  await test('D. dragging from an empty cell does not select the whole cell', async () => {
    await reset(blankSource)
    const empty = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.md-prose td, .md-prose th')].find(candidate => candidate.textContent.trim() === '')
      const rect = cell.getBoundingClientRect()
      return { left: rect.left + rect.width / 2, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
    })
    const admin = await rectFor('admin', 'admin')
    await drag(empty, admin, 'end')
    const selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
    const copied = await clipboard()
    assert.doesNotMatch(copied.text, /\|/)
    assert.match(copied.text, /admin/)
    assert.doesNotMatch(copied.text, /123456/)
  })

  await test('E. copy, cut and undo keep the same text selection semantics', async () => {
    await reset(tableSource)
    const min = await rectFor('admin', 'min')
    await dragWithin(min)
    const copied = await clipboard()
    assert.equal(copied.text, 'min')
    const cut = await clipboard(true)
    assert.equal(cut.text, 'min')
    assert.doesNotMatch(cut.source, /admin/, 'cut must remove the selected characters from the source')
    assert.match(cut.source, /\| 系统管理员 \| ad \| 123456 \|/)
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => window.f.ready())
    assert.equal(await source(), tableSource)
    assert.equal((await selectionInfo()).selectedCells, 0)
  })

  await test('F. click, double click, triple click and shift click behave like a text editor', async () => {
    await reset(tableSource)
    let admin = await rectFor('admin', 'admin')
    const one = await rectFor('123456', '123456')
    await page.mouse.click(admin.left + admin.width / 2, admin.top + admin.height / 2)
    let selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.empty, true)
    await activeBar().waitFor({ state: 'visible' })

    // Shift-click first: it must extend a normal text selection across cells.
    await page.mouse.click(admin.left + 1, admin.top + admin.height / 2)
    await page.keyboard.down('Shift')
    await page.mouse.click(one.left + one.width / 2, one.top + one.height / 2)
    await page.keyboard.up('Shift')
    await page.waitForFunction(() => !window.f.live().view.state.selection.empty)
    selection = await selectionInfo()
    const shifted = await clipboard()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
    assert.match(shifted.text, /123/, JSON.stringify({ selection, text: shifted.text }))
    assert.match(shifted.text, /min|admin/)

    // A fresh document keeps browser click-count history and the previous
    // selection from affecting the double/triple click checks.
    await reset(tableSource)
    admin = await rectFor('admin', 'admin')
    await page.mouse.dblclick(admin.left + admin.width / 2, admin.top + admin.height / 2)
    await page.waitForFunction(() => {
      const view = window.f.live().view
      return view.state.doc.textBetween(view.state.selection.from, view.state.selection.to) === 'admin'
    })
    selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)

    await reset(tableSource)
    admin = await rectFor('admin', 'admin')
    await page.mouse.click(admin.left + admin.width / 2, admin.top + admin.height / 2, { clickCount: 3 })
    selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
  })

  await test('G. Tab navigation and the table toolbar still work', async () => {
    await reset(tableSource)
    await page.locator('.md-prose td', { hasText: 'admin' }).click()
    await activeBar().waitFor({ state: 'visible' })
    const before = await selectionInfo()
    await page.keyboard.press('Tab')
    const after = await selectionInfo()
    assert.equal(before.type, 'text')
    assert.equal(after.type, 'text')
    assert.notEqual(after.json.head, before.json.head)
    assert.equal(after.selectedCells, 0)
    await page.keyboard.press('Shift+Tab')
    assert.equal((await selectionInfo()).type, 'text')
    await activeBar().getByRole('button', { name: '表格行列操作', exact: true }).click()
    await activeBar().getByRole('button', { name: '后插行', exact: true }).click()
    const rows = await page.locator('.md-prose table tr').count()
    assert.equal(rows, 5)
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => window.f.ready())
    assert.equal(await source(), tableSource)
  })

  await test('H. switching live/source and back preserves the exact Markdown and text selection', async () => {
    await reset(tableSource)
    const min = await rectFor('admin', 'min')
    await dragWithin(min)
    assert.equal((await selectionInfo()).type, 'text')
    await page.evaluate(() => window.f.manager.setMarkdownMode(window.f.id, 'source', 'main'))
    assert.equal(await source(), tableSource)
    await page.evaluate(() => window.f.manager.setMarkdownMode(window.f.id, 'live', 'main'))
    await page.waitForFunction(() => window.f.ready())
    assert.equal(await source(), tableSource)
    assert.equal(await page.locator('.md-prose table').count(), 1)
  })

  await test('I. read-only mode selects and copies text but never mutates it', async () => {
    await reset(tableSource, true, true)
    const min = await rectFor('admin', 'min')
    await dragWithin(min)
    const selection = await selectionInfo()
    const copied = await clipboard()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
    assert.equal(copied.text, 'min')
    // Cut is a mutation and is disabled in read-only mode; the source stays put.
    const cut = await clipboard(true)
    assert.equal(cut.text, '')
    assert.equal(cut.source, tableSource)
    await page.keyboard.type('X')
    assert.equal(await source(), tableSource)
  })

  await test('J. repeated drags, multiple tables, panes and mode switches leak no listeners', async () => {
    await reset(tableSource + '\n' + tableSource.replaceAll('admin', 'other'))
    const before = await page.evaluate(() => window.f.snapshot().globalListeners)
    const initialSource = await source()
    for (let index = 0; index < 4; index++) {
      const min = await rectFor('admin', 'min')
      const one = await rectFor('123456', '1')
      await drag(min, one, 'end')
      assert.equal(await source(), initialSource, 'a text drag must not edit the table source')
      assert.equal((await selectionInfo()).selectedCells, 0)
      await clipboard()
    }
    const afterDrags = await page.evaluate(() => window.f.snapshot().globalListeners)
    assert.ok(afterDrags <= before + 1, `global listeners grew from ${before} to ${afterDrags}`)
    const secondary = await page.evaluate(() => window.f.split())
    await page.evaluate(pane => {
      const f = window.f
      f.manager.setMarkdownMode(f.id, 'live', 'main')
      f.manager.setMarkdownMode(f.id, 'live', pane)
    }, secondary)
    await page.waitForFunction(() => window.f.ready())
    const beforeSwitch = await page.evaluate(() => window.f.snapshot().globalListeners)
    for (let index = 0; index < 3; index++) {
      await page.evaluate(() => {
        const f = window.f
        f.manager.setMarkdownMode(f.id, 'source', 'main')
        f.manager.setMarkdownMode(f.id, 'live', 'main')
      })
      await page.waitForFunction(() => window.f.ready())
    }
    const afterSwitch = await page.evaluate(() => window.f.snapshot().globalListeners)
    assert.ok(afterSwitch <= beforeSwitch + 1, `global listeners grew after mode switches from ${beforeSwitch} to ${afterSwitch}`)
    assert.equal(await page.locator('.md-prose table').count(), 4)
    await page.evaluate(pane => window.f.manager.closePane(pane), secondary)
    const disposed = await page.evaluate(() => window.f.dispose())
    assert.equal(disposed.pmDestroyed, true)
    assert.equal(disposed.cmDestroyed, true)
    assert.equal(disposed.rootsRemoved, true)
    assert.equal(disposed.remaining, 0)
    assert.ok(disposed.globalListeners <= before, `global listeners remained after dispose: ${disposed.globalListeners} > ${before}`)
  })

  const widgetPage = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  try {
    await widgetPage.goto(`http://127.0.0.1:1461/${output}/widget.html`)
    await widgetPage.waitForFunction(() => window.f?.view && document.querySelector('.cm-md-table'))
    const widgetSource = await widgetPage.evaluate(() => window.f.source())
    const widgetRect = (cellText, part) => widgetPage.evaluate(({ cellText, part }) => {
      const cell = [...document.querySelectorAll('.cm-md-table td, .cm-md-table th')].find(candidate => candidate.textContent.includes(cellText))
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      let node = null
      while ((node = walker.nextNode())) if (node.textContent.includes(part)) break
      const index = node.textContent.indexOf(part)
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + part.length)
      const rect = range.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
    }, { cellText, part })
    const min = await widgetRect('admin', 'min')
    const one = await widgetRect('123456', '1')
    await widgetPage.mouse.move(min.left + 1, min.top + min.height / 2)
    await widgetPage.mouse.down()
    await widgetPage.mouse.move(min.right - 1, min.top + min.height / 2, { steps: 8 })
    await widgetPage.mouse.up()
    const within = await widgetPage.evaluate(() => window.getSelection()?.toString() || '')
    assert.match(within, /min/, 'source table drag must select the rendered text')
    await widgetPage.mouse.move(min.left + 1, min.top + min.height / 2)
    await widgetPage.mouse.down()
    await widgetPage.mouse.move(one.right - 1, one.top + one.height / 2, { steps: 10 })
    await widgetPage.mouse.up()
    const cross = await widgetPage.evaluate(() => window.getSelection()?.toString() || '')
    assert.match(cross, /min/)
    assert.match(cross, /1/)
    assert.doesNotMatch(cross, /\|/)
    assert.equal(await widgetPage.evaluate(() => window.f.source()), widgetSource, 'source widget drag must not edit the Markdown')
    const copied = await widgetPage.evaluate(() => {
      const data = new DataTransfer()
      document.querySelector('.cm-md-table').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }))
      return data.getData('text/plain')
    })
    assert.equal(copied.trim(), cross.trim(), 'widget copy must use the native selected text')
    const cell = widgetPage.locator('.cm-md-table td', { hasText: 'admin' }).first()
    const from = Number(await cell.getAttribute('data-source-from'))
    const box = await cell.boundingBox()
    await widgetPage.mouse.click(box.x + 10, box.y + box.height / 2)
    await widgetPage.waitForFunction(() => !document.querySelector('.cm-md-table'))
    assert.equal(await widgetPage.evaluate(() => window.f.view.state.selection.main.head), from)
    results.push('K. source-mode table widget keeps click editing and drag text selection')
    console.log('PASS K. source-mode table widget keeps click editing and drag text selection')
  } catch (error) {
    failures.push({ name: 'K. source-mode table widget keeps click editing and drag text selection', error: String(error), stack: error.stack })
    console.error('FAIL K. source-mode table widget keeps click editing and drag text selection\n' + (error.stack || error))
  } finally {
    await widgetPage.close()
  }

  assert.deepEqual(errors, [])
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
  console.log(`PASS ${results.length} table text-selection groups`)
} finally {
  await page?.evaluate(() => window.f.dispose()).catch(() => {})
  await browser?.close()
  await server.close()
}


