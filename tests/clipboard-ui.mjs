import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const output='test-results/clipboard';await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
let results
try{
 await page.goto(process.env.LIGHTEDIT_TEST_URL||'http://localhost:1422');await page.locator('.cm-content').waitFor()
 results=await page.evaluate(async()=>{
  const {editorClipboard,inputClipboard}=await import('/src/editor/commands/clipboard.ts')
  const {EditorSelection,EditorState}=await import('/node_modules/.vite/deps/@codemirror_state.js')
  const {EditorView}=await import('/node_modules/.vite/deps/@codemirror_view.js')
  const m=document.querySelector('#app').__vue_app__._instance.setupState.manager,view=m.activeEditorView,results=[]
  const assert=(condition,message)=>{if(!condition)throw Error(message)}
  const source=text=>{m.dispatch(m.activeId,{changes:{from:0,to:view.state.doc.length,insert:text},selection:{anchor:0,head:Math.min(3,text.length)}});view.focus()}
  const text=()=>view.state.doc.toString()
  const rejected=async(job)=>{try{await job}catch{return true}return false}
  let clip=''
  const clipboard={writeText:async text=>{clip=text},readText:async()=>clip}
  source('one two three');m.dispatch(m.activeId,{selection:EditorSelection.create([EditorSelection.range(0,3),EditorSelection.range(8,13)])})
  await editorClipboard(view,'copy',clipboard);assert(clip==='one\nthree','multi-selection copy')
  await editorClipboard(view,'cut',clipboard);assert(text()===' two ','multi-selection cut');m.command('undo');assert(text()==='one two three','cut undo')
  results.push('multi-selection copy/cut and undo')
  source('中文 emoji 😀');clip='替换😀';await editorClipboard(view,'paste',clipboard);assert(text()==='替换😀emoji 😀','unicode paste selection');m.command('undo');assert(text()==='中文 emoji 😀','paste undo')
  results.push('Unicode/emoji paste and undo')
  source('safe source');const failing={readText:async()=>{throw Error('denied')},writeText:async()=>{throw Error('denied')}}
  assert(await rejected(editorClipboard(view,'cut',failing)),'cut permission rejection');assert(await rejected(editorClipboard(view,'paste',failing)),'paste permission rejection');assert(text()==='safe source','permissions preserve text')
  results.push('permission failure preserves source')
  let resolveRead;const delayed={...clipboard,readText:()=>new Promise(resolve=>{resolveRead=resolve})}
  const job=editorClipboard(view,'paste',delayed);m.dispatch(m.activeId,{changes:{from:view.state.doc.length,insert:' changed'}});resolveRead('danger');assert(await rejected(job),'stale document rejection');assert(text()==='safe source changed','stale source preserved')
  source('focus safe');const job2=editorClipboard(view,'paste',delayed);document.querySelector('.quickbtn').focus();resolveRead('danger');assert(await rejected(job2),'focus change rejection');assert(text()==='focus safe','focus source preserved')
  source('selection safe');const job3=editorClipboard(view,'paste',delayed);m.dispatch(m.activeId,{selection:{anchor:4}});resolveRead('danger');assert(await rejected(job3),'selection change rejection');assert(text()==='selection safe','selection source preserved')
  results.push('asynchronous document/selection/focus changes cancel mutation')
  const host=document.createElement('div');document.body.append(host);const readonly=new EditorView({parent:host,state:EditorState.create({doc:'readonly byte view',extensions:[EditorState.readOnly.of(true)]})});readonly.focus();readonly.dispatch({selection:{anchor:0,head:8}})
  await editorClipboard(readonly,'copy',clipboard);assert(clip==='readonly','readonly copy');assert(await rejected(editorClipboard(readonly,'cut',clipboard)),'readonly cut rejection');assert(await rejected(editorClipboard(readonly,'paste',clipboard)),'readonly paste rejection');assert(readonly.state.doc.toString()==='readonly byte view','readonly source');readonly.destroy();host.remove()
  results.push('readonly viewer allows copy and rejects cut/paste')
  const input=document.createElement('textarea');document.body.append(input);input.value='输入 hello';input.focus();input.setSelectionRange(3,8);await inputClipboard(input,'copy',clipboard);assert(clip==='hello','input selection copy');clip='中文';await inputClipboard(input,'paste',clipboard);assert(input.value==='输入 中文','input paste');input.remove()
  results.push('ordinary input selection uses same clipboard provider')
  return results
 })
 assert.equal(results.length,6);assert.deepEqual(errors,[]);console.log('PASS 6 clipboard transaction/race groups; controlled provider, no system clipboard access')
}catch(error){await page.screenshot({path:`${output}/failure.png`});throw error}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
