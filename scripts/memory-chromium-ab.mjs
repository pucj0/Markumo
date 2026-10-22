// A/B component measurements with a read-only historical source overlay.
// Vite development modules + Chromium; never label these native Release data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const ref=process.argv.find(v=>v.startsWith('--ref='))?.slice(6)
const label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)
assert(ref&&/^[\w.-]+$/.test(ref)&&/^(before|after)$/.test(label))
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
const root=path.resolve('test-results/phase041'),out=path.join(root,`chromium-${label}`)
fs.mkdirSync(out,{recursive:true})
const changed=git(['diff','--name-only',ref,'--','src']).split('\n').filter(Boolean)
const originals=new Map(changed.map(file=>[path.resolve(file).replaceAll('\\','/'),execFileSync('git',['show',`${ref}:${file}`],{encoding:'utf8',windowsHide:true})]))
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><div id="app" style="display:flex;height:720px"></div><script type="module">
import '/scripts/fixtures/markdown-live-controller.js'
import {CodeBlockView} from '/src/editor/markdown/wysiwyg/CodeBlockView.ts'
const ensure=CodeBlockView.prototype.ensureEditor
window.stats={created:0,live:0,peak:0}
CodeBlockView.prototype.ensureEditor=function(){
 const exists=this.cmInstance,cm=ensure.call(this)
 if(!exists){const p=window.stats;p.created++;p.live++;p.peak=Math.max(p.peak,p.live);const destroy=cm.destroy.bind(cm);cm.destroy=()=>{p.live--;destroy()}}
 return cm
}
window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true})
window.probeReady=true
</script>`)
const server=await createServer({logLevel:'warn',plugins:[{name:'reference-overlay',enforce:'pre',load(id){
 const[file,query]=id.split('?');if(query&&file.endsWith('.vue'))return
 const source=originals.get(file)
 return source!==undefined&&query&&new URLSearchParams(query).has('raw')?`export default ${JSON.stringify(source)}`:source
}}],server:{host:'127.0.0.1',port:1498,strictPort:true,hmr:false,watch:null}})
await server.listen()
let browser
let report={kind:'Chromium component host / Vite development modules',commit:git(['rev-parse',ref]),label,samples:[],errors:[],startedAt:new Date().toISOString(),caveats:['CDP heap peaks are sampled lower bounds. Timing includes browser/host load and is descriptive.','This is not the native WebView2 process or a Release frontend.']}
let startRun=1
if(process.argv.includes('--resume')){
 const previous=JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8'))
 assert.equal(previous.commit,report.commit)
 fs.writeFileSync(path.join(out,`results-attempt-${Date.now()}.json`),JSON.stringify(previous,null,2))
 startRun=Math.floor(previous.samples.length/4)+1
 report={...previous,samples:previous.samples.filter(s=>s.run<startRun),previousFailure:previous.failure,resumedAt:new Date().toISOString()}
 delete report.failure;delete report.passed;delete report.completedAt
}
const persist=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2))
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME,args:['--enable-precise-memory-info']})
 report.browser=browser.version()
 for(let run=startRun;run<=3;run++){
  const page=await browser.newPage({viewport:{width:1280,height:850}})
  page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(`http://127.0.0.1:1498/test-results/phase041/chromium-${label}/index.html`)
  await page.waitForFunction(()=>window.probeReady)
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable')
  const metric=async()=>{
   const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
   return{heap:m.JSHeapUsedSize,dom:await cdp.send('Memory.getDOMCounters'),...await page.evaluate(()=>({cm:{...window.stats},domNodes:document.querySelectorAll('*').length,longTasks:[...window.longTasks]}))}
  }
  for(const count of [10,50,100,200]){
   const source='Ordinary paragraph.\n\n'+('```javascript\nfunction compute(x,y) {\n  const result=x*y+42;\n  return result;\n}\n```\n\n').repeat(count)
   await page.evaluate(()=>{window.f.manager?.dispose();window.stats={created:0,live:0,peak:0};window.longTasks=[]})
   const timeline=[]
   await page.evaluate(({source,count})=>{
    window.started=performance.now();window.firstRenderMs=null;window.f.reset(source,true)
    const frame=()=>{
      if(window.f.ready()&&window.f.live()?.codeViews.size===count)requestAnimationFrame(()=>window.firstRenderMs=performance.now()-window.started)
      else requestAnimationFrame(frame)
    };requestAnimationFrame(frame)
   },{source,count})
   const until=Date.now()+1000
   while(Date.now()<until){timeline.push(await metric());await page.waitForTimeout(25)}
   await page.waitForFunction(()=>window.f.ready())
   await page.waitForFunction(()=>window.firstRenderMs!==null)
   const firstRenderMs=await page.evaluate(()=>window.firstRenderMs)
   await cdp.send('HeapProfiler.collectGarbage');const stable=await metric()
   const firstAllocations=stable.cm.created
   if(count===200){
    const queries=await page.evaluate(async()=>{
     const f=window.f,before=window.stats.created
     for(let i=0;i<1000;i++){void f.manager.isComposing;f.live().toolbarState();f.live().searchController.updateCount()}
     await Promise.resolve();return{created:window.stats.created-before,cm:{...window.stats}}
    })
    if(label==='after')assert.equal(queries.created,0)
    await page.locator('.md-prose > p').first().click();await page.keyboard.press('End')
    await page.evaluate(()=>{let start;window.inputs=[];const dom=window.f.live().view.dom;dom.addEventListener('beforeinput',()=>start=performance.now(),true);dom.addEventListener('input',()=>queueMicrotask(()=>window.inputs.push(performance.now()-start)))})
    await page.keyboard.type('x'.repeat(1000));await page.waitForFunction(()=>window.f.source().includes('x'.repeat(1000)))
    const input=await page.evaluate(()=>window.inputs)
    const history=await page.evaluate(()=>({events:window.f.history().undo,edited:window.f.source()}))
    assert(history.events>0&&history.events<=1000)
    await page.evaluate(events=>{for(let i=0;i<events;i++)window.f.undo()},history.events)
    await page.waitForFunction(source=>window.f.source()===source,source)
    await page.evaluate(events=>{for(let i=0;i<events;i++)window.f.redo()},history.events)
    await page.waitForFunction(edited=>window.f.source()===edited,history.edited)
    stable.inputUndoEvents=history.events
    stable.queries=queries;stable.inputMs=input
   }
   const sample={run,count,firstRenderMs,firstAllocations,peakCM:Math.max(...timeline.map(m=>m.cm.peak)),peakSampledHeap:Math.max(...timeline.map(m=>m.heap)),stable,timeline}
   report.samples.push(sample);persist();console.log(`PASS ${label} run=${run} blocks=${count} allocated=${firstAllocations} peak=${sample.peakCM} stable=${stable.cm.live} heap=${(stable.heap/1048576).toFixed(2)}MiB`)
  }
  await page.close()
 }
 report.passed=report.errors.length===0;report.completedAt=new Date().toISOString();persist();assert.deepEqual(report.errors,[])
}catch(error){report.failure=String(error.stack||error);persist();throw error}
finally{await browser?.close();await server.close()}
