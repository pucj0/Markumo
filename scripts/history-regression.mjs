// Real DocumentManager/FileController and history IPC contract, with controlled
// persistence delays. Native storage and cross-window serialization are tested
// separately through Rust and the real Tauri acceptance driver.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const output='test-results/history-save'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><div id="app" style="height:720px;display:flex"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import '/scripts/fixtures/markdown-live-controller.js';
import {mockIPC} from '@tauri-apps/api/mocks';
import {FileController} from '/src/features/files/FileController.ts';
import * as service from '/src/features/history/historyService.ts';
const H=window.H={service,calls:[],records:[],notes:[],writes:[],disk:'old',sequence:0};
H.defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
mockIPC(async(command,args)=>{
 H.calls.push({command,...args});
 if(command==='history_record'){
  await H.recordGate?.promise;
  if(H.failRecord || H.failSaved && args.origin==='saved')throw Error('history storage unavailable');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(args.text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const existing=H.records.find(record=>record.path===args.path&&record.hash===hash);
  if(existing)return{entry:existing,duplicated:true,warnings:[]};
  const entry={id:'version-'+(++H.sequence),hash,bytes:new TextEncoder().encode(args.text).length,createdAt:Date.now(),origin:args.origin,label:args.label,path:args.path,body:args.text};
  H.records.unshift(entry);return{entry,duplicated:false,warnings:[]};
 }
 if(command==='history_list')return H.records.filter(r=>r.path===args.path).map(({body,path,...entry})=>entry);
 if(command==='history_read'){const row=H.records.find(r=>r.path===args.path&&r.id===args.id);if(!row)throw Error('version not found');return row.body;}
 throw Error('unexpected IPC '+command);
});
H.reset=()=>{
 H.files?.dispose();window.f.reset('old',true);Object.assign(H,{calls:[],records:[],notes:[],writes:[],disk:'old',failRecord:false,failSaved:false,failWrite:false,recordGate:null,saveGate:null,saved:0});
 H.files=new FileController(window.f.manager,{release:async()=>{},save:async(token,text)=>{
  H.writes.push(String(text));await H.saveGate?.promise;if(H.failWrite)throw Error('disk write failed');H.disk=String(text);
  const meta=window.f.manager.metadata(window.f.id);return{...meta,token,path:meta.path,version:'disk-'+(++H.sequence),encoding:'UTF-8',bom:false,eol:'LF',readOnly:false};
 }},message=>H.notes.push(message),()=>{H.saved++});
 window.f.manager.dispatch(window.f.id,{changes:{from:0,to:3,insert:'new'},userEvent:'input.test'});
};
`)
const server=await createServer({server:{host:'127.0.0.1',port:1447,strictPort:true,hmr:false,watch:null}})
await server.listen()
let browser
const results=[]
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
 const page=await browser.newPage()
 await page.goto(`http://127.0.0.1:1447/${output}/index.html`)
 await page.waitForFunction(()=>window.H&&window.f.ready())
 const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
 await test('delayed old-version persistence blocks disk write; concurrent Pane autosave is skipped; in-flight edits survive',async()=>{
  await page.evaluate(()=>{H.reset();window.f.split();H.recordGate=H.defer();H.pending=H.files.saveDetailed(window.f.id)})
  await page.waitForFunction(()=>H.calls.some(c=>c.command==='history_record'))
  assert.deepEqual(await page.evaluate(()=>({writes:H.writes.length,disk:H.disk,dirty:window.f.manager.metadata(window.f.id).dirty})),{writes:0,disk:'old',dirty:true})
  assert.equal(await page.evaluate(()=>H.files.autoSave(window.f.id)),'skipped')
  await page.evaluate(()=>{const f=window.f;f.manager.dispatch(f.id,{changes:{from:3,insert:'-during-archive'}});H.recordGate.resolve()})
  const result=await page.evaluate(async()=>{const saved=await H.pending;return{code:saved.code,disk:H.disk,source:window.f.source(),dirty:window.f.manager.metadata(window.f.id).dirty,records:H.records.map(r=>[r.origin,r.body])}})
  assert.deepEqual(result,{code:'changed',disk:'new',source:'new-during-archive',dirty:true,records:[['saved','new'],['disk','old']]})
 })
 await test('failed archive aborts every write, preserves the buffer and deduplicates repeated autosave errors',async()=>{
  const result=await page.evaluate(async()=>{H.reset();H.failRecord=true;return{a:await H.files.autoSave(window.f.id),b:await H.files.autoSave(window.f.id),writes:H.writes,disk:H.disk,source:window.f.source(),notes:H.notes}})
  assert.equal(result.a,'failed');assert.equal(result.b,'failed');assert.deepEqual(result.writes,[]);assert.equal(result.disk,'old');assert.equal(result.source,'new');assert.equal(result.notes.length,1)
  assert.match(result.notes[0],/历史备份失败/)
 })
 await test('failed disk write cannot invent a saved version or complete crash-recovery cleanup',async()=>{
  const result=await page.evaluate(async()=>{H.reset();H.failWrite=true;const saved=await H.files.saveDetailed(window.f.id);return{code:saved.code,source:window.f.source(),disk:H.disk,dirty:window.f.manager.metadata(window.f.id).dirty,saved:H.saved,records:H.records.map(r=>[r.origin,r.body])}})
  assert.deepEqual(result,{code:'failed',source:'new',disk:'old',dirty:true,saved:0,records:[['disk','old']]})
 })
 await test('new-version history failure is disclosed after a successful disk commit',async()=>{
  const result=await page.evaluate(async()=>{H.reset();H.failSaved=true;const saved=await H.files.saveDetailed(window.f.id);return{code:saved.code,disk:H.disk,notes:H.notes,records:H.records.map(r=>r.body)}})
  assert.equal(result.code,'saved');assert.equal(result.disk,'new');assert.deepEqual(result.records,['old']);assert.match(result.notes.join('\n'),/正文已保存.*未能写入历史/)
 })
 await test('a delayed disk save holds the document guard until history completion; new edits remain dirty',async()=>{
  await page.evaluate(()=>{H.reset();H.saveGate=H.defer();H.pending=H.files.saveDetailed(window.f.id)})
  await page.waitForFunction(()=>H.writes.length===1)
  assert.equal(await page.evaluate(()=>H.files.autoSave(window.f.id)),'skipped')
  const result=await page.evaluate(async()=>{window.f.manager.dispatch(window.f.id,{changes:{from:3,insert:'-during-write'}});H.saveGate.resolve();const saved=await H.pending;return{code:saved.code,source:window.f.source(),disk:H.disk,dirty:window.f.manager.metadata(window.f.id).dirty}})
  assert.deepEqual(result,{code:'changed',source:'new-during-write',disk:'new',dirty:true})
 })
 fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:true,results,browser:await browser.version()},null,2))
 await page.evaluate(()=>{H.files.dispose();window.f.dispose()})
}finally{await browser?.close();await server.close()}
