import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium,browserOptions} from './helpers/markdown-browser.mjs'
const output='test-results/markdown-interactions';await mkdir(output,{recursive:true})
const module=`fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`,`<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`)
await writeFile(`${output}/${module}`,`
import {createApp,h,ref} from 'vue';import {DocumentManager} from '/src/editor/core/DocumentManager.ts';import EditorContainer from '/src/components/layout/EditorContainer.vue';import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/editor/markdown/styles.css';
const manager=new DocumentManager([{id:'md',name:'interaction.md',path:'interaction.md',text:'before\\n\\n# Heading\\n\\nafter'}]);manager.open('md',false);document.body.classList.add('light');const rev=ref(0);manager.subscribe(()=>rev.value++);window.fixture={manager,live:()=>manager.liveViews.get('main')?.editor,view:()=>manager.liveViews.get('main')?.editor.view};createApp({render(){rev.value;return h(EditorContainer,{doc:manager.activeDocument,manager,showOutline:false,desktop:false})}}).mount('#app');`)
const browser=await chromium.launch(browserOptions),page=await browser.newPage({viewport:{width:1200,height:850}}),results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
const raw=()=>page.evaluate(()=>window.fixture.manager.getText('md'))
async function settle(){await page.waitForFunction(()=>{const v=window.fixture.view(),sel=document.getSelection();if(!sel?.anchorNode||!sel.focusNode||!v.dom.contains(sel.anchorNode))return false;return v.state.selection.anchor===v.posAtDOM(sel.anchorNode,sel.anchorOffset)&&v.state.selection.head===v.posAtDOM(sel.focusNode,sel.focusOffset)})}
async function reset(source){await page.evaluate(source=>{const m=window.fixture.manager;m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:source}})},source);await page.locator('.md-prose').waitFor()}
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
try{
 await page.route('**/tests/fixtures/logo.png',route=>route.fulfill({path:'tests/fixtures/language-experience/logo.png',contentType:'image/png'}))
 await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`);await page.locator('.md-prose').waitFor()
 await test('Backspace at H1-H6 starts removes only heading syntax, keeps preceding paragraph and shares exact undo',async()=>{
  for(let level=1;level<=6;level++){
   const source=`before\n\n${'#'.repeat(level)} Heading\n\nafter`;await reset(source)
   await page.locator(`.md-prose h${level}`).click();await settle();await page.keyboard.press('Home')
   await page.waitForFunction(()=>window.fixture.view().state.selection.empty&&window.fixture.view().state.selection.$from.parentOffset===0)
   await page.keyboard.press('Backspace')
   assert.equal(await raw(),'before\n\nHeading\n\nafter');assert.equal(await page.locator(`.md-prose h${level}`).count(),0)
   await page.waitForFunction(()=>window.fixture.view().state.selection.empty&&window.fixture.view().state.selection.$from.parentOffset===0)
   await page.screenshot({path:`${output}/heading-backspace.png`})
   await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),source)
  }
  await reset('# Heading');await page.locator('.md-prose h1').click();await page.keyboard.press('Home');await page.waitForFunction(()=>window.fixture.view().state.selection.empty&&window.fixture.view().state.selection.$from.parent.type.name==='heading'&&window.fixture.view().state.selection.$from.parentOffset===0);await page.keyboard.press('Backspace');await page.waitForFunction(()=>!document.querySelector('.md-prose h1'));assert.equal(await raw(),'Heading')
  await reset('before\n\n# Heading');await page.locator('.md-prose h1').click();await page.keyboard.press('Home');await page.waitForFunction(()=>window.fixture.view().state.selection.empty&&window.fixture.view().state.selection.$from.parentOffset===0);await page.keyboard.press('Shift+ArrowRight');await page.waitForFunction(()=>!window.fixture.view().state.selection.empty);await page.keyboard.press('Backspace');await page.waitForFunction(()=>document.querySelector('.md-prose h1')?.textContent==='eading');assert.equal(await raw(),'before\n\n# eading')
 })
 await test('real typing of ```java, ``` and ~~~~python plus Enter creates focused embedded CM without a trailing space',async()=>{
  for(const header of ['```java','```','~~~~python','```c++']){
   await reset('before');await page.locator('.md-prose p').click();await page.keyboard.press('End')
   await page.waitForFunction(()=>{const s=window.fixture.view().state.selection;return s.empty&&s.$from.parent.textContent==='before'&&s.$from.parentOffset===6})
   await page.keyboard.press('Enter');await page.waitForFunction(()=>{const s=window.fixture.view().state.selection;return s.empty&&s.$from.parent.type.name==='paragraph'&&s.$from.parent.content.size===0})
   await page.keyboard.type(header,{delay:8});const before=await raw();await page.keyboard.press('Enter')
   const block=page.locator('.md-code-block');await block.waitFor()
   assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.md-code-editor-wrap')),true)
   const params=await page.evaluate(()=>window.fixture.view().state.doc.lastChild.attrs.params)
   assert.equal(params,header.startsWith('~~~~')?'python':header.slice(3))
   const converted=await raw();assert.ok(converted.startsWith('before\n\n'+header+'\n'),JSON.stringify({header,converted}))
   await page.keyboard.insertText('value = 1');assert.ok((await raw()).includes('value = 1'))
   await page.screenshot({path:`${output}/code-fence-${params||'plain'}.png`})
   await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),converted)
   await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
  }
  await reset('not ```java');await page.locator('.md-prose p').click();await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.locator('.md-code-block').count(),0)
 })
 const tableSource='# Heading\n\nParagraph immediately before table\n\n| A | B |\n| --- | ---: |\n| one | two |\n\nafter'
 await test('table uses a compact full-width in-flow icon row without covering previous prose, with explicit row/column menu',async()=>{
  await reset(tableSource);await page.locator('.md-prose td').first().click()
  const bar=page.getByRole('toolbar',{name:'表格工具'}),table=page.locator('.md-prose table')
  await bar.waitFor()
  assert.equal(await bar.locator(':scope > button').count(),6)
  assert.equal(await bar.getByRole('button',{name:'后插行',exact:true}).isVisible(),false)
  const geometry=await bar.evaluate(el=>{const b=el.getBoundingClientRect(),t=el.nextElementSibling.getBoundingClientRect(),p=[...el.parentElement.querySelectorAll(':scope > p')][0].getBoundingClientRect();return {bar:b.toJSON(),table:t.toJSON(),previous:p.toJSON(),position:getComputedStyle(el).position}})
  assert.equal(geometry.position,'relative');assert.ok(geometry.previous.bottom<=geometry.bar.top);assert.ok(geometry.bar.bottom<=geometry.table.top+.5);assert.ok(Math.abs(geometry.bar.width-geometry.table.width)<1)
  await page.screenshot({path:`${output}/table-toolbar.png`})
  await bar.getByRole('button',{name:'更多操作',exact:true}).click();await page.screenshot({path:`${output}/table-menu.png`})
  await bar.getByRole('button',{name:'后插行',exact:true}).click();assert.equal(await table.locator('tr').count(),3)
  await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),tableSource)
  await page.locator('.md-prose td').first().click();await bar.waitFor()
  await bar.getByRole('button',{name:'居中对齐',exact:true}).click();assert.equal(await table.locator('td').first().getAttribute('style'),'text-align: center;')
  await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),tableSource)
  await page.setViewportSize({width:420,height:720});await page.locator('.md-prose td').first().click()
  const narrow=await bar.boundingBox();assert.ok(narrow.x>=0 && narrow.x+narrow.width<=420)
  await page.screenshot({path:`${output}/table-narrow.png`});await page.setViewportSize({width:1200,height:850})
 })
 await test('Live images override legacy grey frame/220px limit, keep source close, and support zoom preview without editing Markdown',async()=>{
  const source='![logo](./logo.png)\n\nafter';await reset(source)
  const image=page.locator('.md-live-image img');await page.waitForFunction(()=>document.querySelector('.md-live-image img')?.naturalWidth>0)
  const style=await image.evaluate(img=>{const c=getComputedStyle(img.parentElement),i=getComputedStyle(img);return {border:c.borderWidth,padding:c.padding,background:c.backgroundColor,maxHeight:i.maxHeight,height:img.getBoundingClientRect().height}})
  assert.equal(style.border,'0px');assert.equal(style.padding,'0px');assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.maxHeight,'none');assert.ok(style.height>220)
  await image.click();const input=page.locator('.md-source-image');await input.waitFor()
  const gap=await image.evaluate(img=>img.getBoundingClientRect().top-document.querySelector('.md-source-image').getBoundingClientRect().bottom)
  assert.ok(gap>=0 && gap<=16,`image/source gap ${gap}`)
  await page.screenshot({path:`${output}/image-source.png`});await image.hover();await page.getByRole('button',{name:'放大预览',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'图片放大预览'});await dialog.waitFor();const size=(await dialog.locator('img').boundingBox()).width
  await dialog.getByRole('button',{name:'放大',exact:true}).click();assert.ok((await dialog.locator('img').boundingBox()).width>size)
  await dialog.getByRole('button',{name:'原始大小',exact:true}).click();assert.equal(await dialog.locator('output').innerText(),'100%')
  await dialog.getByRole('button',{name:'适应窗口',exact:true}).click();await page.screenshot({path:`${output}/image-preview.png`})
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await raw(),source)
  await image.dblclick();await dialog.waitFor();await dialog.getByRole('button',{name:'关闭预览'}).click();assert.equal(await raw(),source)
 })
 await test('image preview dismisses if another pane removes its exact target, preserving an identical neighbour',async()=>{
  await reset('![same](./logo.png)\n\n![same](./logo.png)');await page.evaluate(()=>window.fixture.manager.splitEditor());await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
  const first=page.locator('.main-pane .md-live-image img').first();await first.hover();await page.locator('.main-pane').getByRole('button',{name:'放大预览',exact:true}).first().click();await page.getByRole('dialog',{name:'图片放大预览'}).waitFor()
  await page.evaluate(()=>{const m=window.fixture.manager,v=[...m.liveViews.entries()].find(([p])=>p!=='main')[1].editor.view;let pos;v.state.doc.descendants((node,at)=>{if(pos===undefined&&node.type.name==='image')pos=at});v.dispatch(v.state.tr.delete(pos,pos+1))})
  assert.equal(await page.getByRole('dialog',{name:'图片放大预览'}).isVisible(),false);assert.equal((await raw()).match(/!\[same\]/g)?.length,1)
  await page.evaluate(()=>{const m=window.fixture.manager;m.focusPane('main',false);m.mergeAllPanes()})
 })
 assert.deepEqual(errors,[])
}catch(error){console.error(error);results.push({name:'failure',result:'FAIL',error:String(error)});await page.screenshot({path:`${output}/failure.png`});process.exitCode=1}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
