import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const output='test-results/history-dialog'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><div id="editor" style="height:200px"></div><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,h,reactive,ref,markRaw,nextTick} from 'vue';
import {mockIPC} from '@tauri-apps/api/mocks';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import HistoryDialog from '/src/components/layout/HistoryDialog.vue';
import '/src/styles/variables.css';
const H=window.H={store:new Map(),gates:new Map(),fail:new Set(),calls:[],restored:0};
H.defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
H.sha=async body=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(b=>b.toString(16).padStart(2,'0')).join('');
mockIPC(async(command,args)=>{
 H.calls.push({command,...args});
 const rows=H.store.get(args.path)||[];
 if(command==='history_list')return rows.map(({body,...entry})=>entry);
 if(command==='history_read'){
  const row=rows.find(row=>row.id===args.id),body=row?.body;
  await H.gates.get(args.path+':'+args.id)?.promise;
  if(!row||H.fail.has(args.id))throw Error('read failed');return body;
 }
 if(command==='history_delete'){const index=rows.findIndex(row=>row.id===args.id);if(index<0)return false;rows.splice(index,1);return true;}
 if(command==='history_clear'){H.store.set(args.path,[]);return;}
 if(command==='history_record'){await H.recordGate?.promise;return{entry:{id:'protection',hash:await H.sha(args.text)},duplicated:false,warnings:[]};}
 throw Error('unexpected '+command);
});
let app;
H.setup=async(gateIds=[])=>{
 app?.unmount();H.manager?.dispose();H.store.clear();H.gates.clear();H.fail.clear();H.calls=[];H.restored=0;H.recordGate=null;
 for(const [path,entries] of [['C:/a.md',[['A','body A'],['B','body B']]],['C:/b.md',[['A','other file A']]]]){
  H.store.set(path,await Promise.all(entries.map(async([id,body])=>({id,label:id,body,hash:await H.sha(body),bytes:new TextEncoder().encode(body).length,createdAt:Date.now(),origin:'saved'}))));
 }
 for(const id of gateIds)H.gates.set(id,H.defer());
 H.manager=markRaw(new DocumentManager([],async()=>[]));
 const open=path=>H.manager.openFile({token:path,path,name:path.split('/').pop(),text:'CURRENT',version:'v1',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false});
 H.a=open('C:/a.md');H.b=open('C:/b.md');H.manager.select(H.a);H.manager.setMarkdownMode(H.a,'source','main');H.manager.mountPane(document.querySelector('#editor'),'main');
 H.props=reactive({open:true,filePath:'C:/a.md',documentId:H.a});const revision=ref(0);H.manager.subscribe(()=>revision.value++);
 app=createApp({setup:()=>()=>{revision.value;return h(HistoryDialog,{...H.props,manager:H.manager,currentContent:H.manager.getText(H.props.documentId),onClose:()=>H.props.open=false,onRestored:()=>H.restored++})}});app.mount('#app');await nextTick();
};
H.release=key=>{H.gates.get(key)?.resolve();H.gates.delete(key)};
H.switchFile=()=>{H.props.filePath='C:/b.md';H.props.documentId=H.b};
H.dispose=()=>{app?.unmount();H.manager.dispose()};
window.historyFixtureReady=true;
`)
const server=await createServer({server:{host:'127.0.0.1',port:1469,strictPort:true,hmr:false,watch:null}})
await server.listen()
let browser
const results=[]
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
 const page=await browser.newPage()
 page.on('dialog',dialog=>dialog.accept())
 await page.goto(`http://127.0.0.1:1469/${output}/index.html`)
 await page.waitForFunction(()=>window.historyFixtureReady)
 const setup=async gates=>{await page.evaluate(gates=>H.setup(gates),gates);await page.locator('.history-item').first().waitFor()}
 const preview=()=>page.locator('.history-preview-pre code')
 const select=id=>page.locator('.history-item').filter({has:page.locator('.history-item-label',{hasText:new RegExp('^'+id+'$')})}).click()
 const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
 await page.evaluate(()=>{window.confirm=()=>{throw Error('History must use its in-app asynchronous confirmation')}})
 await test('restore requires an explicit answer and cancelling creates no protection point or edit',async()=>{
  await setup([]);await preview().waitFor();await page.locator('.history-action-btn.restore').click()
  await page.getByRole('dialog',{name:'历史版本操作确认'}).waitFor()
  assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'CURRENT')
  assert.equal(await page.evaluate(()=>H.calls.some(c=>c.command==='history_record')),false)
  await page.getByRole('button',{name:'取消',exact:true}).click()
  assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'CURRENT');assert.equal(await page.evaluate(()=>H.restored),0)
 })
 await test('switching files or closing while confirmation waits abandons the original restore',async()=>{
  await setup([]);await preview().waitFor();await page.locator('.history-action-btn.restore').click()
  await page.evaluate(()=>H.switchFile());await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='other file A')
  assert.equal(await page.getByRole('button',{name:'确认恢复',exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'CURRENT')
  await page.locator('.history-action-btn.restore').click();await page.evaluate(()=>H.props.open=false)
  await settled();assert.equal(await page.getByRole('dialog',{name:'历史版本操作确认'}).count(),0)
  assert.equal(await page.evaluate(()=>H.calls.some(c=>c.command==='history_record')),false)
 })
 await test('clear history also requires confirmation and never clears a newly switched file',async()=>{
  await setup([]);await preview().waitFor();await page.locator('.history-clean-btn').click();await page.getByRole('button',{name:'取消',exact:true}).click()
  assert.equal(await page.locator('.history-item').count(),2)
  await page.locator('.history-clean-btn').click();await page.evaluate(()=>H.switchFile());await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='other file A')
  assert.equal(await page.evaluate(()=>H.calls.some(c=>c.command==='history_clear')),false)
  await page.locator('.history-clean-btn').click();await page.getByRole('button',{name:'确认清空',exact:true}).click()
  await page.waitForFunction(()=>H.store.get('C:/b.md').length===0);assert.equal(await page.evaluate(()=>H.store.get('C:/a.md').length),2)
 })
 await test('slow A then fast B cannot replace B with the late A body; restore and single undo target B',async()=>{
  await setup(['C:/a.md:A']);await select('B');await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='body B')
  await page.evaluate(()=>H.release('C:/a.md:A'));await settled();assert.equal(await preview().innerText(),'body B')
  await page.locator('.history-action-btn.restore').click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();await page.waitForFunction(()=>H.restored===1)
  assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'body B')
  await page.evaluate(()=>{H.manager.focusPane('main',false);H.manager.command('undo')})
  assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'CURRENT')
 })
 await test('fast A then slow B clears A immediately and prohibits restoring while B loads',async()=>{
  await setup(['C:/a.md:B']);await preview().waitFor();await select('B')
  await page.getByText('正在加载版本内容…').waitFor();assert.equal(await page.locator('.history-action-btn.restore').count(),0)
  await page.evaluate(()=>H.release('C:/a.md:B'));await preview().waitFor();assert.equal(await preview().innerText(),'body B')
 })
 await test('switching files with the same version ID discards the old file request',async()=>{
  await setup(['C:/a.md:A']);await page.evaluate(()=>H.switchFile())
  await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='other file A')
  await page.evaluate(()=>H.release('C:/a.md:A'));await settled();assert.equal(await preview().innerText(),'other file A')
 })
 await test('deleting a version being loaded invalidates the delayed response',async()=>{
  await setup(['C:/a.md:B']);await preview().waitFor();await select('B');await page.locator('.history-action-btn.delete').click()
  await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='body A')
  await page.evaluate(()=>H.release('C:/a.md:B'));await settled();assert.equal(await preview().innerText(),'body A');assert.equal(await page.locator('.history-item').count(),1)
 })
 await test('failed reads clear previous content and content hashes are checked',async()=>{
  await setup([]);await preview().waitFor();await page.evaluate(()=>H.fail.add('B'));await select('B')
  await page.getByRole('alert').waitFor();assert.equal(await preview().count(),0);assert.equal(await page.locator('.history-action-btn.restore').count(),0)
  await page.evaluate(()=>{H.fail.clear();H.store.get('C:/a.md')[1].body='tampered body'})
  await select('B');await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('哈希'))
  assert.equal(await page.locator('.history-action-btn.restore').count(),0)
 })
 await test('closing the panel abandons pending requests',async()=>{
  await setup(['C:/a.md:A']);await page.locator('.history-close-btn').click();await page.evaluate(()=>H.release('C:/a.md:A'));await settled()
  assert.equal(await page.locator('.history-dialog').count(),0);assert.equal(await page.evaluate(()=>H.restored),0)
 })
 await test('editing during restore protection cancels restore and keeps the new document contents',async()=>{
  await setup([]);await preview().waitFor();await select('B');await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='body B')
  await page.evaluate(()=>H.recordGate=H.defer());await page.locator('.history-action-btn.restore').click();await page.getByRole('button',{name:'确认恢复',exact:true}).click()
  await page.waitForFunction(()=>H.calls.some(call=>call.command==='history_record'))
  await page.evaluate(()=>{H.manager.dispatch(H.a,{changes:{from:0,to:7,insert:'EDITED DURING RESTORE'},userEvent:'input.test'});H.recordGate.resolve()})
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('发生变化'))
  assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'EDITED DURING RESTORE');assert.equal(await page.evaluate(()=>H.restored),0)
 })
 await test('a version deleted or changed while restore is pending cannot be restored',async()=>{
  await setup([]);await preview().waitFor();await select('B');await page.waitForFunction(()=>document.querySelector('.history-preview-pre')?.textContent==='body B')
  await page.evaluate(()=>H.recordGate=H.defer());await page.locator('.history-action-btn.restore').click();await page.getByRole('button',{name:'确认恢复',exact:true}).click()
  await page.waitForFunction(()=>H.calls.some(call=>call.command==='history_record'))
  await page.evaluate(()=>{H.store.get('C:/a.md').splice(1,1);H.recordGate.resolve()})
  await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>H.manager.getText(H.a)),'CURRENT');assert.equal(await page.evaluate(()=>H.restored),0)
 })
 fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:true,results,browser:await browser.version()},null,2))
 await page.evaluate(()=>H.dispose())
}finally{await browser?.close();await server.close()}
