import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const root=path.resolve('test-results/phase041'),delivery=path.resolve('docs/performance/phase041-evidence')
fs.mkdirSync(delivery,{recursive:true})
const load=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const stats=values=>{
 const sorted=[...values].sort((a,b)=>a-b),n=values.length,mean=values.reduce((a,b)=>a+b,0)/n
 return{n,median:n%2?sorted[n>>1]:(sorted[n/2-1]+sorted[n/2])/2,p95:sorted[Math.ceil(n*.95)-1],min:sorted[0],max:sorted.at(-1),stddev:Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/n),values}
}
const result={generatedAt:new Date().toISOString(),method:'Median, nearest-rank P95 and population SD of three exploratory runs; raw inputs archived alongside this summary.',provenance:[],native:{},chromium:{}}
const nativeBefore=load('native-before/results.json'),nativeAfter=load('native-after/results.json'),environment=load('environment-before.json')
for(const key of ['os','webviewRuntime','fixtures'])assert.deepEqual(nativeBefore[key],nativeAfter[key],`Native A/B ${key} must match`)
assert.deepEqual(environment.display,nativeAfter.display)
assert.equal(nativeBefore.build.rustTree,nativeAfter.build.rustTree)
result.environment={...environment,afterDisplay:nativeAfter.display,afterHardware:nativeAfter.hardware}
for(const kind of ['native','chromium']){
 for(const label of ['before','after']){
  const relative=`${kind}-${label}/results.json`,raw=fs.readFileSync(path.join(root,relative)),report=JSON.parse(raw)
  assert.equal(report.passed,true,`${relative} must have completed without errors`)
  assert.deepEqual(report.errors,[])
  fs.writeFileSync(path.join(delivery,`${kind}-${label}.json.gz`),gzipSync(raw))
  result.provenance.push({kind,label,commit:report.build?.commit??report.commit,binarySha256:report.build?.sha256,rawSha256:sha(raw),rawArchive:`phase041-evidence/${kind}-${label}.json.gz`,startedAt:report.startedAt,completedAt:report.completedAt})
  const keys=[...new Set(report.samples.map(s=>kind==='native'?s.scenario:String(s.count)))]
  result[kind][label]={}
  for(const key of keys){
   const samples=report.samples.filter(s=>(kind==='native'?s.scenario:String(s.count))===key)
   assert.equal(samples.length,3,`${relative}/${key} needs three runs`)
   const fields=kind==='native'?{
    firstCreated:s=>s.first.probe.created??0,peakCM:s=>s.peakCM,stableCM:s=>s.stable.cm,firstHeap:s=>s.first.heap,
    sampledPeakHeap:s=>s.peakSampledHeap,stableHeap:s=>s.stable.heap,domNodes:s=>s.stable.dom.nodes,
    rustPrivate:s=>s.stableNative.rustPrivate,rustWorking:s=>s.stableNative.rustWorking,
    webviewPrivate:s=>s.stableNative.webviewPrivate,webviewWorking:s=>s.stableNative.webviewWorking,
    sampledPeakPrivate:s=>s.peakSampledWebviewPrivate,sceneReadyMs:s=>s.firstReadyMs,
    afterCloseHeap:s=>s.afterClose.at(-1).js.heap,afterClosePrivate:s=>s.afterClose.at(-1).native.webviewPrivate,
    longTasks:s=>s.stable.longTasks,
   }:{
    firstCreated:s=>s.firstAllocations,peakCM:s=>s.peakCM,stableCM:s=>s.stable.cm.live,sampledPeakHeap:s=>s.peakSampledHeap,
    stableHeap:s=>s.stable.heap,domNodes:s=>s.stable.dom.nodes,firstRenderMs:s=>s.firstRenderMs,longTasks:s=>s.stable.longTasks.length,
   }
   result[kind][label][key]=Object.fromEntries(Object.entries(fields).map(([name,get])=>[name,stats(samples.map(get))]))
   if(kind==='chromium'&&key==='200'){
    result[kind][label][key].queryAllocations=stats(samples.map(s=>s.stable.queries.created))
    result[kind][label][key].inputProcessingMs=stats(samples.flatMap(s=>s.stable.inputMs))
   }
  }
 }
}
fs.writeFileSync(path.resolve('docs/performance/phase041-results.json'),JSON.stringify(result,null,2)+'\n')
const mib=value=>(value/1048576).toFixed(2),med=(kind,label,key,field)=>result[kind][label][key][field].median
const line=(key)=>{
 const a=result.native.before[key],b=result.native.after[key]
 return `| ${key} | ${a.peakCM.median} → ${b.peakCM.median} | ${mib(a.stableHeap.median)} → ${mib(b.stableHeap.median)} | ${mib(a.webviewPrivate.median)} → ${mib(b.webviewPrivate.median)} | ${mib(a.webviewPrivate.p95)} → ${mib(b.webviewPrivate.p95)} | ${mib(a.webviewPrivate.stddev)} → ${mib(b.webviewPrivate.stddev)} |`
}
const table=['| 场景 | 嵌入 CM 峰值 | GC 后 JS Heap MiB | WebView2 Private MiB 中位数 | Private P95 MiB | Private SD MiB |','|---|---:|---:|---:|---:|---:|',...Object.keys(result.native.before).map(line)].join('\n')
const browserTable=['| 代码块 | 初始累计创建 | 初始化峰值 CM | 稳定 CM | 采样 Heap 峰值 MiB | GC 后 Heap MiB | DOM Nodes | 首帧 ms |','|---|---:|---:|---:|---:|---:|---:|---:|',...[10,50,100,200].map(n=>{
 const a=result.chromium.before[n],b=result.chromium.after[n]
 return `| ${n} | ${a.firstCreated.median} → ${b.firstCreated.median} | ${a.peakCM.median} → ${b.peakCM.median} | ${a.stableCM.median} → ${b.stableCM.median} | ${mib(a.sampledPeakHeap.median)} → ${mib(b.sampledPeakHeap.median)} | ${mib(a.stableHeap.median)} → ${mib(b.stableHeap.median)} | ${a.domNodes.median} → ${b.domNodes.median} | ${a.firstRenderMs.median.toFixed(1)} → ${b.firstRenderMs.median.toFixed(1)} |`
})].join('\n')
fs.writeFileSync(path.join(root,'tables.md'),table+'\n\n'+browserTable+'\n')
const logFiles={
 typecheck:'test-results/phase041-typecheck-delivery.log',build:'test-results/phase041-build-delivery.log',
 smoke:'test-results/phase041-smoke-accepted.log',regression:'test-results/phase041-regression-accepted.log',
 rust:'test-results/phase041-cargo-test-retry.log',soak:'test-results/phase041-edit-soak.log',
}
const manifest={source:'0ff6ebc',tests:{},artifacts:[]}
for(const [name,file] of Object.entries(logFiles)){
 const raw=fs.readFileSync(file),text=raw.toString()
 if(name==='smoke')assert(text.includes('Total: 32 | Passed: 32 | Failed: 0 | Skipped: 0'))
 if(name==='regression')assert(text.includes('Total: 43 | Passed: 43 | Failed: 0 | Skipped: 0'))
 if(name==='rust')assert(text.includes('159 passed; 0 failed; 1 ignored'))
 if(name==='soak')assert(text.includes('PASS 120s continuous edit'))
 if(name==='typecheck')assert(!/error TS|ELIFECYCLE/.test(text))
 if(name==='build')assert(text.includes('built in'))
 fs.writeFileSync(path.join(delivery,`${name}.log.gz`),gzipSync(raw))
 manifest.tests[name]={rawSha256:sha(raw),archive:`${name}.log.gz`}
}
for(const name of ['wide-static','wide','narrow-static','narrow','multi-pane','typewriter','dark']){
 const raw=fs.readFileSync(`test-results/code-block-virtualization/${name}.png`)
 fs.writeFileSync(path.join(delivery,`${name}.png`),raw)
 manifest.artifacts.push({file:`${name}.png`,sha256:sha(raw)})
}
for(const [name,file] of Object.entries({virtualization:'test-results/code-block-virtualization/state-queries.json',soak:'test-results/code-block-edit-soak/results.json',media:'.markumo-media-test/browser-metrics.json'})){
 const raw=fs.readFileSync(file)
 fs.writeFileSync(path.join(delivery,`${name}.json.gz`),gzipSync(raw))
 manifest.artifacts.push({file:`${name}.json.gz`,rawSha256:sha(raw)})
}
fs.writeFileSync(path.join(delivery,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const acceptance='docs/performance/phase041-acceptance.md'
let markdown=fs.readFileSync(acceptance,'utf8')
markdown=markdown.replace(/<!-- BEGIN NATIVE TABLE -->[\s\S]*?<!-- END NATIVE TABLE -->/,`<!-- BEGIN NATIVE TABLE -->\n${table}\n<!-- END NATIVE TABLE -->`)
markdown=markdown.replace(/<!-- BEGIN COMPONENT TABLE -->[\s\S]*?<!-- END COMPONENT TABLE -->/,`<!-- BEGIN COMPONENT TABLE -->\n${browserTable}\n<!-- END COMPONENT TABLE -->`)
markdown=markdown.replace(/<!-- BEGIN TEST STATUS -->[\s\S]*?<!-- END TEST STATUS -->/,`<!-- BEGIN TEST STATUS -->
| 命令/专项 | 实际结果 |
|---|---|
| pnpm typecheck | 通过；工作区额外 Callout 的两处 DOM Node 类型引用已纠正，未提交其功能改动 |
| pnpm build | 通过；Vite 仅有已有分包/动态导入提示 |
| pnpm test:smoke | 32/32，0 failed，0 skipped，源码快照 0ff6ebc |
| pnpm test:regression | 43/43，0 failed，0 skipped，源码快照 0ff6ebc |
| cargo test --locked --manifest-path src-tauri/Cargo.toml | 159 通过、0 失败、1 个原有 ignored；系统 Temp 拒绝访问后改用仓库隔离 TEMP/TMP 重跑通过；Rust tree 未改变 |
| 连续编辑 | 120 秒、559 次浏览器插入、9503 字符、完整 Undo/Redo、CM 分配不增长、监听不增长、全部资源销毁 |
| Windows 原生 Release | 前后各三轮、12 个场景/版本，每版本 36 场景记录，无页面错误 |
| Chromium 组件 A/B | 前后各三轮、10/50/100/200 块，另有 3000 次输入/版本，无页面错误 |
<!-- END TEST STATUS -->`)
fs.writeFileSync(acceptance,markdown)
console.log(table+'\n\n'+browserTable)
for(const label of ['before','after'])console.log(label,'input processing ms',result.chromium[label]['200'].inputProcessingMs,'query allocations',result.chromium[label]['200'].queryAllocations)
