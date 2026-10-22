// Real Windows Release app + real WebView2, isolated from the user's profile.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

assert.equal(process.platform,'win32')
const label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)
assert(/^(before|after)$/.test(label))
const root=path.resolve('test-results/phase041'), out=path.join(root,`native-${label}`)
fs.mkdirSync(out,{recursive:true})
const build=JSON.parse(fs.readFileSync(path.join(root,`build-${label}.json`),'utf8'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(fs.readFileSync(build.binary)),build.sha256)
assert(fs.readFileSync(build.binary).includes(Buffer.from('com.markumo.phase041-audit')))
const config=JSON.parse(fs.readFileSync(path.join(root,`config-${label}.json`),'utf8'))
assert.equal(config.app.appDirectoriesOverride,path.join(root,'native-profile'))
const profile=config.app.appDirectoriesOverride
fs.mkdirSync(profile,{recursive:true})
const fixture=path.join(root,'fixtures');fs.mkdirSync(fixture,{recursive:true})
const code=count=>'Paragraph.\n\n'+('```javascript\nfunction compute(x, y) {\n  const result = x * y + 42;\n  return result;\n}\n```\n\n').repeat(count)
const fixtures={txt:'plain.txt',live:'live.md','code-10':'code10.md','code-50':'code50.md','code-100':'code100.md','code-200':'code200.md',split:'split.md','multi-pane':'multi.md',pdf:'single.pdf',image:'transparent.png'}
fs.writeFileSync(path.join(fixture,'plain.txt'),'ordinary text line\n'.repeat(1000))
fs.writeFileSync(path.join(fixture,'live.md'),'# Native Live\n\n'+('Paragraph with **bold** text.\n\n').repeat(100))
for(const count of [10,50,100,200]) fs.writeFileSync(path.join(fixture,`code${count}.md`),code(count))
fs.writeFileSync(path.join(fixture,'split.md'),code(100))
fs.writeFileSync(path.join(fixture,'multi.md'),code(100))
for(const name of ['single.pdf','transparent.png']) fs.copyFileSync(path.resolve('.markumo-media-test/fixtures',name),path.join(fixture,name))
let report={kind:'Windows WebView2 native Release',label,build,os:{release:os.release(),version:os.version(),arch:os.arch()},hardware:{cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,totalMemory:os.totalmem()},
  fixtures:Object.fromEntries(Object.values(fixtures).map(name=>[name,sha(fs.readFileSync(path.join(fixture,name)))])),
  startedAt:new Date().toISOString(),viewport:{width:1200,height:780},samples:[],errors:[],
  protocol:'3 independent fresh WebView profiles; same app profile reset; fixed scene order; 3s sampling at 250ms JS / ~500ms native, then forced GC and 3 post-close samples. CDP and allocation probe overhead included.',
  caveats:['Scene order is fixed, caches may persist within a round. OS file cache is uncontrolled.','Sampled heap/private-byte maxima are lower bounds on transient allocation peaks.','Three rounds provide exploratory P95 and spread, not a population confidence interval.']}
let startRun=1
if(process.argv.includes('--resume')){
 const previous=JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8'))
 assert.deepEqual(previous.build,build);assert.deepEqual(previous.fixtures,report.fixtures)
 assert.deepEqual(previous.os,report.os)
 assert(previous.samples.length>0&&previous.samples.length%12===0,'Only fully sampled rounds may be resumed')
 const archived=path.join(out,`results-attempt-${Date.now()}.json`)
 fs.writeFileSync(archived,JSON.stringify(previous,null,2))
 startRun=Math.max(...previous.samples.map(s=>s.run))+1
 report={...previous,previousAttempt:{file:path.basename(archived),failure:previous.failure},resumedAt:new Date().toISOString()}
 delete report.failure;delete report.passed;delete report.completedAt
}
const persist=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2))
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const execAsync=promisify(execFile)
let child,browser
const nativeScript=path.join(root,'sample-process-tree.ps1')
fs.writeFileSync(nativeScript,`param([int]$RootPid,[int]$Samples=1)
$auditIds=[Collections.Generic.HashSet[int]]::new();[void]$auditIds.Add($RootPid)
foreach($auditIndex in 1..$Samples) {
  $auditRows=@(Get-CimInstance Win32_Process)
  do {$auditAdded=$false;foreach($auditRow in $auditRows){if($auditIds.Contains([int]$auditRow.ParentProcessId) -and $auditIds.Add([int]$auditRow.ProcessId)){$auditAdded=$true}}}while($auditAdded)
  $auditNative=Get-Process -Id $RootPid -ErrorAction Stop
  $auditViews=@(Get-Process -Id @($auditIds) -ErrorAction SilentlyContinue|Where-Object ProcessName -eq 'msedgewebview2')
  [pscustomobject]@{time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();rustPrivate=$auditNative.PrivateMemorySize64;rustWorking=$auditNative.WorkingSet64;webviewPrivate=[long](($auditViews|Measure-Object PrivateMemorySize64 -Sum).Sum);webviewWorking=[long](($auditViews|Measure-Object WorkingSet64 -Sum).Sum);processes=$auditViews.Count}|ConvertTo-Json -Compress
  if($auditIndex -lt $Samples){Start-Sleep -Milliseconds 250}
}`)
const native=async(samples=1)=>{
  const script=fs.readFileSync(nativeScript,'utf8').replace(/^param\([^\n]+\)\r?\n/,'')
  const result=await execAsync('powershell.exe',['-NoProfile','-Command',`$RootPid=${child.pid};$Samples=${samples};\n${script}`],{windowsHide:true})
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))
}
try {
  for(let run=startRun;run<=3;run++) {
    fs.writeFileSync(path.join(profile,'editor-settings.json'),JSON.stringify({settingsVersion:6,autoCheckUpdates:false,autoDownloadUpdates:false}))
    fs.writeFileSync(path.join(profile,'files.json'),JSON.stringify({recent:Object.values(fixtures).map(name=>({path:path.toNamespacedPath(path.join(fixture,name)),name})),layout:{mode:'single',sidebarVisible:false,sidebarWidth:240}}))
    fs.writeFileSync(path.join(profile,'last-session.json'),JSON.stringify({schemaVersion:1,kind:'single',roots:[],tabs:[],activePath:null,layout:{mode:'single',sidebarVisible:false,sidebarWidth:240}}))
    const port=9560+(label==='after'?10:0)+run
    const webProfile=path.join(out,`webview-${Date.now()}-${run}`)
    child=spawn(build.binary,[],{windowsHide:true,env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:webProfile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdio:'pipe'})
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk)
    const deadline=Date.now()+45000
    while(true){
      if(child.exitCode!==null) throw Error(`Native app exited: ${stderr}`)
      try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok)break}catch{}
      assert(Date.now()<deadline,'WebView2 endpoint timeout');await wait(100)
    }
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    report.webviewRuntime=browser.version()
    const page=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().startsWith('devtools:'))
    page.on('pageerror',error=>report.errors.push(error.message))
    page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())})
    try { await page.waitForFunction(()=>document.querySelector('.app:not([inert])')&&!document.querySelector('.startup-overlay'),null,{timeout:20000}) }
    catch(error){report.startup={url:page.url(),body:await page.locator('body').innerText()};await page.screenshot({path:path.join(out,'startup-failure.png')});throw error}
    const display=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height}))
    if(report.display)assert.deepEqual(display,report.display);else report.display=display
    // The dedicated build exposes a reference to the actual production manager.
    // No mock manager, test host, dev server or alternate editor is installed.
    await page.evaluate(()=>{
      if(!window.__nativeManager) throw Error('Production manager probe unavailable')
      window.__longTasks=[]
      new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})
    })
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable')
    const metrics=async()=>{
      const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
      return {heap:m.JSHeapUsedSize,dom:await cdp.send('Memory.getDOMCounters'),...await page.evaluate(()=>({cm:document.querySelectorAll('.cm-editor').length,probe:{...window.__memoryProbe},longTasks:window.__longTasks.length}))}
    }
    const closeDocs=async()=>{
      await page.evaluate(()=>{const m=window.__nativeManager;m.closeSplit();for(const doc of [...m.openedDocuments])m.close(doc.id,true)})
      await page.waitForFunction(()=>window.__nativeManager.openedDocuments.length===0&&document.querySelectorAll('.cm-editor,.markdown-live,.pdf-page,.image-stage img').length===0)
    }
    for(const scenario of ['blank',...Object.keys(fixtures),'open-close-50']) {
      await closeDocs()
      await page.evaluate(()=>{window.__memoryProbe={created:0,live:0,peak:0};window.__longTasks=[]})
      const start=Date.now()
      if(scenario==='open-close-50'){
        for(let cycle=0;cycle<50;cycle++){
          await page.evaluate(async file=>{try{const opened=await window.__TAURI_INTERNALS__.invoke('open_recent',{path:file,encoding:null});window.__nativeManager.openFile(opened)}catch(error){throw Error(JSON.stringify(error))}},path.toNamespacedPath(path.join(fixture,'code100.md')))
          await page.waitForFunction(()=>!!document.querySelector('.markdown-live .md-code-block'))
          await wait(50);await closeDocs()
        }
      }else if(scenario!=='blank'){
        await page.evaluate(async file=>{try{const opened=await window.__TAURI_INTERNALS__.invoke('open_recent',{path:file,encoding:null});if(!window.__nativeManager.openFile(opened))throw Error('Open rejected')}catch(error){throw Error(JSON.stringify(error))}},path.toNamespacedPath(path.join(fixture,fixtures[scenario])))
        if(scenario==='split') await page.evaluate(()=>{const m=window.__nativeManager;m.setMarkdownMode(m.activeId,'split')})
        if(scenario==='multi-pane') await page.evaluate(()=>{const m=window.__nativeManager;m.splitPane('right',m.activePane,m.activeId)})
        await page.waitForFunction(s=>s==='pdf'?!!document.querySelector('.pdf-page canvas'):s==='image'?document.querySelector('.image-stage img')?.naturalWidth>0:s==='split'?!!document.querySelector('.split-preview-pane'):s==='txt'?!!document.querySelector('.cm-content'):!!document.querySelector('.markdown-live .md-prose'),scenario)
      }
      if(scenario==='blank')assert.equal(await page.locator('.cm-editor,.markdown-live,.tab .filename').count(),0,'Blank startup must have no document/editor')
      const firstReadyMs=Date.now()-start, first=await metrics(), timeline=[]
      const nativePending=native(6).then(value=>({value}),error=>({error}))
      const until=Date.now()+3000
      while(Date.now()<until){timeline.push(await metrics());await wait(250)}
      const nativeResult=await nativePending
      if(nativeResult.error)throw nativeResult.error
      const nativeSamples=nativeResult.value
      await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage')
      const stable=await metrics(),stableNative=(await native())[0]
      if(run===1) await page.screenshot({path:path.join(out,`${scenario}.png`)})
      await closeDocs();const afterClose=[]
      for(let i=0;i<3;i++){await wait(250);await cdp.send('HeapProfiler.collectGarbage');afterClose.push({js:await metrics(),native:(await native())[0]})}
      const sample={scenario,run,firstReadyMs,first,timeline,nativeSamples,stable,stableNative,afterClose,
        peakSampledHeap:Math.max(first.heap,...timeline.map(s=>s.heap)),peakCM:Math.max(first.probe.peak||0,...timeline.map(s=>s.probe.peak||0)),
        peakSampledWebviewPrivate:Math.max(...nativeSamples.map(s=>s.webviewPrivate))}
      report.samples.push(sample);persist()
      console.log(`PASS ${label} run=${run} ${scenario} CM peak=${sample.peakCM} stable=${stable.cm} heap=${(stable.heap/1048576).toFixed(2)}MiB WV=${(stableNative.webviewPrivate/1048576).toFixed(2)}MiB`)
    }
    // Register before clicking: native close can finish before click resolves.
    const exited=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native close timed out')),15000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
    await exited
    await browser.close().catch(()=>{});browser=undefined;child=undefined
  }
  report.completedAt=new Date().toISOString();report.passed=report.errors.length===0;persist();assert.deepEqual(report.errors,[])
}catch(error){report.failure=String(error.stack||error);persist();throw error}
finally{if(child?.exitCode===null)child.kill();await browser?.close().catch(()=>{})}
