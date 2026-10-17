import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/outline-navigation'
fs.mkdirSync(output, { recursive: true })
const source = Array.from({length:12},(_,i)=>`## 标题 ${i+1}\n\n`+Array.from({length:18},(_,j)=>`第 ${i+1} 节正文 ${j+1}。这里是测试滚动定位的内容。`).join('\n\n')).join('\n\n')
fs.writeFileSync(`${output}/index.html`,'<!doctype html><meta charset="utf-8"><div id="app" style="height:650px;display:flex"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,h,ref} from 'vue';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {extractOutline} from '/src/editor/outline/outlineService.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import OutlineView from '/src/components/layout/OutlineView.vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/editor/markdown/styles.css';
const manager=new DocumentManager([{id:'md',name:'long.md',path:'C:/docs/long.md',text:${JSON.stringify(source)}}]);
manager.open('md',false);manager.setMarkdownMode('md','live');
const rev=ref(0);manager.subscribe(()=>rev.value++);
createApp({render(){rev.value;return [
 h('aside',{class:'left-outline',style:'width:180px;flex:none;display:flex;flex-direction:column'},[
 h(OutlineView,{items:extractOutline(manager.activeDocument,manager.getState('md')),isMarkdown:true,onSelectItem:item=>manager.revealOutline('md',item)})]),
 h(EditorContainer,{manager,doc:manager.activeDocument,showOutline:true,desktop:false})];}}).mount('#app');
window.f={manager,items:()=>extractOutline(manager.activeDocument,manager.getState('md'))};document.body.classList.add('light');
`)
const server = await createServer({server:{port:1429,strictPort:true}});await server.listen()
let browser
const results=[]
try {
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage({viewport:{width:1360,height:700}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://localhost:1429/${output}/index.html`)
  await page.waitForFunction(()=>window.f?.items().length===12&&document.querySelector('.md-prose h2')).catch(async error=>{
    console.error(errors,await page.evaluate(()=>({html:document.body.innerText.slice(0,1200),items:window.f?.items().length,doc:window.f?.manager.activeDocument})));throw error
  })
  const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
  const jump=async(side,title)=>page.locator(side+' .outline-label').filter({hasText:new RegExp(`^${title}$`)}).click()
  const position=async(pane,index)=>page.locator(`[data-pane-id="${pane}"] .markdown-live`).evaluate((scroll,index)=>({
    offset:scroll.querySelectorAll('h2')[index].getBoundingClientRect().top-scroll.getBoundingClientRect().top,top:scroll.scrollTop
  }),index)
  await test('right outline jumps to distant heading at top, including repeated/visible heading',async()=>{
    await jump('.outline-sidebar','标题 8')
    assert.ok(Math.abs((await position('main',7)).offset-24)<2)
    const initial=(await position('main',7)).top
    await jump('.outline-sidebar','标题 8');assert.ok(Math.abs((await position('main',7)).top-initial)<2)
    await page.locator('.markdown-live').evaluate(el=>el.scrollTop-=180)
    await jump('.outline-sidebar','标题 8');assert.ok(Math.abs((await position('main',7)).offset-24)<2)
  })
  await test('left outline jumps backward/forward, with no content or dirty-state changes',async()=>{
    const before=await page.evaluate(()=>({text:window.f.manager.getText('md'),dirty:window.f.manager.activeDocument.dirty}))
    await jump('.left-outline','标题 2');assert.ok(Math.abs((await position('main',1)).offset-24)<2)
    await jump('.left-outline','标题 11');assert.ok(Math.abs((await position('main',10)).offset-24)<2)
    assert.deepEqual(await page.evaluate(()=>({text:window.f.manager.getText('md'),dirty:window.f.manager.activeDocument.dirty})),before)
  })
  await test('source mode aligns the heading line and keeps the caret at its source position',async()=>{
    await page.evaluate(()=>window.f.manager.setMarkdownMode('md','source'))
    await page.locator('.cm-content').waitFor()
    await jump('.outline-sidebar','标题 9')
    await page.waitForFunction(()=>{
      const v=window.f.manager.activeEditorView,item=window.f.items()[8]
      return v&&Math.abs(v.coordsAtPos(item.from).top-v.scrollDOM.getBoundingClientRect().top-24)<3
    })
    assert.equal(await page.evaluate(()=>window.f.manager.activeEditorView.state.selection.main.head),source.indexOf('## 标题 9\n'))
  })
  await test('Markdown split preview follows outline navigation',async()=>{
    await page.evaluate(()=>window.f.manager.setMarkdownMode('md','split'))
    await page.locator('.split-preview-content h2').nth(8).waitFor()
    await jump('.left-outline','标题 10')
    await page.waitForFunction(()=>{
      const scroll=document.querySelector('.split-preview-content'),heading=scroll?.querySelectorAll('h2')[9]
      return heading&&heading.getBoundingClientRect().top>=scroll.getBoundingClientRect().top-2&&heading.getBoundingClientRect().top<scroll.getBoundingClientRect().bottom-20
    })
  })
  await test('two live panes scroll only the active pane',async()=>{
    await page.evaluate(()=>{window.f.manager.setMarkdownMode('md','live');window.f.other=window.f.manager.splitPane('right','main')})
    await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
    await page.evaluate(()=>{
      const m=window.f.manager
      document.querySelector('[data-pane-id="'+window.f.other+'"] .markdown-live').scrollTop=150
      m.focusPane('main',false)
    })
    const other=await page.evaluate(()=>window.f.other),before=(await position(other,0)).top
    await jump('.outline-sidebar','标题 7')
    assert.ok(Math.abs((await position('main',6)).offset-24)<2)
    assert.ok(Math.abs((await position(other,0)).top-before)<2)
    await page.evaluate(()=>window.f.manager.focusPane(window.f.other,false))
    const main=(await position('main',0)).top
    await jump('.left-outline','标题 4')
    assert.ok(Math.abs((await position(other,3)).offset-24)<2)
    assert.ok(Math.abs((await position('main',0)).top-main)<2)
    await page.screenshot({path:`${output}/split-navigation.png`})
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:results,errors},null,2))
  console.log(`PASS ${results.length} outline navigation checks`)
} finally {await browser?.close();await server.close()}
