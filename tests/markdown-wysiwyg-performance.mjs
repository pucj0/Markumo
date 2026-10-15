import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFile} from 'node:fs/promises'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||'C:/Users/18089/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1280,height:900}}),requests=[],results={}
page.on('request',request=>requests.push(request.url()))
try{
  const start=performance.now();await page.goto((process.env.LIGHTEDIT_TEST_URL||'http://127.0.0.1:1423')+'/test-results/markdown-wysiwyg/fixture.html?plain=1');await page.locator('.main-pane .editor-host>.cm-editor').waitFor();results.txtColdNavigationMs=performance.now()-start
  assert.ok(!requests.some(url=>url.includes('MarkdownEditorController')||url.includes('prosemirror')||url.includes('/mermaid')||url.includes('/katex')),'ordinary TXT must not load PM/math/diagrams')
  results.txtRequestsExcludeRichText=true
  results.markdownFirstOpenMs=await page.evaluate(async()=>{const m=window.fixture.manager,start=performance.now();m.open('md',false);while(!m.liveViews.size)await new Promise(r=>setTimeout(r,10));return performance.now()-start})
  results.markdown100KB=await page.evaluate(async()=>{
    const m=window.fixture.manager;const text=('# Heading\n\n中文 English 😀 **bold** text repeated content.\n\n').repeat(2000).slice(0,102400)
    const file={token:'perf100',name:'100k.md',path:'E:/fixture/100k.md',text,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'},start=performance.now(),id=m.openFile(file,false)
    while(!m.liveViews.get('main')||m.liveViews.get('main').id!==id)await new Promise(r=>setTimeout(r,10));const loaded=performance.now()-start,editor=m.liveViews.get('main').editor,v=editor.view,identity=v.dom;const times=[]
    for(let i=0;i<30;i++){const t=performance.now();v.dispatch(v.state.tr.insertText('x',2));times.push(performance.now()-t)}times.sort((a,b)=>a-b)
    return {bytes:new TextEncoder().encode(text).length,characters:text.length,loadMs:loaded,medianTransactionMs:times[15],p95TransactionMs:times[28],sameEditorDOM:identity===v.dom}
  })
  results.markdown1MB=await page.evaluate(async()=>{
    const m=window.fixture.manager,text='paragraph text\n\n'.repeat(75000),start=performance.now(),id=m.openFile({token:'perf1m',name:'1m.md',path:'E:/fixture/1m.md',text,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'},false)
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    return {characters:text.length,loadMs:performance.now()-start,sourceFallback:!!m.paneView('main'),sourceIntact:m.getText(id)===text}
  })
  results.code1000Lines=await page.evaluate(async()=>{
    const m=window.fixture.manager,text='```js\n'+Array.from({length:1000},(_,i)=>`const line${i} = ${i};`).join('\n')+'\n```',start=performance.now(),id=m.openFile({token:'perfcode',name:'code.md',path:'E:/fixture/code.md',text,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'},false)
    while(!m.liveViews.get('main')||m.liveViews.get('main').id!==id)await new Promise(r=>setTimeout(r,10));const editor=m.liveViews.get('main').editor,cm=[...editor.codeViews][0].cm,t=performance.now();cm.dispatch({changes:{from:0,insert:'// edit\n'}});return {loadMs:t-start,transactionMs:performance.now()-t,lines:cm.state.doc.lines}
  })
  results.tableContinuous=await page.evaluate(async()=>{
    const m=window.fixture.manager,text='| A | B | C |\n| - | - | - |\n'+Array.from({length:100},()=> '| 中文 | **bold** | `code` |').join('\n'),start=performance.now(),id=m.openFile({token:'perftable',name:'table.md',path:'E:/fixture/table.md',text,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'},false)
    while(!m.liveViews.get('main')||m.liveViews.get('main').id!==id)await new Promise(r=>setTimeout(r,10));const loadMs=performance.now()-start,editor=m.liveViews.get('main').editor,v=editor.view;let at=0;v.state.doc.descendants((node,pos)=>{if(!at&&node.isText&&node.text==='中文')at=pos});const times=[];for(let i=0;i<100;i++){const t=performance.now();v.dispatch(v.state.tr.insertText('中',at));times.push(performance.now()-t)}times.sort((a,b)=>a-b);return {loadMs,medianTransactionMs:times[50],p95TransactionMs:times[95],rows:v.state.doc.firstChild.childCount}
  })
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const heapBefore=await cdp.send('Runtime.getHeapUsage')
  results.lifecycle=await page.evaluate(async()=>{const m=window.fixture.manager;for(let i=0;i<30;i++){m.open('txt',false);m.open('md',false);while(!m.liveViews.get('main'))await new Promise(r=>setTimeout(r,0))}const count=document.querySelectorAll('.md-prose').length;m.dispose();return {switches:60,editorsBeforeDispose:count,editorsAfterDispose:document.querySelectorAll('.ProseMirror,.cm-editor').length,note:'CDP full-GC heap samples; not a long-duration native RSS leak proof'}})
  await cdp.send('HeapProfiler.collectGarbage');results.lifecycle.heapBeforeGC=heapBefore.usedSize;results.lifecycle.heapAfterDisposeGC=(await cdp.send('Runtime.getHeapUsage')).usedSize
  assert.equal(results.markdown100KB.sameEditorDOM,true);assert.equal(results.markdown1MB.sourceFallback,true);assert.equal(results.markdown1MB.sourceIntact,true);assert.equal(results.lifecycle.editorsAfterDispose,0)
  console.log(JSON.stringify(results,null,2))
}finally{await writeFile('test-results/markdown-wysiwyg/performance.json',JSON.stringify(results,null,2));await browser.close()}
