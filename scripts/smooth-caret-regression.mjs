// Isolated headless browser; does not touch the OS clipboard or user documents.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/smooth-caret'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/pixel.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64'))
fs.writeFileSync(`${output}/index.html`, `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="height:720px;display:flex"></div><script type="module" src="./fixture.js"></script>`)
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,h,ref,markRaw} from 'vue';
import SplitLayoutNode from '/src/components/layout/SplitLayoutNode.vue';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {EditorView as CM} from '@codemirror/view';
import {EditorState as CMState,EditorSelection} from '@codemirror/state';
import {TextSelection,NodeSelection} from 'prosemirror-state';
import {CellSelection} from 'prosemirror-tables';
import {GapCursor} from 'prosemirror-gapcursor';
import {CaretMotion,caretTimings} from '/src/editor/core/caretMotion.ts';
import {measureCaret} from '/src/editor/core/caretOverlay.ts';
import {smoothCaret} from '/src/editor/core/smoothCaret.ts';
import {markdownResources} from '/src/editor/markdown/images.ts';
import {settingsFrom,defaultSettings,persistedSettings} from '/src/features/shell/editorSettings.ts';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';
const manager=new DocumentManager([],async()=>[]),revision=ref(0);manager.subscribe(()=>revision.value++);
createApp({render(){revision.value;return h(SplitLayoutNode,{manager:markRaw(manager),node:manager.layout.root,revision:revision.value,desktop:false});}}).mount('#app');
window.f={manager,CM,CMState,EditorSelection,TextSelection,NodeSelection,CellSelection,GapCursor,CaretMotion,caretTimings,measureCaret,smoothCaret,markdownResources,settingsFrom,defaultSettings,persistedSettings,
  cm:()=>manager.activeEditorView,live:()=>manager.activeLiveEditor,
  range(from,to=from){const v=this.live().view;v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc,from,to)));v.focus();},
  reset(source,ext='txt'){const id=manager.createUntitled(ext);manager.dispatch(id,{changes:{from:0,insert:source}});return id;},
  visible:()=>[...document.querySelectorAll('.smooth-caret-layer')].filter(e=>!e.hidden),
  aligned(){const host=document.querySelector('.smooth-caret-active');if(!host)return false;const cm=host.classList.contains('cm-editor')?CM.findFromDOM(host):null;
    const rect=cm?cm.coordsAtPos(cm.state.selection.main.head):this.live().view.coordsAtPos(this.live().view.state.selection.head);
    const visual=this.visible()[0]?.firstChild.getBoundingClientRect();return !!visual&&Math.abs(visual.left-rect.left)<1.5&&Math.abs(visual.top-rect.top)<1.5;}
};
window.caretFrames=0;const raf=window.requestAnimationFrame;window.requestAnimationFrame=callback=>raf.call(window,t=>{window.caretFrames++;callback(t);});
`)
const server = await createServer({ server: { port: 1431, strictPort: true } })
await server.listen()
let browser
const results = []
try {
  browser = await chromium.launch({ headless: true, ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()) })
  await page.goto('http://localhost:1431/' + output + '/index.html')
  await page.waitForFunction(() => window.f)
  const test = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name) }
  const aligned = () => page.waitForFunction(() => window.f.aligned())
  const cmReset = async source => {
    await page.evaluate(source => window.f.reset(source), source)
    await page.evaluate(() => window.f.cm().focus())
    await aligned()
    await page.waitForTimeout(80)
  }
  const liveReset = async source => {
    await page.evaluate(source => window.f.reset(source, 'md'), source)
    await page.waitForFunction(() => window.f.live())
    await page.evaluate(() => window.f.range(1))
    await aligned()
  }

  await test('interpolation duration, ease-out, mid-flight retarget, jump snap and reset', async () => {
    const result = await page.evaluate(() => {
      const { CaretMotion, caretTimings } = window.f, m = new CaretMotion(), t = caretTimings.smooth
      m.set({x:10,y:10,height:20},0,t);m.set({x:110,y:10,height:20},0,t)
      const middle=m.sample(60).x;m.set({x:160,y:10,height:20},60,t)
      const retarget=m.sample(60).x, end=m.sample(180).x, stopped=!m.moving
      m.set({x:160,y:30,height:20},200,t);const vertical=m.sample(340).y;m.sample(360)
      m.set({x:160,y:700,height:20},400,t);const verticalSnap=m.sample(400),verticalStopped=!m.moving
      m.set({x:1000,y:700,height:20},400,t);const snap=m.sample(400);m.reset()
      return {middle,retarget,end,stopped,vertical,verticalSnap,verticalStopped,snap,reset:m.sample(500)}
    })
    assert.equal(result.middle, 97.5);assert.equal(result.retarget,97.5);assert.equal(result.end,160);assert.equal(result.stopped,true)
    assert.ok(result.vertical>29&&result.vertical<30);assert.equal(result.snap.x,1000);assert.equal(result.reset,null)
    assert.equal(result.verticalSnap.y,700);assert.equal(result.verticalStopped,true)
  })
  await test('old/invalid settings default to smooth; all three modes survive persistence', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const f=window.f;return [f.defaultSettings().caretAnimation,f.settingsFrom({}).caretAnimation,f.settingsFrom({caretAnimation:'bad'}).caretAnimation,
        ...['off','quick','smooth'].map(caretAnimation=>f.settingsFrom(f.persistedSettings(f.settingsFrom({caretAnimation}))).caretAnimation)]
    }), ['smooth','smooth','smooth','off','quick','smooth'])
  })
  await cmReset('abcdefghijklmnopqrstuvwxyz\nsecond line of text\nthird line')
  await test('CM selection is immediate, motion retargets and stable DOM settles accurately', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f,v=f.cm(),node=f.visible()[0].firstChild;v.dispatch({selection:{anchor:8}})
      await new Promise(r=>setTimeout(r,50))
      const target=v.coordsAtPos(8).left, visual=node.getBoundingClientRect().left
      for(let i=9;i<20;i++)v.dispatch({selection:{anchor:i}})
      window.stableCaret=node;return {head:v.state.selection.main.head,between:visual<target&&visual>v.coordsAtPos(0).left,visual,target}
    })
    assert.equal(value.head,19);assert.equal(value.between,true,JSON.stringify(value));await aligned()
    assert.equal(await page.evaluate(()=>window.stableCaret===window.f.visible()[0].firstChild),true)
  })
  await test('keyboard repeat, Home/End, PageUp/Down, click, typing, undo and redo', async () => {
    for(let i=0;i<20;i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('End');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown')
    await page.keyboard.press('PageDown');await page.keyboard.press('PageUp')
    await page.locator('.cm-content').first().click({position:{x:100,y:15}})
    const before=await page.evaluate(()=>window.f.manager.getText(window.f.manager.activeId))
    await page.keyboard.insertText('快速输入');await page.keyboard.press('Control+z')
    assert.equal(await page.evaluate(()=>window.f.manager.getText(window.f.manager.activeId)),before)
    await page.keyboard.press('Control+y');await aligned()
  })
  await test('CM cross-line motion interpolates vertically', async () => {
    await page.evaluate(()=>window.f.cm().dispatch({selection:{anchor:1}}));await aligned()
    const value=await page.evaluate(async()=>{const f=window.f,v=f.cm(),node=f.visible()[0].firstChild,start=node.getBoundingClientRect().top;v.dispatch({selection:{anchor:v.state.doc.line(2).from+1}});
      await new Promise(r=>setTimeout(r,50));return {start,visual:node.getBoundingClientRect().top,target:v.coordsAtPos(v.state.selection.main.head).top}})
    assert.ok(value.visual>value.start&&value.visual<value.target,JSON.stringify(value));await aligned()
  })
  await test('real build.bat clicks animate from line 6 end to line 12 end, middle and empty lines', async () => {
    await cmReset(fs.readFileSync('build.bat','utf8').replace(/\r\n/g,'\n'))
    const point=async(line,end=true)=>page.evaluate(({line,end})=>{const v=window.f.cm(),text=v.state.doc.line(line),pos=end?text.to:Math.min(text.to,text.from+3),rect=v.coordsAtPos(pos);return {x:rect.left+(end?50:0),y:(rect.top+rect.bottom)/2,pos}}, {line,end})
    for(const mode of ['smooth','quick']) {
      await page.evaluate(mode=>window.f.manager.setCaretAnimation(mode),mode)
      for(const [from,to,end] of [[6,12,true],[12,6,true],[6,12,false],[12,17,true]]) {
        const startPoint=await point(from,end),targetPoint=await point(to,end)
        await page.mouse.click(startPoint.x,startPoint.y);await aligned();await page.waitForTimeout(30)
        const start=await page.evaluate(()=>window.f.visible()[0].firstChild.getBoundingClientRect().top)
        await page.mouse.click(targetPoint.x,targetPoint.y)
        assert.equal(await page.evaluate(()=>window.f.cm().state.selection.main.head),targetPoint.pos)
        await page.waitForTimeout(45)
        const value=await page.evaluate(()=>{const f=window.f,v=f.cm();return {visual:f.visible()[0]?.firstChild.getBoundingClientRect().top,target:v.coordsAtPos(v.state.selection.main.head).top}})
        const progress=(value.visual-start)/(value.target-start)
        assert.ok(progress>0&&progress<.99,JSON.stringify({mode,from,to,end,start,...value,progress}))
        await aligned()
      }
    }
    await page.evaluate(()=>window.f.manager.setCaretAnimation('smooth'))
  })
  await test('CM nonempty/multi-range selections preserve drawSelection and native cursors', async () => {
    await page.evaluate(()=>window.f.cm().dispatch({selection:{anchor:1,head:8}}))
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.waitForFunction(()=>document.querySelector('.cm-selectionBackground'))
    await page.evaluate(()=>{const f=window.f;f.cm().dispatch({selection:f.EditorSelection.create([f.EditorSelection.cursor(1),f.EditorSelection.cursor(5)])})})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.waitForFunction(()=>document.querySelectorAll('.cm-cursor').length===2)
    await page.evaluate(()=>window.f.cm().dispatch({selection:{anchor:3}}));await aligned()
  })
  await test('CM IME composition immediately falls back and committed Chinese text aligns', async () => {
    const client=await page.context().newCDPSession(page)
    await client.send('Input.imeSetComposition',{text:'拼音',selectionStart:2,selectionEnd:2})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await client.send('Input.insertText',{text:'中文'})
    await page.keyboard.press('ArrowRight');await aligned()
    assert.match(await page.evaluate(()=>window.f.cm().state.doc.toString()),/中文/)
    await client.detach()
  })
  await test('CM unavailable coordinates restore native caret and recover after measurement succeeds', async () => {
    await page.evaluate(()=>{const v=window.f.cm();v.coordsAtPos=()=>null;v.dispatch({selection:{anchor:6}})})
    await page.waitForFunction(()=>!document.querySelector('.smooth-caret-active'))
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.cm-cursorLayer')).visibility),'visible')
    await page.evaluate(()=>{const v=window.f.cm();delete v.coordsAtPos;v.dispatch({selection:{anchor:7}})});await aligned()
  })
  await test('mode setting applies without editor rebuild or undo loss; reduced motion snaps', async () => {
    await page.evaluate(()=>{window.originalView=window.f.cm();window.f.manager.setCaretAnimation('off')})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>window.f.manager.setCaretAnimation('quick'));await aligned()
    assert.equal(await page.evaluate(()=>window.originalView===window.f.cm()),true)
    await page.emulateMedia({reducedMotion:'reduce'});await aligned()
    await page.evaluate(()=>window.f.cm().dispatch({selection:{anchor:12}}));await aligned()
    assert.equal(await page.evaluate(()=>window.f.visible()[0].firstChild.getAnimations().length),0)
    await page.emulateMedia({reducedMotion:'no-preference'})
    await page.evaluate(()=>window.f.manager.setCaretAnimation('smooth'))
  })
  await test('long documents, scroll, soft wrap, font changes, zoom, resize and invalid coords', async () => {
    await cmReset(('long text '.repeat(60)+'\n').repeat(5000))
    await page.evaluate(()=>{const f=window.f,v=f.cm(),at=v.state.doc.line(4000).from;v.dispatch({selection:{anchor:at},effects:f.CM.scrollIntoView(at,{y:'center'})})})
    await aligned()
    await page.evaluate(()=>{const f=window.f;f.manager.setWrap(true);document.documentElement.style.setProperty('--editor-size','18px');document.documentElement.style.zoom='1.1'})
    await page.setViewportSize({width:1020,height:760})
    await page.evaluate(()=>{const f=window.f,v=f.cm();v.dispatch({effects:f.CM.scrollIntoView(v.state.selection.main.head,{y:'center'})})})
    await aligned()
    await page.evaluate(()=>window.f.cm().scrollDOM.scrollTop+=80)
    await page.waitForTimeout(100)
    const visible=await page.evaluate(()=>window.f.visible().length)
    if(visible) await aligned()
    assert.equal(await page.evaluate(()=>window.f.measureCaret(window.f.cm().dom,{left:NaN,top:0,right:0,bottom:0})),null)
    await page.evaluate(()=>{document.documentElement.style.zoom='';window.f.manager.setWrap(false)})
  })
  await test('same-document split sync keeps independent selections and only focused caret', async () => {
    await cmReset('split text\nsecond line')
    await page.evaluate(()=>window.f.manager.splitEditor())
    await page.waitForFunction(()=>document.querySelectorAll('.cm-editor').length===2)
    await page.locator('.cm-content').last().click();await aligned()
    await page.keyboard.insertText('SYNC')
    await page.waitForFunction(()=>{const f=window.f,views=[...document.querySelectorAll('.cm-editor')].map(el=>f.CM.findFromDOM(el));return views[0].state.doc.eq(views[1].state.doc)})
    assert.equal(await page.evaluate(()=>window.f.visible().length),1)
    await page.evaluate(()=>window.f.manager.setCaretAnimation('off'));assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>window.f.manager.setCaretAnimation('smooth'));await aligned()
    await page.evaluate(()=>window.f.manager.closePane(window.f.manager.activePane))
  })
  const markdown='# Heading\n\nparagraph text to animate\n\n> quote text\n\n- list item\n\n| A | B |\n| --- | --- |\n| cell | cell |\n\n```js\nconst n = 1\nsecond line\n```\n\nafter code\n'
  await liveReset(markdown)
  await test('PM immediate selection, stable visual animation, selection and node/gap/table fallback', async () => {
    await page.waitForTimeout(80)
    const motion=await page.evaluate(async()=>{const f=window.f,v=f.live().view,node=f.visible()[0].firstChild,start=node.getBoundingClientRect().left;window.pmCaret=node;f.range(5);
      const head=v.state.selection.head;await new Promise(r=>setTimeout(r,50));return {head,start,visual:node.getBoundingClientRect().left,target:v.coordsAtPos(5).left}})
    assert.equal(motion.head,5);assert.ok(motion.visual>motion.start&&motion.visual<motion.target,JSON.stringify(motion))
    await aligned()
    assert.equal(await page.evaluate(()=>window.pmCaret===window.f.visible()[0].firstChild),true)
    await page.evaluate(()=>window.f.range(1,4));assert.equal(await page.locator('.smooth-caret-active').count(),0)
    for(const kind of ['node','gap','cell']){
      await page.evaluate(kind=>{const f=window.f,v=f.live().view;let at;v.state.doc.descendants((node,pos)=>{if(at===undefined&&(kind==='cell'?node.type.name==='table_cell':node.type.name==='code_block'))at=pos});
        const selection=kind==='node'?f.NodeSelection.create(v.state.doc,at):kind==='gap'?new f.GapCursor(v.state.doc.resolve(at)):f.CellSelection.create(v.state.doc,at);v.dispatch(v.state.tr.setSelection(selection));},kind)
      assert.equal(await page.locator('.smooth-caret-active').count(),0)
    }
    await page.evaluate(()=>window.f.range(2));await aligned()
  })
  await test('PM headings, paragraphs, list, quote, table, layout changes and source integrity', async () => {
    const positions=await page.evaluate(()=>{const v=window.f.live().view,a=[];v.state.doc.descendants((node,pos)=>{if(node.isTextblock&&!node.type.spec.code&&a.length<10)a.push(pos+1)});return a})
    for(const pos of positions){await page.evaluate(pos=>window.f.range(pos),pos);await aligned()}
    await page.evaluate(()=>{const m=window.f.manager;m.setMarkdownTypography({...m.getMarkdownTypography(),fontSize:20,lineHeight:1.8,width:680})});await aligned()
    assert.equal(await page.evaluate(()=>window.f.manager.getText(window.f.manager.activeId)),markdown)
  })
  await test('PM Enter animates across lines while content grows, and undo preserves Markdown', async () => {
    await page.evaluate(()=>{const f=window.f;let at;f.live().view.state.doc.descendants((node,pos)=>{if(node.type.name==='paragraph'&&node.textContent.startsWith('paragraph'))at=pos+6});f.range(at)})
    await aligned()
    await page.evaluate(()=>window.enterTop=window.f.visible()[0].firstChild.getBoundingClientRect().top)
    await page.keyboard.press('Enter');await page.waitForTimeout(50)
    const value=await page.evaluate(()=>{const f=window.f,v=f.live().view;return {start:window.enterTop,visual:f.visible()[0].firstChild.getBoundingClientRect().top,target:v.coordsAtPos(v.state.selection.head).top}})
    assert.ok(value.visual>value.start&&value.visual<value.target,JSON.stringify(value));await aligned()
    await page.keyboard.press('Control+z')
    assert.equal(await page.evaluate(()=>window.f.manager.getText(window.f.manager.activeId)),markdown)
  })
  await test('PM ↔ nested CM focus handoff, composition, settings and NodeView destruction', async () => {
    await page.locator('.md-code-block .cm-content').click();await aligned()
    assert.equal(await page.evaluate(()=>document.querySelector('.smooth-caret-active')?.classList.contains('cm-editor')),true)
    await page.keyboard.press('End');await aligned()
    await page.evaluate(()=>window.codeTop=window.f.visible()[0].firstChild.getBoundingClientRect().top)
    await page.keyboard.press('Enter');await page.waitForTimeout(50)
    const enter=await page.evaluate(()=>{const f=window.f,v=f.CM.findFromDOM(document.querySelector('.md-code-block .cm-editor'));return {start:window.codeTop,visual:f.visible()[0].firstChild.getBoundingClientRect().top,target:v.coordsAtPos(v.state.selection.main.head).top}})
    assert.ok(enter.visual>enter.start&&enter.visual<enter.target,JSON.stringify(enter));await aligned()
    await page.keyboard.insertText('中文')
    await page.evaluate(()=>window.f.manager.setCaretAnimation('off'));assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>window.f.manager.setCaretAnimation('quick'));await aligned()
    await page.evaluate(()=>{const f=window.f,cm=f.CM.findFromDOM(document.querySelector('.md-code-block .cm-editor'));cm.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>document.querySelector('.md-code-block .cm-content').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})))
    await page.evaluate(()=>window.f.range(2));await aligned()
    assert.equal(await page.evaluate(()=>document.querySelector('.smooth-caret-active')===window.f.live().view.dom),true)
    const client=await page.context().newCDPSession(page)
    await client.send('Input.imeSetComposition',{text:'拼音',selectionStart:2,selectionEnd:2})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await client.send('Input.insertText',{text:'中文'});await page.keyboard.press('ArrowRight');await aligned();await client.detach()
    await page.evaluate(()=>{const f=window.f,v=f.live().view;let at,node;v.state.doc.descendants((n,p)=>{if(n.type.name==='code_block'){at=p;node=n}});window.oldCodeLayer=document.querySelector('.md-code-block .smooth-caret-layer');v.dispatch(v.state.tr.delete(at,at+node.nodeSize))})
    assert.equal(await page.evaluate(()=>window.oldCodeLayer.isConnected),false)
    await page.keyboard.press('Control+z')
  })
  await test('live/source mode switches and document switching remove ghosts', async () => {
    await page.evaluate(()=>{const m=window.f.manager;window.mdId=m.activeId;m.setMarkdownMode(m.activeId,'source')})
    await page.waitForFunction(()=>window.f.cm());await page.evaluate(()=>window.f.cm().focus());await aligned()
    await page.evaluate(()=>{const m=window.f.manager;m.setMarkdownMode(m.activeId,'live')})
    await page.waitForFunction(()=>window.f.live());await page.evaluate(()=>window.f.range(2));await aligned()
    await cmReset('other document')
    await page.evaluate(()=>window.f.manager.select(window.mdId));await page.waitForFunction(()=>window.f.live());await page.evaluate(()=>window.f.range(2));await aligned()
    assert.equal(await page.evaluate(()=>window.f.visible().length),1)
  })
  await test('same Markdown in two live panes then mixed source/live keeps source, undo and focus aligned', async () => {
    await page.evaluate(()=>window.f.manager.splitEditor())
    await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
    await page.locator('.md-prose').last().locator('p').first().click()
    await page.keyboard.insertText('双栏同步')
    await page.waitForFunction(()=>[...document.querySelectorAll('.md-prose')].every(el=>el.textContent.includes('双栏同步')))
    assert.equal(await page.evaluate(()=>window.f.visible().length),1)
    await page.keyboard.press('Control+z')
    await page.waitForFunction(()=>!window.f.manager.getText(window.f.manager.activeId).includes('双栏同步'))
    await page.keyboard.press('Control+y')
    await page.waitForFunction(()=>window.f.manager.getText(window.f.manager.activeId).includes('双栏同步'))
    await page.evaluate(()=>{const m=window.f.manager;m.setMarkdownMode(m.activeId,'source')})
    await page.waitForFunction(()=>document.querySelector('.md-prose')&&window.f.cm())
    await page.evaluate(()=>window.f.cm().focus());await aligned()
    await page.keyboard.insertText('mixed source ')
    await page.waitForFunction(()=>document.querySelector('.md-prose').textContent.includes('mixed source'))
    await page.locator('.md-prose p').first().click();await aligned()
    assert.equal(await page.evaluate(()=>window.f.visible().length),1)
    await page.evaluate(()=>{const m=window.f.manager;const other=m.layout.getAllLeafIds().find(id=>id!==m.activePane);m.closePane(other)})
    await page.waitForFunction(()=>window.f.live())
    await page.evaluate(()=>window.f.range(2));await aligned()
  })
  await test('read-only, invisible document and restored visibility use safe native fallback', async () => {
    await page.evaluate(()=>window.f.live().view.setProps({editable:()=>false}))
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>{window.f.live().view.setProps({editable:()=>true});window.f.live().focus()});await aligned()
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await aligned()
    await page.evaluate(()=>{const f=window.f,host=document.createElement('div');host.id='readonly-fixture';document.body.append(host);window.readonlyCM=new f.CM({parent:host,state:f.CMState.create({doc:'readonly',extensions:[f.smoothCaret(),f.CMState.readOnly.of(true)]})});window.readonlyCM.focus()})
    await page.waitForTimeout(50);assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>{window.readonlyCM.destroy();document.querySelector('#readonly-fixture').remove();window.f.range(2)});await aligned()
  })
  await test('short PM document remeasures typography even when its min-height does not change', async () => {
    await liveReset('short text');await page.evaluate(()=>window.f.range(5));await aligned()
    const before=await page.evaluate(()=>window.f.live().view.dom.getBoundingClientRect().height)
    await page.evaluate(()=>{const m=window.f.manager;m.setMarkdownTypography({...m.getMarkdownTypography(),fontSize:24,lineHeight:2})})
    await page.waitForFunction(()=>{const f=window.f,v=f.live().view,r=v.coordsAtPos(v.state.selection.head),caret=f.visible()[0]?.firstChild.getBoundingClientRect();return !!caret&&Math.abs(caret.height-(r.bottom-r.top))<.1&&f.aligned()})
    assert.equal(await page.evaluate(()=>window.f.live().view.dom.getBoundingClientRect().height),before)
  })
  await test('image and HTML NodeView layout changes remeasure without changing source or leaving ghosts', async () => {
    const source='before image\n\n![pixel](pixel.png)\n\n<div>HTML block</div>\n\nafter image'
    await page.evaluate(source=>{const f=window.f,id=f.reset(source,'md');f.manager.getState(id).facet(f.markdownResources).loadLocal=async()=>new Uint8Array(await(await fetch('/test-results/smooth-caret/pixel.png')).arrayBuffer())},source)
    await page.waitForFunction(()=>window.f.live()&&document.querySelector('.md-live-image img')?.naturalWidth)
    await page.evaluate(()=>{const f=window.f;let at;f.live().view.state.doc.descendants((node,pos)=>{if(node.type.name==='paragraph'&&node.textContent.startsWith('after'))at=pos+3});f.range(at)})
    await aligned()
    await page.evaluate(()=>{document.querySelector('.md-live-image img').style.height='120px';document.querySelector('.md-live-image img').style.width='120px';document.querySelector('.md-html-block-view .md-html-preview').style.minHeight='80px'})
    await aligned()
    assert.equal(await page.evaluate(()=>window.f.manager.getText(window.f.manager.activeId)),source)
    await page.evaluate(()=>{const f=window.f,v=f.live().view;let at;v.state.doc.descendants((node,pos)=>{if(node.type.name==='image')at=pos});v.dispatch(v.state.tr.setSelection(f.NodeSelection.create(v.state.doc,at)))})
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>window.f.range(2));await aligned()
  })
  await test('idle has no continuous rAF; blur restores native; destroy cancels all visual work', async () => {
    await page.waitForTimeout(300)
    const before=await page.evaluate(()=>window.caretFrames);await page.waitForTimeout(200)
    assert.ok(await page.evaluate(()=>window.caretFrames)-before<8)
    await page.screenshot({path:`${output}/live-caret.png`})
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')))
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await aligned()
    await page.evaluate(()=>{window.f.range(3);window.f.manager.dispose()})
    assert.equal(await page.locator('.smooth-caret-layer').count(),0)
    assert.equal(await page.locator('.smooth-caret-active').count(),0)
  })
  await test('real settings UI defaults, immediate changes and reload persistence', async () => {
    const app=await browser.newPage();app.on('pageerror',error=>errors.push(error.message))
    await app.goto('http://localhost:1431/')
    await app.getByTitle('设置',{exact:true}).click()
    const select=app.locator('#settings-caret-animation');await select.scrollIntoViewIfNeeded()
    assert.equal(await select.inputValue(),'smooth')
    for(const mode of ['off','quick','smooth']){
      await select.selectOption(mode)
      await app.waitForFunction(mode=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').caretAnimation===mode,mode)
    }
    await select.selectOption('quick')
    await app.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').caretAnimation==='quick')
    await app.reload();await app.getByTitle('设置',{exact:true}).click()
    assert.equal(await app.locator('#settings-caret-animation').inputValue(),'quick')
    await app.close()
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:results,errors},null,2))
  console.log(`PASS ${results.length} smooth caret regressions; no browser errors`)
} finally { await browser?.close(); await server.close() }
