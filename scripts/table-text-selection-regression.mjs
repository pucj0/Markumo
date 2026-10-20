// Real mouse gestures against the live ProseMirror table and the source-mode
// TableWidget. Clipboard assertions use the browser clipboard so Ctrl+C and a
// subsequent paste into a plain textarea exercise the same path as the app.
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
const richSource = [
  '| 名称 | 内容 |',
  '| --- | --- |',
  '| **中文** | `code` \\| pipe |',
  '| English *em* | 文本 |',
  '',
].join('\n')

const server = await createServer({ server: { host: '127.0.0.1', port: 1461, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
let context
const results = []
const failures = []
let page
let liveVerticalMarkdown = ''

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
  // Let ProseMirror commit its first measure before mouse coordinates are read.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
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

const drag = async (from, to, toEdge = 'center') => {
  await page.mouse.move(from.left + 1, from.top + from.height / 2)
  await page.mouse.down()
  const x = toEdge === 'end' ? to.right - 1 : toEdge === 'start' ? to.left + 1 : to.left + to.width / 2
  await page.mouse.move(x, to.top + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

const dragWithin = async rect => {
  await page.mouse.move(rect.left + 1, rect.top + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.right - 1, rect.top + rect.height / 2, { steps: 10 })
  await page.mouse.up()
}

const selectionInfo = () => page.evaluate(() => {
  const f = window.f
  const selection = f.live().view.state.selection
  const result = {
    type: selection.toJSON().type,
    json: selection.toJSON(),
    empty: selection.empty,
    selectedCells: document.querySelectorAll('.md-prose .selectedCell').length,
    cells: [...document.querySelectorAll('.md-prose .selectedCell')].map(cell => cell.textContent?.trim() || ''),
    dom: window.getSelection()?.toString() || '',
    active: document.activeElement?.className || document.activeElement?.tagName || '',
    rect: null,
  }
  if (selection instanceof f.CellSelection) {
    const table = selection.$anchorCell.node(-1)
    const map = f.TableMap.get(table)
    const start = selection.$anchorCell.start(-1)
    result.rect = map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start)
    result.anchor = selection.$anchorCell.pos
    result.head = selection.$headCell.pos
  }
  return result
})

const readClipboard = () => page.evaluate(async () => {
  const result = { text: '', html: '' }
  const items = await navigator.clipboard.read()
  for (const item of items) {
    if (item.types.includes('text/plain')) result.text = await (await item.getType('text/plain')).text()
    if (item.types.includes('text/html')) result.html = await (await item.getType('text/html')).text()
  }
  return result
})

const copy = async (cut = false) => {
  const before = await readClipboard()
  await page.keyboard.press(cut ? 'Control+X' : 'Control+C')
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(40)
    const next = await readClipboard()
    if (next.text !== before.text || next.html !== before.html) return next
  }
  return readClipboard()
}

const expectTableCopy = (copied, expectedCells, forbidden = []) => {
  assert.match(copied.text, /\|\s*:?-{3,}/, 'text/plain must contain a GFM table delimiter')
  assert.match(copied.html, /<table>/i, 'text/html must contain an HTML table')
  for (const cell of expectedCells) assert.match(copied.text, new RegExp(cell.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  for (const cell of forbidden) assert.doesNotMatch(copied.text, new RegExp(cell.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

const source = () => page.evaluate(() => window.f.source())
const activeBar = () => page.locator('.md-table-tools.is-active')

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME, args: ['--no-sandbox'] })
  context = await browser.newContext({ viewport: { width: 1280, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:1461/${output}/index.html`)
  await page.waitForFunction(() => window.f)

  await test('A. selecting part of one cell stays TextSelection and copies only those characters', async () => {
    await reset(tableSource)
    const min = await rectFor('admin', 'min')
    await dragWithin(min)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.empty, false)
    assert.equal(selection.selectedCells, 0)
    const copied = await copy()
    assert.equal(copied.text, 'min')
    assert.doesNotMatch(copied.text, /\|/)
    assert.doesNotMatch(copied.text, /admin|123456/)
    assert.match(copied.html, /min/)
    assert.doesNotMatch(copied.html, /<table>/)
  })

  await test('B. dragging from the first to the last character in one cell copies the cell text only', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    await drag(admin, admin, 'end')
    const selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.selectedCells, 0)
    const copied = await copy()
    assert.equal(copied.text, 'admin')
    assert.doesNotMatch(copied.text, /\||123456|系统管理员/)
    assert.doesNotMatch(copied.html, /<table>/)
  })

  await test('C. dragging down into another cell creates a rectangular CellSelection and copies only those cells', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    const qingjie = await rectFor('qingjie-01', 'qingjie-01')
    await drag(admin, qingjie)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    assert.equal(selection.selectedCells, 2)
    assert.deepEqual(selection.cells, ['admin', 'qingjie-01'])
    assert.deepEqual(selection.rect, { left: 1, right: 2, top: 1, bottom: 3 })
    const copied = await copy()
    expectTableCopy(copied, ['admin', 'qingjie-01'], ['123456', '654321', '系统管理员', '服务人员'])
    assert.equal(copied.text.trim().split('\n').length, 4, JSON.stringify(copied.text))
    liveVerticalMarkdown = copied.text.trim()
  })

  await test('D. selecting two cells in one row creates a CellSelection and a legal Markdown table', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    const password = await rectFor('123456', '123456')
    await drag(admin, password)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    assert.deepEqual(selection.cells, ['admin', '123456'])
    assert.deepEqual(selection.rect, { left: 1, right: 3, top: 1, bottom: 2 })
    const copied = await copy()
    expectTableCopy(copied, ['admin', '123456'], ['qingjie-01', '654321', '系统管理员'])
    assert.equal(copied.text.trim().split('\n').length, 3)
  })

  await test('E. diagonal multi-row, multi-column drag copies exactly the rectangle', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    const password = await rectFor('654321', '654321')
    await drag(admin, password)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    assert.deepEqual(selection.cells, ['admin', '123456', 'qingjie-01', '654321'])
    assert.deepEqual(selection.rect, { left: 1, right: 3, top: 1, bottom: 3 })
    const copied = await copy()
    expectTableCopy(copied, ['admin', '123456', 'qingjie-01', '654321'], ['系统管理员', '服务人员', 'zhangsan', '000000'])
  })

  await test('F. reverse cross-cell drag produces the same CellSelection', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    const password = await rectFor('654321', '654321')
    await drag(password, admin)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    assert.deepEqual(selection.rect, { left: 1, right: 3, top: 1, bottom: 3 })
    assert.deepEqual(selection.cells.sort(), ['123456', '654321', 'admin', 'qingjie-01'].sort())
    const copied = await copy()
    expectTableCopy(copied, ['admin', '123456', 'qingjie-01', '654321'])
  })

  await test('G. dragging from an empty cell into a non-empty cell creates a CellSelection', async () => {
    await reset(blankSource)
    const empty = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.md-prose td, .md-prose th')].find(candidate => candidate.textContent?.trim() === '')
      const rect = cell.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
    })
    const admin = await rectFor('admin', 'admin')
    await drag(empty, admin)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    assert.deepEqual(selection.rect, { left: 0, right: 2, top: 1, bottom: 2 })
    const copied = await copy()
    expectTableCopy(copied, ['admin'], ['123456', 'one', 'three'])
  })

  await test('H. click, double click, triple click and Shift+Click preserve text and structural behavior', async () => {
    // Shift+click first so browser click-count history from the triple click
    // below cannot affect the modifier gesture.
    await reset(tableSource)
    let admin = await rectFor('admin', 'admin')
    let password = await rectFor('123456', '123456')
    await page.locator('.md-prose td', { hasText: 'admin' }).click()
    await page.waitForFunction(() => window.f.live().view.state.selection.$anchor.pos > 10)
    await page.keyboard.down('Shift')
    await page.mouse.click(password.left + password.width / 2, password.top + password.height / 2)
    await page.keyboard.up('Shift')
    let selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    assert.deepEqual(selection.rect, { left: 1, right: 3, top: 1, bottom: 2 })

    await reset(tableSource)
    admin = await rectFor('admin', 'admin')
    await page.mouse.click(admin.left + admin.width / 2, admin.top + admin.height / 2)
    selection = await selectionInfo()
    assert.equal(selection.type, 'text')
    assert.equal(selection.empty, true)
    await activeBar().waitFor({ state: 'visible' })

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
    assert.equal(selection.type, 'cell')
    assert.equal(selection.selectedCells, 1)
    assert.deepEqual(selection.cells, ['admin'])
    const singleCellCopy = await copy()
    assert.equal(singleCellCopy.text.trim(), 'admin')
    assert.doesNotMatch(singleCellCopy.text, /\|/)
    assert.doesNotMatch(singleCellCopy.html, /<table>/i)
  })

  await test('I. Tab, Shift+Tab and table toolbar operations still work', async () => {
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
    assert.equal(await page.locator('.md-prose table tr').count(), 5)
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => window.f.ready())
    assert.equal(await source(), tableSource)
  })

  await test('J. read-only mode allows text and structural selection and copy without mutation', async () => {
    await reset(tableSource, true, true)
    const min = await rectFor('admin', 'min')
    await dragWithin(min)
    assert.equal((await selectionInfo()).type, 'text')
    assert.equal((await copy()).text, 'min')
    const admin = await rectFor('admin', 'admin')
    const qingjie = await rectFor('qingjie-01', 'qingjie-01')
    await drag(admin, qingjie)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    const copied = await copy()
    expectTableCopy(copied, ['admin', 'qingjie-01'])
    assert.equal(await source(), tableSource)
  })

  await test('K. copied CellSelection pastes as Markdown source into a plain textarea', async () => {
    await reset(tableSource)
    const admin = await rectFor('admin', 'admin')
    const qingjie = await rectFor('qingjie-01', 'qingjie-01')
    await drag(admin, qingjie)
    const copied = await copy()
    expectTableCopy(copied, ['admin', 'qingjie-01'])
    await page.evaluate(() => {
      const area = document.createElement('textarea')
      area.id = 'plain-paste-target'
      document.body.append(area)
      area.focus()
    })
    await page.keyboard.press('Control+V')
    await page.waitForFunction(() => (document.querySelector('#plain-paste-target')?.value || '').includes('admin'))
    const pasted = await page.locator('#plain-paste-target').inputValue()
    assert.equal(pasted.trim(), copied.text.trim())
    await page.evaluate(() => document.querySelector('#plain-paste-target')?.remove())
  })

  await test('L. Chinese, English, emphasis, code and escaped pipes survive cell copy', async () => {
    await reset(richSource)
    const chinese = await rectFor('中文', '中文')
    const text = await rectFor('文本', '文本')
    // Start from the plain-text cell; starting inside an inline formatted cell
    // can focus its inline source input before the cell selection begins.
    await drag(text, chinese)
    const selection = await selectionInfo()
    assert.equal(selection.type, 'cell')
    const copied = await copy()
    assert.match(copied.text, /\*\*中文\*\*/, JSON.stringify({ selection, text: copied.text, html: copied.html }))
    assert.match(copied.text, /`code`/)
    assert.match(copied.text, /\\\|/)
    assert.match(copied.text, /English \*em\*/)
    assert.match(copied.html, /<strong>中文<\/strong>/)
    assert.match(copied.html, /<code>code<\/code>/)
    assert.match(copied.html, /<table>/)
  })

  await test('M. the existing append/selection behavior does not leak listeners across repeated drags', async () => {
    await reset(tableSource + '\n' + tableSource.replaceAll('admin', 'other'))
    const before = await page.evaluate(() => window.f.snapshot().globalListeners)
    const initialSource = await source()
    for (let index = 0; index < 4; index++) {
      const min = await rectFor('admin', 'min')
      const one = await rectFor('123456', '1')
      await drag(min, one)
      assert.equal(await source(), initialSource, 'a selection gesture must not edit the table source')
      assert.equal((await selectionInfo()).type, 'cell')
      await copy()
    }
    const afterDrags = await page.evaluate(() => window.f.snapshot().globalListeners)
    assert.ok(afterDrags <= before + 1, `global listeners grew from ${before} to ${afterDrags}`)
    const disposed = await page.evaluate(() => window.f.dispose())
    assert.equal(disposed.pmDestroyed, true)
    assert.equal(disposed.cmDestroyed, true)
    assert.equal(disposed.rootsRemoved, true)
    assert.equal(disposed.remaining, 0)
  })

  const widgetPage = await context.newPage()
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
    const copyWidget = async () => {
      const before = await readClipboardFrom(widgetPage)
      await widgetPage.keyboard.press('Control+C')
      for (let attempt = 0; attempt < 12; attempt++) {
        await widgetPage.waitForTimeout(40)
        const next = await readClipboardFrom(widgetPage)
        if (next.text !== before.text || next.html !== before.html) return next
      }
      return readClipboardFrom(widgetPage)
    }

    const min = await widgetRect('admin', 'min')
    await widgetPage.mouse.move(min.left + 1, min.top + min.height / 2)
    await widgetPage.mouse.down()
    await widgetPage.mouse.move(min.right - 1, min.top + min.height / 2, { steps: 8 })
    await widgetPage.mouse.up()
    assert.match(await widgetPage.evaluate(() => window.getSelection()?.toString() || ''), /min/)
    const withinCopied = await copyWidget()
    assert.equal(withinCopied.text.trim(), 'min')
    assert.doesNotMatch(withinCopied.text, /\|/)
    assert.doesNotMatch(withinCopied.html, /<table>/)

    await widgetPage.reload()
    await widgetPage.waitForFunction(() => window.f?.view && document.querySelector('.cm-md-table'))
    const admin = await widgetRect('admin', 'min')
    const password = await widgetRect('123456', '1')
    await widgetPage.mouse.move(admin.left + 1, admin.top + admin.height / 2)
    await widgetPage.mouse.down()
    await widgetPage.mouse.move(password.left + password.width / 2, password.top + password.height / 2, { steps: 12 })
    await widgetPage.mouse.up()
    assert.ok(await widgetPage.locator('.cm-md-table .selectedCell').count() >= 2)
    assert.equal(await widgetPage.evaluate(() => window.f.source()), widgetSource)
    const crossCopied = await copyWidget()
    expectTableCopy(crossCopied, ['admin', '123456'], ['654321', 'qingjie-01'])
    assert.equal(crossCopied.text.trim(), '|  |  |\n| --- | --- |\n| admin | 123456 |')

    await widgetPage.reload()
    await widgetPage.waitForFunction(() => window.f?.view && document.querySelector('.cm-md-table'))
    const verticalAdmin = await widgetRect('admin', 'min')
    const verticalQingjie = await widgetRect('qingjie-01', 'qingjie-01')
    await widgetPage.mouse.move(verticalAdmin.left + 1, verticalAdmin.top + verticalAdmin.height / 2)
    await widgetPage.mouse.down()
    await widgetPage.mouse.move(verticalQingjie.left + verticalQingjie.width / 2, verticalQingjie.top + verticalQingjie.height / 2, { steps: 12 })
    await widgetPage.mouse.up()
    const verticalCopied = await copyWidget()
    assert.equal(verticalCopied.text.trim(), liveVerticalMarkdown, `live=${JSON.stringify(liveVerticalMarkdown)} source=${JSON.stringify(verticalCopied.text.trim())}`)

    const cell = widgetPage.locator('.cm-md-table td', { hasText: 'admin' }).first()
    const from = Number(await cell.getAttribute('data-source-from'))
    const box = await cell.boundingBox()
    await widgetPage.mouse.click(box.x + 10, box.y + box.height / 2)
    await widgetPage.waitForFunction(() => !document.querySelector('.cm-md-table'))
    assert.equal(await widgetPage.evaluate(() => window.f.view.state.selection.main.head), from)
    results.push('N. source-mode TableWidget keeps click editing, same-cell text copy and structural cross-cell copy')
    console.log('PASS N. source-mode TableWidget keeps click editing, same-cell text copy and structural cross-cell copy')
  } catch (error) {
    failures.push({ name: 'N. source-mode TableWidget keeps click editing, same-cell text copy and structural cross-cell copy', error: String(error), stack: error.stack })
    console.error('FAIL N. source-mode TableWidget keeps click editing, same-cell text copy and structural cross-cell copy\n' + (error.stack || error))
  } finally {
    await widgetPage.close()
  }

  assert.deepEqual(errors, [])
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
  console.log(`PASS ${results.length} table selection groups`)
} finally {
  await page?.evaluate(() => window.f.dispose()).catch(() => {})
  await context?.close()
  await browser?.close()
  await server.close()
}

async function readClipboardFrom(target) {
  return target.evaluate(async () => {
    const result = { text: '', html: '' }
    const items = await navigator.clipboard.read()
    for (const item of items) {
      if (item.types.includes('text/plain')) result.text = await (await item.getType('text/plain')).text()
      if (item.types.includes('text/html')) result.html = await (await item.getType('text/html')).text()
    }
    return result
  })
}
