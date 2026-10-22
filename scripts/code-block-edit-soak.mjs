// Finite continuous-edit probe; Chromium component host, not native memory.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const output='test-results/code-block-edit-soak'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><meta charset="utf-8"><div id="app" style="display:flex;height:720px"></div><script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>')
const seconds=Number(process.argv.find(v=>v.startsWith('--seconds='))?.slice(10)??120)
assert(seconds>=30&&seconds<=600)
const server=await createServer({server:{host:'127.0.0.1',port:1499,strictPort:true,hmr:false,watch:null}});await server.listen()
let browser
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
 const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:1499/${output}/index.html`);await page.waitForFunction(()=>window.f)
 await page.evaluate(async()=>{
  const {CodeBlockView}=await import('/src/editor/markdown/wysiwyg/CodeBlockView.ts'),ensure=CodeBlockView.prototype.ensureEditor
  window.created=0
  CodeBlockView.prototype.ensureEditor=function(){const existing=this.existingEditor,cm=ensure.call(this);if(!existing)window.created++;return cm}
 })
 const source='Continuous edit.\n\n'+'```js\nconst value = 1;\nsecond line\n```\n\n'.repeat(200)
 await page.evaluate(source=>window.f.reset(source,true),source);await page.waitForFunction(()=>window.f.ready());await page.waitForTimeout(500)
 await page.locator('.md-prose > p').first().click();await page.keyboard.press('End')
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable')
 const sample=async()=>{
  await cdp.send('HeapProfiler.collectGarbage')
  const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
  return{time:Date.now(),heap:m.JSHeapUsedSize,...await page.evaluate(()=>({...window.f.snapshot(),created:window.created,focus:document.activeElement===window.f.live().view.dom}))}
 }
 const initial=await sample(),samples=[initial],fragment=' continuous input',start=Date.now()
 let count=0
 while(Date.now()-start<seconds*1000){
  await page.keyboard.insertText(fragment);count++
  if(count%20===0){const next=await sample();samples.push(next);assert.equal(next.created,initial.created,'Continuous prose editing must not allocate code editors');assert(next.focus);assert(next.globalListeners<=initial.globalListeners)}
  await page.waitForTimeout(200)
 }
 const expected=source.replace('Continuous edit.','Continuous edit.'+fragment.repeat(count))
 assert.equal(await page.evaluate(()=>window.f.source()),expected)
 const events=await page.evaluate(()=>window.f.history().undo)
 await page.evaluate(n=>{for(let i=0;i<n;i++)window.f.undo()},events)
 await page.waitForFunction(source=>window.f.source()===source,source)
 await page.evaluate(n=>{for(let i=0;i<n;i++)window.f.redo()},events)
 await page.waitForFunction(expected=>window.f.source()===expected,expected)
 const disposed=await page.evaluate(()=>window.f.dispose());assert.equal(disposed.remaining,0);assert(disposed.cmDestroyed&&disposed.pmDestroyed)
 assert.deepEqual(errors,[])
 const result={kind:'Chromium component host / finite continuous edit',seconds,edits:count,characters:count*fragment.length,undoEvents:events,initial,samples,disposed,errors,passed:true}
 fs.writeFileSync(`${output}/results.json`,JSON.stringify(result,null,2));console.log(`PASS ${seconds}s continuous edit / ${count} browser insertions / ${events} canonical undo groups / exact undo-redo / resources disposed`)
}finally{await browser?.close();await server.close()}
