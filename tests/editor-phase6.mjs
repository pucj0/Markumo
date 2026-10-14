import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = 'test-results/phase6-review', name = `fixture-${Date.now()}`
await mkdir(output, { recursive: true })
await writeFile(`${output}/${name}.html`, `<!doctype html><div id="app"></div><script type="module" src="./${name}.ts"></script>`)
await writeFile(`${output}/${name}.ts`, `
import {createApp,h,ref} from 'vue'; import {EditorView} from '@codemirror/view'; import {Transaction} from '@codemirror/state'; import {isolateHistory} from '@codemirror/commands';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts'; import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css'; import '/src/styles/variables.css';
const manager=new DocumentManager([{id:'a',name:'a.txt',path:'a.txt',text:'abc\\n'+('line\\n'.repeat(500))},{id:'b',name:'b.txt',path:'b.txt',text:'other'}]); manager.open('a',false);
const revision=ref(0); manager.subscribe(()=>revision.value++);
window.fixture={manager,Transaction,isolateHistory,view:()=>EditorView.findFromDOM(document.querySelector('.main-pane .cm-editor')),secondary:()=>EditorView.findFromDOM(document.querySelector('.secondary-pane .cm-editor'))};
createApp({render(){revision.value;return h(EditorContainer,{doc:manager.activeDocument,manager,showOutline:false,desktop:false})}}).mount('#app');
document.querySelector('#app').style.cssText='height:600px;display:flex';
`)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } }), errors = [], results = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422'}/${output}/${name}.html`)
  await page.waitForSelector('.cm-editor')
  await page.evaluate(() => window.fixture.manager.splitEditor())
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.cm-editor').count(), 2, 'split must mount two real EditorViews')
  results.push({name:'two production EditorViews mount',result:'PASS'})
  const initial = await page.evaluate(() => window.fixture.manager.getText('a'))
  await page.evaluate(() => {
    const f=window.fixture
    f.view().dispatch({selection:{anchor:1}});f.secondary().dispatch({selection:{anchor:3}})
    f.view().dispatch({changes:{from:0,insert:'MAIN'},annotations:f.isolateHistory.of('full')})
  })
  assert.deepEqual(await page.evaluate(() => [window.fixture.view().state.doc.toString(),window.fixture.secondary().state.doc.toString(),window.fixture.manager.getText('a')]), Array(3).fill('MAIN'+initial))
  assert.equal(await page.evaluate(() => window.fixture.secondary().state.selection.main.head), 7)
  await page.evaluate(() => {
    const f=window.fixture;f.manager.focusPane('secondary');f.secondary().dispatch({changes:{from:4,insert:'SIDE'},annotations:f.isolateHistory.of('full')})
  })
  const edited = 'MAINSIDE'+initial
  assert.deepEqual(await page.evaluate(() => [window.fixture.view().state.doc.toString(),window.fixture.secondary().state.doc.toString(),window.fixture.manager.getText('a')]), Array(3).fill(edited))
  for(let i=0;i<2;i++) await page.evaluate(() => window.fixture.manager.command('undo'))
  assert.deepEqual(await page.evaluate(() => [window.fixture.view().state.doc.toString(),window.fixture.secondary().state.doc.toString(),window.fixture.manager.getText('a')]), Array(3).fill(initial))
  for(let i=0;i<2;i++) await page.evaluate(() => window.fixture.manager.command('redo'))
  assert.equal(await page.evaluate(() => window.fixture.manager.getText('a')), edited)
  await page.evaluate(()=>{window.fixture.manager.focusPane('secondary');window.fixture.manager.command('find')})
  assert.equal(await page.locator('.cm-search').count(),1,'view-local search panel must not open in both panes')
  await page.locator('.secondary-pane .cm-search button[name=close]').click()
  await page.evaluate(()=>window.fixture.manager.setWrap(true))
  assert.equal(await page.locator('.cm-lineWrapping').count(),2,'document configuration still updates both panes')
  await page.evaluate(()=>window.fixture.manager.setWrap(false))
  results.push({name:'bidirectional shared document / independent cursor / shared undo-redo',result:'PASS'})
  await page.evaluate(() => {
    const f=window.fixture;f.manager.open('b',false,'secondary');f.secondary().dispatch({changes:{from:0,insert:'B'}})
  })
  assert.deepEqual(await page.evaluate(() => [window.fixture.view().state.doc.toString(),window.fixture.secondary().state.doc.toString(),window.fixture.manager.getText('b')]), [edited,'Bother','Bother'])
  results.push({name:'different document edits route to current secondary tab',result:'PASS'})
  await page.evaluate(() => {const f=window.fixture; f.manager.open('a',false,'secondary');f.view().scrollDOM.scrollTop=400;f.secondary().scrollDOM.scrollTop=900})
  await page.waitForTimeout(100)
  const scroll = await page.evaluate(() => [window.fixture.view().scrollDOM.scrollTop,window.fixture.secondary().scrollDOM.scrollTop])
  assert.ok(scroll[0]>0 && scroll[1]>scroll[0])
  await page.evaluate(() => {window.fixture.manager.open('b',false,'secondary');window.fixture.manager.open('a',false,'secondary')})
  await page.waitForTimeout(150)
  assert.deepEqual(await page.evaluate(() => [window.fixture.view().scrollDOM.scrollTop,window.fixture.secondary().scrollDOM.scrollTop]), scroll)
  results.push({name:'independent scroll retained across tab switches',result:'PASS'})
  await page.screenshot({path:`${output}/panes.png`})
  await page.evaluate(() => {
    const f=window.fixture, transfer=new DataTransfer()
    const tab=document.querySelector('.secondary-pane .tab')
    tab.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}))
    document.querySelector('.main-pane').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))
  })
  assert.equal(await page.evaluate(() => window.fixture.manager.secondaryGroup.tabs.some(t=>t.documentId==='a')),false)
  results.push({name:'real tab drag/drop keeps canonical document',result:'PASS'})
  await page.evaluate(() => window.fixture.manager.closeSplit())
  assert.equal(await page.locator('.cm-editor').count(),1)
  assert.equal(await page.evaluate(() => window.fixture.manager.mainOpenedDocuments.some(d=>d.id==='b'&&d.dirty)),true)
  assert.equal(await page.evaluate(() => window.fixture.manager.getText('b')),'Bother')
  results.push({name:'close split preserves secondary-only dirty tabs and destroys view',result:'PASS'})
  await page.evaluate(()=>{
    const f=window.fixture; f.manager.select('b','main');f.manager.dispatch('b',{changes:{from:0,to:f.manager.getState('b').doc.length,insert:'apple Apple pineapple\napple'}})
    f.manager.command('replace')
  })
  const search = page.locator('.main-pane .cm-search')
  await search.locator('input[name=search]').fill('apple')
  await search.locator('input[name=replace]').fill('fruit')
  await search.locator('input[name=word]').check()
  await search.locator('button[name=next]').click()
  const first = await page.evaluate(()=>window.fixture.view().state.selection.main.from)
  await search.locator('button[name=next]').click()
  const next = await page.evaluate(()=>window.fixture.view().state.selection.main.from)
  assert.notEqual(first,next)
  await search.locator('button[name=prev]').click()
  assert.equal(await page.evaluate(()=>window.fixture.view().state.selection.main.from),first)
  await search.locator('button[name=replaceAll]').click()
  assert.equal(await page.evaluate(()=>window.fixture.manager.getText('b')),'fruit fruit pineapple\nfruit')
  await page.evaluate(()=>window.fixture.manager.command('undo'))
  assert.equal(await page.evaluate(()=>window.fixture.manager.getText('b')),'apple Apple pineapple\napple')
  await search.locator('input[name=word]').uncheck()
  await search.locator('input[name=re]').check()
  await search.locator('input[name=search]').fill('(a)(pple)')
  await search.locator('input[name=replace]').fill('$2$1')
  await search.locator('button[name=replaceAll]').click()
  assert.equal(await page.evaluate(()=>window.fixture.manager.getText('b')),'pplea ppleA pinepplea\npplea')
  await page.evaluate(()=>window.fixture.manager.command('undo'))
  await search.locator('button[name=close]').click()
  await page.evaluate(()=>{const f=window.fixture;f.view().dispatch({selection:{anchor:0,head:5}});f.manager.transformSelection(true)})
  assert.equal(await page.evaluate(()=>window.fixture.manager.getText('b')),'APPLE Apple pineapple\napple')
  await page.evaluate(()=>window.fixture.manager.command('undo'))
  results.push({name:'real search next/previous, whole-word replace-all, regex groups, undo and case conversion',result:'PASS'})
  await page.evaluate(() => window.fixture.manager.dispose())
  assert.equal(await page.locator('.cm-editor').count(),0)
  results.push({name:'dispose removes all views',result:'PASS'})
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({results,errors}))
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({results,errors},null,2))
  if(errors.length) await page.screenshot({path:`${output}/failure.png`})
  await browser.close()
}
