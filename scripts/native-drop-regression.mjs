import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/native-drop'
fs.mkdirSync(output, {recursive:true})
fs.writeFileSync(`${output}/index.html`, '<!doctype html><link rel="icon" href="data:,"><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {FileController} from '/src/features/files/FileController.ts';
import {WorkspaceController} from '/src/features/workspace/WorkspaceController.ts';
import {tauriWorkspace} from '/src/features/workspace/tauriWorkspace.ts';
import {openDroppedDirectories} from '/src/features/files/nativeDrop.ts';
import {isImageFile} from '/src/editor/markdown/imageImport.ts';
const calls=[],notices=[],roots=new Map(),manager=new DocumentManager([],async()=>[]);
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  calls.push({command,args});
  if(command==='get_recent_workspaces')return [];
  if(command==='open_dropped_workspace'){
    if(args.token==='failed')throw '目录读取失败';
    const path=roots.get(args.token)||('E:/fixture/'+args.token);
    return {root_path:path,name:path.split('/').pop(),entries:[{id:path+'/README.md',path:path+'/README.md',name:'README.md',relative_path:'README.md',is_directory:false,is_symlink:false,is_readonly:false,size:1,mtime:0,has_children:false}]};
  }
  throw new Error('Unexpected command '+command);
}};
const files=new FileController(manager,{release:async()=>{}},message=>notices.push(message));
const workspace=new WorkspaceController(tauriWorkspace,manager,files,message=>notices.push(message),false);
window.f={manager,files,workspace,calls,notices,roots,isImageFile,
  drop:inputs=>openDroppedDirectories(inputs,token=>workspace.openDroppedWorkspace(token))};
`)
const server=await createServer({server:{port:1432,strictPort:true}})
await server.listen()
let browser
const results=[]
try {
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://localhost:1432/${output}/index.html`)
  await page.waitForFunction(()=>window.f)
  const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
  await test('folder-only drop opens the initial workspace via a native token',async()=>{
    const state=await page.evaluate(async()=>{const f=window.f,remaining=await f.drop([{token:'first',name:'project',isDirectory:true}]);return {remaining,path:f.workspace.rootPath,entries:f.workspace.entries.map(node=>node.name),call:f.calls.find(call=>call.command==='open_dropped_workspace')}})
    assert.equal(state.path,'E:/fixture/first');assert.deepEqual(state.remaining,[]);assert.deepEqual(state.entries,['README.md'])
    assert.deepEqual(state.call.args,{token:'first'})
  })
  await test('multiple folders add roots and preserve unsaved document contents',async()=>{
    const state=await page.evaluate(async()=>{const f=window.f,id=f.manager.createUntitled('txt');f.manager.dispatch(id,{changes:{from:0,insert:'unsaved work'}});await f.drop([{token:'second',name:'second',isDirectory:true},{token:'third',name:'third',isDirectory:true}]);return {roots:f.workspace.roots.map(root=>root.rootPath),text:f.manager.getText(id),dirty:f.manager.hasDirtyDocuments}})
    assert.deepEqual(state.roots,['E:/fixture/first','E:/fixture/second','E:/fixture/third']);assert.equal(state.text,'unsaved work');assert.equal(state.dirty,true)
  })
  await test('mixed drops keep files/images separate, including a folder named pictures.png',async()=>{
    const state=await page.evaluate(async()=>{const f=window.f,files=await f.drop([{token:'pictures',name:'pictures.png',isDirectory:true},{token:'text',name:'note.md'},{token:'image',name:'photo.png',isDirectory:false}]);return {tokens:files.map(file=>file.token),images:files.filter(file=>f.isImageFile(file.name)).map(file=>file.token)}})
    assert.deepEqual(state.tokens,['text','image']);assert.deepEqual(state.images,['image'])
  })
  await test('duplicate folders are idempotent; failed roots do not stop other drop items',async()=>{
    const state=await page.evaluate(async()=>{const f=window.f;f.roots.set('duplicate','E:/fixture/first');await f.drop([{token:'duplicate',name:'first',isDirectory:true}]);const files=await f.drop([{token:'failed',name:'failed',isDirectory:true},{token:'fourth',name:'fourth',isDirectory:true},{token:'text',name:'note.txt'}]);return {count:f.workspace.roots.filter(root=>root.rootPath==='E:/fixture/first').length,last:f.workspace.roots.at(-1).rootPath,files:files.map(file=>file.token),notices:f.notices}})
    assert.equal(state.count,1);assert.equal(state.last,'E:/fixture/fourth');assert.deepEqual(state.files,['text']);assert.ok(state.notices.includes('目录读取失败'))
  })
  await test('saving/composition gates block workspace mutations without invoking native open',async()=>{
    const state=await page.evaluate(async()=>{const f=window.f,before=f.calls.filter(call=>call.command==='open_dropped_workspace').length;f.files.saving.add('busy');const saving=await f.workspace.openDroppedWorkspace('blocked');f.files.saving.clear();Object.defineProperty(f.manager,'isComposing',{configurable:true,value:true});const composing=await f.workspace.openDroppedWorkspace('blocked');delete f.manager.isComposing;return {saving,composing,before,after:f.calls.filter(call=>call.command==='open_dropped_workspace').length}})
    assert.equal(state.saving,false);assert.equal(state.composing,false);assert.equal(state.before,state.after)
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:results,errors},null,2))
  console.log(`PASS ${results.length} native directory drop regressions`)
} finally {await browser?.close();await server.close()}
