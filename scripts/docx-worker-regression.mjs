import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const output='test-results/docx-worker'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {ExportController} from '/src/features/document-conversion/ExportController.ts';
import {mockIPC} from '@tauri-apps/api/mocks';
const H=window.H={outputs:[],notes:[],releases:[],activeWorkers:0,createdWorkers:0,frameTimes:[],heartbeats:0};
window.isTauri=true;
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(...args){super(...args);H.activeWorkers++;H.createdWorkers++;this.alive=true}terminate(){if(this.alive){this.alive=false;H.activeWorkers--}return super.terminate()}};
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
mockIPC(async(command,args)=>{
 if(command==='export_save_dialog')return{path:'worker.docx',token:'export-token'};
 if(command==='read_markdown_image'){if(args.relative.includes('missing'))throw Error('image missing');if(H.imageGate)await H.imageGate;return png.slice().buffer;}
 if(command==='save_docx_bytes'){if(!(args instanceof Uint8Array))throw Error('DOCX must use raw IPC bytes');H.outputs.push({bytes:Array.from(args),format:'docx'});return;}
 if(command==='release_conversion_lease'){H.releases.push(args.token);return;}
 throw Error('unexpected IPC '+command);
});
H.manager=new DocumentManager([],async()=>[]);
H.id=H.manager.openFile({token:'doc-token',path:'C:/word.md',name:'word.md',text:'initial',version:'v1',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false});
H.controller=new ExportController(H.manager,message=>H.notes.push(message));
H.export=text=>{H.manager.dispatch(H.id,{changes:{from:0,to:H.manager.getText(H.id).length,insert:text}});return H.controller.exportDocument('docx')};
H.dispose=()=>{H.controller.dispose();H.manager.dispose()};
`)
const server=await createServer({server:{host:'127.0.0.1',port:1471,strictPort:true,hmr:false,watch:null}})
await server.listen()
let browser
const results=[]
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
 const page=await browser.newPage()
 const requests=[];page.on('request',request=>requests.push(request.url()))
 await page.goto(`http://127.0.0.1:1471/${output}/index.html`)
 await page.waitForFunction(()=>window.H?.controller)
 assert.equal(requests.some(url=>/nativeDocxExport|nativeDocxWorker|docxWorkerClient/.test(url)),false,'Word generation modules must not load on ordinary application startup')
 const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
 const markdown='# Word title\n\nBefore inline ![inline](one.png) after inline.\n\n![block](two.png)\n\n| Image | Text |\n| --- | --- |\n| ![cell](three.png) | Table body |\n\n3. Ordered parent\n   - Nested child\n\n     Continuation paragraph\n\n4. Ordered second\n\n- ```js\n  fence-first-item\n  ```\n\n![failed alt](missing.png)\n\n脚注[^n]\n\n[^n]: Footnote fallback\n\n```mermaid\ngraph TD; A-->B;\n```\n\n<div>HTML body must remain</div>'
 await test('lazy real Worker embeds multiple, inline and table images, preserves nested-list/code/HTML text and releases resources',async()=>{
  const result=await page.evaluate(async markdown=>{await H.export(markdown);return{outputs:H.outputs.length,bytes:H.outputs[0].bytes,notes:H.notes,active:H.activeWorkers,created:H.createdWorkers,releases:H.releases}},markdown)
  assert.equal(result.outputs,1);assert.equal(result.active,0);assert.equal(result.created,1);assert.deepEqual(result.releases,['export-token'])
  assert.match(result.notes.join('\n'),/图片未能嵌入/);assert.match(result.notes.join('\n'),/脚注以文末列表/);assert.match(result.notes.join('\n'),/Mermaid.*源码/)
  fs.writeFileSync(`${output}/complex.docx`,new Uint8Array(result.bytes))
  const decoded=new TextDecoder().decode(new Uint8Array(result.bytes))
  assert.equal((decoded.match(/<w:drawing>/g)||[]).length,3)
  for(const text of ['Before inline','after inline.','Table body','Ordered parent','Nested child','Continuation paragraph','Ordered second','fence-first-item','HTML body must remain','Footnote fallback'])assert(decoded.includes(text),'Missing body: '+text)
  assert(decoded.includes('<w:start w:val="3"/>'))
 })
 await test('cancelling during CPU-bound generation terminates the Worker without writing any output',async()=>{
  const result=await page.evaluate(async()=>{
   const count=H.outputs.length,released=H.releases.length;
   const text=('# Heading\n\nText with **bold**, lists and XML <>&.\n\n- item\n- second\n\n').repeat(35000);
   const started=performance.now(),pending=H.export(text);
   while(H.activeWorkers===0)await new Promise(resolve=>setTimeout(resolve,0));
   await new Promise(resolve=>setTimeout(resolve,40));
   const cancelled=H.controller.cancelExport();await pending;
   return{cancelled,outputs:H.outputs.length-count,releases:H.releases.length-released,active:H.activeWorkers,ms:performance.now()-started,notes:H.notes};
  })
  assert.equal(result.cancelled,true);assert.equal(result.outputs,0);assert.equal(result.releases,1);assert.equal(result.active,0);assert(result.ms<3000,'Cancellation must not wait for parsing/ZIP completion');assert.match(result.notes.join('\n'),/已取消.*未写入输出文件/)
 })
 await test('cancelling a delayed image read abandons its late response and produces no formal output',async()=>{
  await page.evaluate(()=>{let resolve;H.imageGate=new Promise(r=>resolve=r);H.releaseImage=resolve;H.previousOutputs=H.outputs.length;H.pending=H.export('![pending](pending.png)')})
  await page.waitForFunction(()=>H.activeWorkers===1)
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(()=>H.controller.cancelExport()),true)
  await page.evaluate(async()=>{await H.pending;H.releaseImage();H.imageGate=null})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(()=>H.outputs.length-H.previousOutputs),0);assert.equal(await page.evaluate(()=>H.activeWorkers),0)
 })
 await test('large generation keeps the main UI heartbeat alive and repeated exports retain no Worker',async()=>{
  const result=await page.evaluate(async()=>{
   const text=('# Title\n\nA paragraph with **marked words** and text.\n\n- first\n- second\n\n').repeat(10000);
   const start=performance.now();let beats=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++},10);
   const {generateDocx}=await import('/src/features/document-conversion/docxWorkerClient.ts');
   const result=await generateDocx(text);clearInterval(timer);
   return{beats,maxGap,ms:performance.now()-start,bytes:result.bytes.length,active:H.activeWorkers};
  })
  assert(result.beats>=3,'Worker generation must leave time for actual main-thread UI events');assert(result.maxGap<500,'Main UI heartbeat stalled: '+JSON.stringify(result));assert.equal(result.active,0)
  fs.writeFileSync(`${output}/performance.json`,JSON.stringify(result,null,2))
 })
 fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:true,results,browser:await browser.version()},null,2))
 await page.evaluate(()=>H.dispose())
}finally{await browser?.close();await server.close()}
