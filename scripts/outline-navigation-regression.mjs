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
  const click=async(side,title)=>page.locator(side+' .outline-label').filter({hasText:new RegExp(`^${title}$`)}).click()
  const settled=async(title)=>page.waitForFunction(title=>{
    const m=window.f.manager, pane=document.querySelector('[data-pane-id="'+m.activePane+'"]'),scroll=pane?.querySelector('.markdown-live')
    if(scroll){const heading=[...scroll.querySelectorAll('h2')].find(node=>node.textContent===title);return heading&&Math.abs(heading.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24)<2}
    const v=m.activeEditorView,item=window.f.items().find(item=>item.name===title)
    const coords=v&&item&&v.coordsAtPos(item.from)
    return coords&&Math.abs(coords.top-v.scrollDOM.getBoundingClientRect().top-24)<3
  },title)
  const jump=async(side,title)=>{await click(side,title);await settled(title)}
  const recordFrames=async()=>page.evaluate(()=>{
    window.f.frames=[];window.f.framesDone=false
    const started=performance.now(),scroll=document.querySelector('[data-pane-id="'+window.f.manager.activePane+'"] .markdown-live,.cm-scroller')
    function frame(){window.f.frames.push(scroll.scrollTop);if(performance.now()-started<650)requestAnimationFrame(frame);else window.f.framesDone=true}
    requestAnimationFrame(frame)
  })
  const assertAnimation=async()=>{
    await page.waitForFunction(()=>window.f.framesDone)
    const frames=await page.evaluate(()=>window.f.frames),min=Math.min(...frames),max=Math.max(...frames)
    assert.ok(max-min>100,'Navigation must cover a meaningful distance')
    assert.ok(new Set(frames.filter(y=>y>min+2&&y<max-2).map(Math.round)).size>=3,'Must render intermediate scroll positions, rather than jump to the destination')
  }
  const position=async(pane,index)=>page.locator(`[data-pane-id="${pane}"] .markdown-live`).evaluate((scroll,index)=>({
    offset:scroll.querySelectorAll('h2')[index].getBoundingClientRect().top-scroll.getBoundingClientRect().top,top:scroll.scrollTop
  }),index)
  await test('right outline jumps to distant heading at top, including repeated/visible heading',async()=>{
    await recordFrames()
    await jump('.outline-sidebar','标题 8')
    await assertAnimation()
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
    await recordFrames()
    await jump('.outline-sidebar','标题 9')
    await assertAnimation()
    await page.waitForFunction(()=>{
      const v=window.f.manager.activeEditorView,item=window.f.items()[8]
      return v&&Math.abs(v.coordsAtPos(item.from).top-v.scrollDOM.getBoundingClientRect().top-24)<3
    })
    assert.equal(await page.evaluate(()=>window.f.manager.activeEditorView.state.selection.main.head),source.indexOf('## 标题 9\n'))
  })
  await test('Markdown split preview follows outline navigation',async()=>{
    await page.evaluate(()=>window.f.manager.setMarkdownMode('md','split'))
    await page.locator('.split-preview-content h2').nth(8).waitFor()
    await recordFrames()
    await jump('.left-outline','标题 10')
    await assertAnimation()
    await page.waitForFunction(()=>{
      const scroll=document.querySelector('.split-preview-content'),heading=scroll?.querySelectorAll('h2')[9]
      return heading&&heading.getBoundingClientRect().top>=scroll.getBoundingClientRect().top-2&&heading.getBoundingClientRect().top<scroll.getBoundingClientRect().bottom-20
    })
  })
  await test('outline width supports dragging, keyboard, limits, reset and narrow windows',async()=>{
    const handle=page.getByRole('separator',{name:'调整大纲宽度'}),outline=page.locator('.outline-sidebar')
    const width=async()=>Math.round((await outline.boundingBox()).width)
    assert.equal(await width(),240)
    let box=await handle.boundingBox()
    await page.mouse.move(box.x+2,box.y+100);await page.mouse.down();await page.mouse.move(box.x-118,box.y+100,{steps:8});await page.mouse.up()
    assert.equal(await width(),360)
    assert.equal(await page.evaluate(()=>document.body.style.cursor),'')
    await handle.focus();await page.keyboard.press('ArrowLeft');assert.equal(await width(),370)
    await page.keyboard.press('ArrowRight');assert.equal(await width(),360)
    await page.keyboard.press('Home');assert.equal(await width(),160)
    await page.keyboard.press('End');assert.equal(await width(),520)
    await page.setViewportSize({width:760,height:700})
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar').getBoundingClientRect().width<=340)
    assert.ok(await page.locator('.editor-main').evaluate(el=>el.clientWidth)>=240)
    await page.setViewportSize({width:1360,height:700})
    await page.waitForFunction(()=>Math.round(document.querySelector('.outline-sidebar').getBoundingClientRect().width)===520)
    await handle.dblclick();assert.equal(await width(),240)
  })
  await test('rapid outline clicks retarget from current position and manual wheel interrupts',async()=>{
    await page.evaluate(()=>window.f.manager.setMarkdownMode('md','live'))
    await page.locator('.md-prose').waitFor()
    await page.evaluate(()=>{const m=window.f.manager;m.focusPane('main',false);m.revealOutline('md',window.f.items()[10])})
    await settled('标题 11')
    await click('.outline-sidebar','标题 2')
    await page.waitForTimeout(90)
    await click('.outline-sidebar','标题 9')
    await settled('标题 9')
    await page.waitForTimeout(180)
    assert.ok(Math.abs((await position('main',8)).offset-24)<2)
    await click('.left-outline','标题 2')
    await page.waitForTimeout(90)
    await page.locator('[data-pane-id="main"] .markdown-live').hover();await page.mouse.wheel(0,140)
    await page.waitForTimeout(120)
    const interrupted=(await position('main',0)).top
    await page.waitForTimeout(500)
    assert.ok(Math.abs((await position('main',0)).top-interrupted)<2,'Wheel must cancel the pending animation')
    assert.ok(Math.abs((await position('main',1)).offset-24)>20)
  })
  await test('reduced-motion preference and closing an animated pane are handled',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'})
    const offset=await page.evaluate(()=>{
      const m=window.f.manager;m.revealOutline('md',window.f.items()[9]);
      const scroll=document.querySelector('[data-pane-id="main"] .markdown-live');return scroll.querySelectorAll('h2')[9].getBoundingClientRect().top-scroll.getBoundingClientRect().top
    })
    assert.ok(Math.abs(offset-24)<2)
    await page.emulateMedia({reducedMotion:'no-preference'})
    await page.evaluate(()=>{const m=window.f.manager;m.revealOutline('md',window.f.items()[1]);m.setMarkdownMode('md','source')})
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-pane-id="main"] .md-prose').count(),0)
  })
  await test('outline width persists through actual app settings and reload',async()=>{
    const app=await browser.newPage({viewport:{width:1200,height:800}})
    app.on('pageerror',e=>errors.push(e.message))
    await app.goto('http://localhost:1429/')
    await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-outline').scrollIntoViewIfNeeded();await app.locator('#settings-outline').check()
    await app.getByRole('button',{name:'完成',exact:true}).click()
    const create=async()=>{await app.getByRole('menuitem',{name:'文件',exact:true}).click();await app.getByRole('menuitem',{name:'新建 Markdown',exact:true}).click();await app.locator('.md-prose').waitFor()}
    await create()
    const handle=app.getByRole('separator',{name:'调整大纲宽度'}),box=await handle.boundingBox()
    await app.mouse.move(box.x+2,box.y+80);await app.mouse.down();await app.mouse.move(box.x-93,box.y+80,{steps:5});await app.mouse.up()
    await app.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').outlineWidth===335)
    await app.reload();await create()
    assert.equal(Math.round((await app.locator('.outline-sidebar').boundingBox()).width),335)
    await app.close()
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
