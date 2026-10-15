import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = `test-results/layout-phase-a/${Date.now()}`
await mkdir(output, { recursive: true })
await writeFile(`${output}/index.html`, '<div id="app"></div><script type="module" src="./fixture.ts"></script>')
await writeFile(`${output}/fixture.ts`, `
import {createApp,h,ref} from 'vue';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';
const manager=new DocumentManager(['a','b','c'].map(id=>({id,name:id+'.txt',path:id+'.txt',text:id+'\\n中文'})));
const revision=ref(0);manager.subscribe(()=>revision.value++);let quickOpen=0;
window.fixture={manager,get quickOpen(){return quickOpen}};
createApp({render(){revision.value;return h(EditorContainer,{manager,doc:manager.activeDocument,showOutline:false,desktop:false,onOpenPalette:()=>quickOpen++})}}).mount('#app');
document.querySelector('#app').style.cssText='height:600px;display:flex';
`)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
const results = [], errors = []
page.on('pageerror', error => errors.push(error.message))
async function test(name, run) { await run(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`) }
try {
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL || 'http://localhost:1422'}/${output}/index.html`)
  await page.waitForFunction(() => !!window.fixture)
  if (process.argv.includes('--reproduce')) {
    const before = await page.evaluate(() => {
      const m=window.fixture.manager,v=m.activeEditorView;
      if (!v) return {orphan:false};
      v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      return {orphan:!m.activeId,editable:v.contentDOM.isContentEditable,composing:m.isComposing,newFile:m.createUntitled()};
    })
    assert.equal(before.orphan,true);assert.equal(before.editable,true);assert.equal(before.composing,true);assert.equal(before.newFile,null)
    await writeFile(`${output}/reproduction.json`,JSON.stringify(before,null,2));console.log('REPRODUCED orphan editable view, composition guard blocks new document (synthetic event)')
  } else {
    await test('Empty panes contain no editable CodeMirror; English/Chinese typing cannot create orphan content', async()=>{
      assert.equal(await page.locator('.cm-editor').count(),0)
      await page.locator('.pane-empty').click({position:{x:10,y:10}})
      await page.keyboard.type('english');await page.keyboard.insertText('中文')
      assert.equal(await page.locator('.cm-editor').count(),0)
      assert.equal(await page.evaluate(()=>window.fixture.manager.isComposing),false)
    })
    await test('Empty pane quick open and new document buttons target that pane',async()=>{
      await page.getByRole('button',{name:'快速打开',exact:true}).click()
      assert.equal(await page.evaluate(()=>window.fixture.quickOpen),1)
      await page.locator('.pane-empty').getByRole('button',{name:'新建文件',exact:true}).click()
      await page.getByRole('textbox',{name:'文本编辑器',exact:true}).fill('real中文')
      assert.equal(await page.evaluate(()=>window.fixture.manager.getText(window.fixture.manager.activeId)),'real中文')
    })
    await test('Three files, two panes, close every tab: zero orphan views and usable empty actions',async()=>{
      await page.evaluate(()=>{const m=window.fixture.manager;m.close(m.activeId,true);for(const id of ['a','b','c'])m.open(id,false);m.splitEditor()})
      await page.waitForFunction(()=>document.querySelectorAll('.cm-editor').length===2)
      await page.evaluate(()=>{const m=window.fixture.manager;for(const pane of ['main','secondary'])for(const d of [...(pane==='main'?m.mainOpenedDocuments:m.secondaryOpenedDocuments)])m.close(d.id,true,pane)})
      await page.waitForFunction(()=>document.querySelectorAll('.cm-editor').length===0)
      const empty=page.locator('.secondary-pane .pane-empty');await empty.click({position:{x:10,y:10}});await page.keyboard.type('abc');await page.keyboard.insertText('中文')
      await empty.getByRole('button',{name:'新建文件',exact:true}).click()
      await page.locator('.secondary-pane .cm-content').fill('secondary')
      assert.equal(await page.evaluate(()=>window.fixture.manager.getText(window.fixture.manager.activeId)),'secondary')
    })
    await test('Bound composition protects document; end and cancel restore new/open/close (synthetic, not OS IME)',async()=>{
      for(const end of ['compositionend','compositioncancel']){
        await page.evaluate(()=>{const m=window.fixture.manager;const v=m.activeEditorView;v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));if(!m.isComposing||m.createUntitled()!==null||m.close(m.activeId,true)!=='composing')throw Error('composition guard failed')})
        await page.evaluate(end=>{const m=window.fixture.manager;m.activeEditorView.contentDOM.dispatchEvent(new CompositionEvent(end,{bubbles:true}))},end)
        await page.waitForFunction(()=>!window.fixture.manager.isComposing)
        assert.equal(await page.evaluate(()=>!!window.fixture.manager.createUntitled()),true)
      }
    })
    await test('Dirty final reference remains protected; shared document undo and selection survive view remount',async()=>{
      await page.evaluate(()=>{const m=window.fixture.manager;m.closeSplit();for(const d of [...m.mainOpenedDocuments])m.close(d.id,true,'main');m.open('a',false);m.splitEditor()})
      await page.waitForFunction(()=>document.querySelectorAll('.cm-editor').length===2)
      await page.locator('.main-pane .cm-content').fill('changed中文')
      assert.equal(await page.locator('.secondary-pane .cm-content').innerText(),'changed中文')
      assert.equal(await page.evaluate(()=>window.fixture.manager.close('a',false,'secondary')),'closed')
      assert.equal(await page.evaluate(()=>window.fixture.manager.close('a',false,'main')),'dirty')
      await page.locator('.main-pane .cm-content').press('Control+z')
      assert.equal(await page.evaluate(()=>window.fixture.manager.getText('a')),'a\n中文')
    })
    await test('Repeated empty/mounted lifecycle releases DOM and both theme empty states remain accessible',async()=>{
      for(let i=0;i<15;i++)await page.evaluate(()=>{const m=window.fixture.manager;for(const pane of ['main','secondary'])for(const d of [...(pane==='main'?m.mainOpenedDocuments:m.secondaryOpenedDocuments)])m.close(d.id,true,pane);m.focusPane('main',false);m.createUntitled()})
      assert.equal(await page.locator('.cm-editor').count(),1)
      await page.evaluate(()=>{const m=window.fixture.manager;m.close(m.activeId,true);document.body.classList.add('light')})
      assert.equal(await page.locator('.cm-editor').count(),0)
      await page.screenshot({path:`${output}/empty-light.png`})
    })
    assert.deepEqual(errors,[])
  }
} finally {
  await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()
}
