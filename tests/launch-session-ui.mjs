import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const output=`test-results/launch-session-ui/${Date.now()}`;await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'}),results=[],errors=[]
let page
try{
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(process.env.LIGHTEDIT_TEST_URL||'http://localhost:1422')
  await page.getByRole('region',{name:'LightEdit 欢迎页'}).waitFor()
  assert.equal(await page.locator('.cm-editor,[role=tab]').count(),0)
  await page.keyboard.type('abc');await page.keyboard.insertText('中文');assert.equal(await page.locator('.cm-editor').count(),0)
  await page.getByRole('region',{name:'LightEdit 欢迎页'}).getByRole('button',{name:'新建文件',exact:true}).click()
  await page.getByRole('textbox',{name:'文本编辑器',exact:true}).fill('explicit draft中文')
  assert.equal(await page.getByRole('tab',{name:'Untitled-1.txt',exact:true}).count(),1)
  results.push({name:'Real browser App: no orphan/draft on welcome, explicit New works',result:'PASS'})
  await page.close()
  page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{
    const callbacks=new Map(),listeners=new Map();let next=0
    const file={token:'file-a',path:'C:\\fixture\\a.txt',name:'a.txt',text:'actual contract fixture',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'}
    window.contract={calls:[]};window.isTauri=true
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event,id)=>listeners.delete(id)}
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:cb=>{const id=++next;callbacks.set(id,cb);return id},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args)=>{
      window.contract.calls.push(command)
      if(command==='plugin:event|listen'){const id=++next;listeners.set(id,args);return id}
      if(command==='plugin:event|unlisten')return listeners.delete(args.eventId)
      if(command==='load_editor_settings')return {autoSave:false}
      if(command==='initialize_launch')return {kind:'app',ownsSession:true,files:{files:[],errors:[]},roots:[],activePath:null,layout:{mode:'single',sidebarVisible:false,sidebarWidth:254},warnings:[]}
      if(command==='file_preferences')return {recent:[],layout:{mode:'single',sidebarVisible:false,sidebarWidth:254}}
      if(command==='get_recent_workspaces')return []
      if(command==='drain_pending')return {files:[],errors:[]}
      if(command==='open_dialog')return {files:[file],errors:[]}
      if(['save_editor_settings','persist_layout','persist_session','plugin:window|set_theme','release_file'].includes(command))return
      throw Error('Unexpected contract IPC: '+command)
    }}
  })
  await page.goto(process.env.LIGHTEDIT_TEST_URL||'http://localhost:1422')
  await page.waitForFunction(()=>{const s=document.querySelector('#app')?.__vue_app__?._instance?.setupState;return s&&!s.startupLoading&&!s.fileBusy})
  await page.evaluate(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;s.setMode('workspace');s.toggleSidebar()})
  await page.keyboard.press('Control+o')
  await page.getByRole('tab',{name:'a.txt',exact:true}).waitFor()
  const actual=await page.evaluate(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;return {mode:s.appMode,sidebar:s.sidebarVisible,names:s.manager.openedDocuments.map(d=>d.name),calls:window.contract.calls}})
  assert.equal(actual.mode,'workspace');assert.equal(actual.sidebar,false);assert.deepEqual(actual.names,['a.txt'])
  assert.ok(actual.calls.includes('open_dialog'));assert.equal(actual.calls.includes('restore_workspace_folders'),false)
  results.push({name:'Ctrl+O executes real shell command and preserves mode/sidebar (IPC dialog contract, not OS picker)',result:'PASS'})
  assert.deepEqual(errors,[])
}finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
console.log(JSON.stringify({results,errors}))
