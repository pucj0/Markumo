import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = 'test-results/editor-review'
const fixtureName = `fixture-${Date.now()}`
await mkdir(output, { recursive: true })
const markdown = '# 标题\n\n**bold** *italic* ~~strike~~ ``code ` inside``\n\n- [ ] pending\n- item\n1. ordered\n\n> quote\n\n---\n\n[link](https://example.com)\n\n```js\nconst x = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
await writeFile(`${output}/${fixtureName}.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0}#app{height:700px;display:flex;flex-direction:column}.controls{height:32px;flex:none}</style></head><body><div id="app"></div><script type="module" src="./${fixtureName}.ts"></script></body></html>`)
await writeFile(`${output}/${fixtureName}.ts`, `
import {createApp,h,ref} from 'vue';
import {EditorView} from '@codemirror/view';
import {Transaction,EditorState,StateEffect} from '@codemirror/state'; import {isolateHistory} from '@codemirror/commands';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/editor/markdown/styles.css';
const manager=new DocumentManager([{id:'md',name:'fixture.md',path:'fixture.md',text:${JSON.stringify(markdown)}},{id:'txt',name:'other.txt',path:'other.txt',text:'independent document'}]);
manager.open('md',false);
const revision=ref(0);manager.subscribe(()=>revision.value++);
window.fixture={manager,Transaction,EditorState,StateEffect,isolateHistory,view:()=>EditorView.findFromDOM(document.querySelector('.main-pane .cm-editor')),secondary:()=>EditorView.findFromDOM(document.querySelector('.secondary-pane .cm-editor'))};
createApp({render(){revision.value;return [h('div',{class:'controls'},['source','live','split'].map(mode=>h('button',{onClick:()=>manager.setMarkdownMode(manager.activeId,mode)},mode))),h(EditorContainer,{doc:manager.activeDocument,manager,showOutline:false,desktop:false})]}}).mount('#app');
`)
const browser = await chromium.launch({ headless: true, channel: process.env.LIGHTEDIT_TEST_BROWSER || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } })
const errors = [], results = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('console', message => { if (message.type() === 'warning') console.log(message.text()) })
try {
  await page.goto((process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422') + '/' + output + `/${fixtureName}.html`)
  await page.waitForFunction(() => window.fixture?.manager.metadata('md')?.languageStatus === 'ready')
  await page.getByRole('button', { name: 'source', exact: true }).click()
  await page.getByRole('button', { name: 'live', exact: true }).click()
  await page.waitForTimeout(100)
  assert.deepEqual(errors, [], 'actual EditorView must not throw')
  const before = await page.evaluate(() => window.fixture.manager.saveSnapshot('md').text)
  await page.evaluate(() => window.fixture.view().dispatch({ selection: { anchor: 0 } }))
  const checkbox = page.locator('.cm-md-checkbox').first()
  await checkbox.click()
  assert.equal(await page.evaluate(() => window.fixture.manager.getText('md').includes('- [x] pending')), true, 'actual widget change')
  await page.evaluate(() => window.fixture.manager.command('undo'))
  assert.equal(await page.evaluate(() => window.fixture.manager.saveSnapshot('md').text), before)
  results.push({ name: 'real widget toggle/undo', result: 'PASS' })
  for (let i = 0; i < 10; i++) for (const mode of ['source', 'split', 'live']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    assert.equal(await page.evaluate(() => window.fixture.manager.saveSnapshot('md').text), before)
  }
  results.push({ name: '30 switches preserve source', result: 'PASS' })
  await page.screenshot({ path: `${output}/phase5-live.png` })
  await page.evaluate(() => {
    const {manager,Transaction,isolateHistory} = window.fixture
    for (let i=0;i<10;i++) manager.dispatch('md',{changes:{from:manager.getState('md').doc.length,insert:String(i)},annotations:[Transaction.userEvent.of('input'),isolateHistory.of('full')]})
  })
  const modified = await page.evaluate(() => window.fixture.manager.getText('md'))
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.fixture.manager.command('undo'))
  assert.equal(await page.evaluate(() => window.fixture.manager.saveSnapshot('md').text), before)
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.fixture.manager.command('redo'))
  assert.equal(await page.evaluate(() => window.fixture.manager.getText('md')), modified)
  results.push({ name: '10 undo/redo transactions', result: 'PASS' })
  const copied = await page.evaluate(() => {
    const view = window.fixture.view(); view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    const data = new DataTransfer()
    view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }))
    return data.getData('text/plain')
  })
  assert.equal(copied, modified)
  results.push({ name: 'copy uses raw Markdown', result: 'PASS' })
  const pasted = '中文粘贴\n- nested **raw**\n  - [ ] task'
  await page.evaluate(text => {
    const view=window.fixture.view(), data=new DataTransfer();data.setData('text/plain',text)
    view.contentDOM.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))
  },pasted)
  assert.equal(await page.evaluate(()=>window.fixture.manager.getText('md')),pasted)
  await page.evaluate(()=>window.fixture.manager.command('undo'))
  assert.equal(await page.evaluate(()=>window.fixture.manager.getText('md')),modified)
  results.push({name:'actual paste handler preserves Chinese and nested raw Markdown',result:'PASS'})
  await page.evaluate(() => {
    const {manager}=window.fixture
    manager.dispatch('md',{changes:{from:0,to:manager.getState('md').doc.length,insert:'<script>window.bad=true</script>\n![track](https://remote.invalid/secret)\n[bad](javascript:alert(1))'}})
  })
  await page.getByRole('button', { name: 'split', exact: true }).click()
  await page.waitForTimeout(120)
  assert.equal(await page.locator('.split-preview-content script, .split-preview-content img').count(), 0)
  assert.equal(await page.evaluate(() => !!window.bad), false)
  results.push({ name: 'readonly HTML and remote images are safe', result: 'PASS' })
  await page.screenshot({ path: `${output}/phase5-safe-split.png` })
  await page.getByRole('button', { name: 'source', exact: true }).click()
  await page.evaluate(() => window.fixture.manager.setMarkdownMode('md', 'live'))
  const composing = await page.evaluate(() => {
    const view = window.fixture.view()
    const target = view.contentDOM.editContext || view.contentDOM
    target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    const started = view.compositionStarted
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '中文组合\n- [ ] new' } })
    target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文组合' }))
    return started
  })
  assert.equal(composing, true, 'actual CM compositionStarted guard activated')
  await page.waitForTimeout(150)
  assert.deepEqual(errors, [], 'real composition events and changed document must not leave stale ranges')
  results.push({ name: 'synthetic composition on actual EditorView', result: 'PASS' })
  await page.evaluate(() => { const view=window.fixture.view(); view.dispatch({selection:{anchor:0}}) })
  const readonlySource = await page.evaluate(() => {
    const {view,StateEffect,EditorState}=window.fixture
    view().dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))})
    return view().state.doc.toString()
  })
  await page.locator('.cm-md-checkbox').click()
  assert.equal(await page.evaluate(() => window.fixture.manager.getText('md')), readonlySource)
  results.push({ name: 'readonly widget does not write', result: 'PASS' })
  console.log(JSON.stringify({ results, errors }))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/failure.html`, await page.content())
  console.error(await page.locator('body').innerText())
  console.error(await page.evaluate(() => ({ mounted: !!window.fixture.manager.view, connected: window.fixture.manager.view?.dom.isConnected, html: window.fixture.manager.view?.dom.outerHTML.slice(0, 300), active: window.fixture.manager.activeId })))
  throw error
} finally {
  await writeFile(`${output}/phase5.json`, JSON.stringify({ results, errors }, null, 2))
  await browser.close()
}
