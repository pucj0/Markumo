import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'

const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const output='test-results/code-structure'
fs.mkdirSync(output,{recursive:true})
const fixtures=JSON.parse(fs.readFileSync('scripts/fixtures/code-structure.json','utf8'))
fs.writeFileSync(`${output}/index.html`,'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:760px"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,h,ref,markRaw,nextTick} from 'vue'
import {EditorState} from '@codemirror/state'
import {syntaxTree,ensureSyntaxTree} from '@codemirror/language'
import {loadLanguage} from '/src/editor/languages/index.ts'
import {extractOutline,outlineResult} from '/src/editor/outline/outlineService.ts'
import {DocumentManager} from '/src/editor/core/DocumentManager.ts'
import EditorContainer from '/src/components/layout/EditorContainer.vue'
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css'
const manager=new DocumentManager([]),revision=ref(0),position=ref('right')
manager.subscribe(()=>revision.value++)
createApp({render(){revision.value;return [
 h(EditorContainer,{manager:markRaw(manager),doc:manager.activeDocument,showOutline:true,outlinePosition:position.value,desktop:false})]
}}).mount('#app')
window.f={manager,fixtures:${JSON.stringify(fixtures)},position,EditorState,loadLanguage,ensureSyntaxTree,syntaxTree,outlineResult,extractOutline,nextTick,
 async parse(f,complete=true){
   let state=EditorState.create({doc:f.source,extensions:[await loadLanguage(f.language)]})
   if(complete){ensureSyntaxTree(state,state.doc.length,1000);state=state.update({}).state}
   const doc={name:f.name,language:f.language,languageStatus:'ready'}
   const start=performance.now(),result=outlineResult(doc,state),extractMs=performance.now()-start
   const cacheStart=performance.now();let cacheSame=true
   for(let i=0;i<200;i++)cacheSame=cacheSame&&outlineResult(doc,state).items===result.items
   window.f.last={state,doc,result}
   return {...result,tree:syntaxTree(state).toString(),extractMs,cacheMs:performance.now()-cacheStart,cacheSame}
 },
 async open(f){
   const id=manager.createUntitled(f.name.split('.').pop());manager.dispatch(id,{changes:{from:0,insert:f.source}})
   await manager.setLanguage(id,f.language);await nextTick();return id
 }
}
`)
const server=await createServer({server:{host:'127.0.0.1',port:1468,strictPort:true,hmr:false,watch:null}})
await server.listen()
let browser
const results=[],errors=[],matrix=[],performance=[]
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
  const page=await browser.newPage({viewport:{width:1500,height:800},reducedMotion:'reduce'})
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:1468/${output}/index.html`);await page.waitForFunction(()=>window.f)
  const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
  const parent=(items,item)=>items.find(parent=>parent.id===item.parentId)?.name
  for(const fixture of fixtures){
    await test(`${fixture.language}: real parser nodes, declarations and lexical nesting`,async()=>{
      const parsed=await page.evaluate(f=>window.f.parse(f),fixture),items=parsed.items
      matrix.push({language:fixture.language,tree:parsed.tree,symbols:items.map(({name,kind,detail,parentId,id})=>({name,kind,detail,parent:items.find(p=>p.id===parentId)?.name,id}))})
      assert.ok(items.length>0,fixture.language+' must extract real symbols')
      assert.equal(new Set(items.map(i=>i.id)).size,items.length,'No duplicate symbol ids')
      for(const item of items){
        assert.ok(item.from>=0 && item.to<=fixture.source.length && item.from<item.to)
        if(item.parentId){const owner=items.find(p=>p.id===item.parentId);assert.ok(owner);assert.ok(owner.scopeFrom<=item.scopeFrom && owner.to>=item.to);assert.equal(item.level,owner.level+1)}
      }
      assert.equal(parsed.cacheSame,true)
      if(fixture.language==='Java'){
        assert.equal(parent(items,items.find(i=>i.name==='service')),'UserController')
        assert.equal(items.find(i=>i.name==='UserController'&&i.kind==='constructor').level,2)
        const overloads=items.filter(i=>i.name==='getUser');assert.equal(overloads.length,2);assert.notEqual(overloads[0].detail,overloads[1].detail)
        assert.equal(parent(items,items.find(i=>i.name==='inner')),'Nested')
      }
      if(fixture.language==='TypeScript'){
        assert.equal(items.find(i=>i.name==='用户').kind,'interface');assert.equal(items.find(i=>i.name==='Result').kind,'type')
        assert.equal(items.filter(i=>i.name==='overload').length,3)
        assert.equal(parent(items,items.find(i=>i.name==='nested')),'overload')
      }
      if(fixture.language==='JavaScript'){assert.equal(items.find(i=>i.name==='arrow').kind,'function');assert.equal(parent(items,items.find(i=>i.name==='callback')),'object')}
      if(fixture.language==='JSX'||fixture.language==='TSX')assert.equal(items.find(i=>i.name==='ArrowComponent').kind,'function')
      if(fixture.language==='Vue'){assert.ok(items.some(i=>i.name==='Props'));assert.ok(items.some(i=>i.name==='click'));assert.ok(!items.some(i=>i.name==='fake'));assert.equal(parent(items,items.find(i=>i.name==='nested')),'save')}
      if(fixture.language==='Python'){assert.equal(items.find(i=>i.name==='用户').kind,'class');assert.equal(items.find(i=>i.name==='__init__').kind,'constructor');assert.equal(parent(items,items.find(i=>i.name==='nested')),'save')}
      if(fixture.language==='Go'){assert.equal(parent(items,items.find(i=>i.name==='Name')),'User');assert.equal(items.find(i=>i.name==='Save'&&!i.parentId).kind,'method');assert.equal(items.find(i=>i.name==='Alias').kind,'type')}
      if(fixture.language==='Rust'){assert.equal(parent(items,items.find(i=>i.name==='name')),'User');assert.equal(items.find(i=>i.name==='Service').kind,'trait');assert.equal(items.filter(i=>i.kind==='impl').length,2);assert.equal(parent(items,items.find(i=>i.name==='new')),'impl User')}
      if(fixture.language==='C++'){assert.equal(parent(items,items.find(i=>i.name==='Service'&&i.kind==='class')),'api');assert.equal(items.filter(i=>i.name==='save').length,2)}
      if(fixture.language==='PHP'){assert.equal(items.find(i=>i.name==='Shared').kind,'trait');assert.equal(parent(items,items.find(i=>i.name==='$name')),'User');assert.equal(items.find(i=>i.name==='__construct').kind,'constructor')}
    })
  }
  await test('incomplete code, empty files, lexical-only languages and unparsed trees degrade honestly',async()=>{
    for(const language of ['Plain Text','C','C#','Kotlin','Shell']){
      const parsed=await page.evaluate(f=>window.f.parse(f),{language,name:'fake.txt',source:'class Fake { function fake() {} }'})
      assert.deepEqual(parsed.items,[]);assert.match(parsed.notice,/纯文本|词法/)
    }
    for(const source of ['', 'class Missing { broken(', 'function ( {', 'const fake = "function pretend() {}"; // class Wrong {}']){
      const parsed=await page.evaluate(f=>window.f.parse(f),{language:'JavaScript',name:'empty.js',source})
      assert.ok(!parsed.items.some(i=>['pretend','Wrong','broken'].includes(i.name)))
    }
    const pending=await page.evaluate(f=>window.f.parse(f,false),{language:'TypeScript',name:'partial.ts',source:'function late() {}\n'.repeat(6000)})
    assert.deepEqual(pending.items,[]);assert.match(pending.notice,/解析尚未完成/)
  })
  await test('content-version cache updates ranges while semantic ids survive prefix edits',async()=>{
    const fixture=fixtures.find(f=>f.language==='Java');await page.evaluate(f=>window.f.parse(f),fixture)
    const update=await page.evaluate(()=>{
      const {state,doc,result}=window.f.last,next=state.update({changes:{from:0,insert:'// comment\n'}}).state
      window.f.ensureSyntaxTree(next,next.doc.length,1000)
      return {before:result.items,after:window.f.outlineResult(doc,next).items}
    })
    assert.deepEqual(update.before.map(i=>i.id),update.after.map(i=>i.id))
    update.before.forEach((item,index)=>{assert.equal(update.after[index].from,item.from+11);assert.equal(update.after[index].lineNumber,item.lineNumber+1)})
  })
  await test('decorated Python methods and C++ pointer-return declarations use verified wrappers',async()=>{
    const python=await page.evaluate(f=>window.f.parse(f),{language:'Python',name:'decorated.py',source:'class User:\n    @classmethod\n    def make(cls):\n        pass\n'})
    assert.equal(python.items.find(item=>item.name==='make').kind,'method')
    const cpp=await page.evaluate(f=>window.f.parse(f),{language:'C++',name:'pointer.cpp',source:'class Service { public: int* get(); };\nint* find(int x) { return nullptr; }'})
    assert.equal(cpp.items.find(item=>item.name==='get').kind,'method');assert.equal(cpp.items.find(item=>item.name==='find').kind,'function')
  })
  await test('Java record components and PHP enum cases remain children of their declarations',async()=>{
    const java=await page.evaluate(f=>window.f.parse(f),{language:'Java',name:'record.java',source:'record Entry(int id) { void run() {} }'})
    assert.equal(java.items.find(item=>item.name==='Entry').kind,'struct');assert.equal(parent(java.items,java.items.find(item=>item.name==='id')),'Entry')
    const php=await page.evaluate(f=>window.f.parse(f),{language:'PHP',name:'enum.php',source:'<?php enum State { case Ready; case Done; }'})
    assert.equal(php.items.find(item=>item.name==='State').kind,'enum');assert.equal(parent(php.items,php.items.find(item=>item.name==='Ready')),'State')
  })
  const open=async fixture=>{await page.evaluate(f=>window.f.open(f),fixture);await page.waitForFunction(()=>document.querySelectorAll('.outline-sidebar .outline-item').length>0)}
  await open(fixtures.find(f=>f.language==='Java'))
  const right=page.locator('.outline-sidebar')
  const row=(side,name)=>side.locator('.outline-item').filter({has:page.locator('.outline-label',{hasText:new RegExp('^'+name+'$')})})
  await test('the singleton outline retains symbol hierarchy when docked left/right; filtering highlights and retains ancestors',async()=>{
    await page.evaluate(()=>{window.symbolOutline=document.querySelector('.outline-container');window.f.position.value='left'})
    await page.waitForFunction(()=>document.querySelector('.editor-container').dataset.outlinePosition==='left')
    assert.equal(await page.locator('.outline-container').count(),1)
    assert.equal(await page.evaluate(()=>window.symbolOutline===document.querySelector('.outline-container')),true)
    assert.ok(await right.boundingBox().then(async box=>box.x<(await page.locator('.editor-main').boundingBox()).x))
    await page.evaluate(()=>window.f.position.value='right')
    await page.waitForFunction(()=>document.querySelector('.editor-container').dataset.outlinePosition==='right')
    assert.ok(await right.boundingBox().then(async box=>box.x>(await page.locator('.editor-main').boundingBox()).x))
    await right.getByRole('textbox',{name:'筛选符号'}).fill('inner')
    assert.deepEqual(await right.locator('.outline-label').allTextContents(),['UserController','Nested','inner'])
    assert.equal(await right.locator('mark').allTextContents().then(a=>a.join('')),'inner')
    await right.getByRole('textbox',{name:'筛选符号'}).fill('')
    await right.getByRole('combobox',{name:'符号种类'}).selectOption('constructor')
    assert.deepEqual(await right.locator('.outline-label').allTextContents(),['UserController','UserController'])
    await right.getByRole('combobox',{name:'符号种类'}).selectOption('')
    assert.ok(await right.locator('svg.symbol-class').count()>0)
    await page.screenshot({path:`${output}/outline-java.png`})
  })
  await test('fold state survives edits and file switches; keyboard expands, traverses and navigates',async()=>{
    const controller=row(right,'UserController').first()
    await controller.focus();await page.keyboard.press('ArrowLeft')
    assert.equal(await row(right,'getUser').count(),0)
    await page.evaluate(async()=>{window.f.position.value='left';await window.f.nextTick()})
    assert.equal(await row(right,'getUser').count(),0)
    assert.equal(await page.evaluate(()=>window.symbolOutline===document.querySelector('.outline-container')),true)
    await page.evaluate(()=>window.f.position.value='right')
    const id=await page.evaluate(()=>window.f.manager.activeId)
    await page.evaluate(()=>{const m=window.f.manager;m.dispatch(m.activeId,{changes:{from:0,insert:'// prefix\n'}})})
    await page.waitForTimeout(250);assert.equal(await row(right,'getUser').count(),0)
    await open(fixtures.find(f=>f.language==='Python'))
    await page.evaluate(id=>window.f.manager.open(id),id)
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar .symbol-class'))
    assert.equal(await row(right,'getUser').count(),0)
    await row(right,'UserController').first().focus();await page.keyboard.press('ArrowRight')
    await page.waitForFunction(()=>[...document.querySelectorAll('.outline-sidebar .outline-label')].filter(el=>el.textContent==='getUser').length===2)
    await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.querySelector('.outline-label').textContent),'service')
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(()=>{const m=window.f.manager;return m.activeEditorView.state.sliceDoc(m.activeEditorView.state.selection.main.head,m.activeEditorView.state.selection.main.head+7)}),'service')
  })
  await test('real edit refreshes declaration ranges; active symbol follows the deepest lexical scope',async()=>{
    const fixture=fixtures.find(f=>f.language==='TypeScript');await open(fixture)
    await row(right,'nested').click()
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar .outline-item.active .outline-label')?.textContent==='nested')
    await page.keyboard.type('renamed')
    await page.waitForFunction(()=>[...document.querySelectorAll('.outline-sidebar .outline-label')].some(el=>el.textContent==='renamednested'))
    await row(right,'renamednested').click()
    const at=await page.evaluate(()=>window.f.manager.activeEditorView.state.selection.main.head)
    assert.equal(await page.evaluate(at=>window.f.manager.getText(window.f.manager.activeId).slice(at,at+13),at),'renamednested')
  })
  await test('multi Pane jumps target the active view and preserve the other selection/scroll',async()=>{
    const other=await page.evaluate(()=>{const m=window.f.manager;return m.splitPane('right',m.activePane,m.activeId)})
    await page.waitForFunction(other=>window.f.manager.paneView(other),other)
    const before=await page.evaluate(()=>{const v=window.f.manager.paneView('main');return {selection:v.state.selection.toJSON(),top:v.scrollDOM.scrollTop}})
    await row(right,'arrow').click()
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar .outline-item.active .outline-label')?.textContent==='arrow')
    assert.equal(await page.evaluate(()=>{const m=window.f.manager,v=m.activeEditorView;return v.state.sliceDoc(v.state.selection.main.head,v.state.selection.main.head+5)}),'arrow')
    assert.deepEqual(await page.evaluate(()=>{const v=window.f.manager.paneView('main');return {selection:v.state.selection.toJSON(),top:v.scrollDOM.scrollTop}}),before)
    await page.evaluate(other=>window.f.manager.closePane(other),other)
  })
  await test('language changes, rename, rapid close/switch and Markdown modes retain correct ownership',async()=>{
    await page.evaluate(()=>window.f.manager.setLanguage(window.f.manager.activeId,'Plain Text'))
    await page.waitForFunction(()=>!document.querySelector('.outline-sidebar .outline-item'))
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar')?.textContent.includes('纯文本'))
    assert.match(await right.innerText(),/纯文本/)
    await page.evaluate(()=>window.f.manager.setLanguage(window.f.manager.activeId,'Python'))
    await page.waitForTimeout(180)
    await page.evaluate(async()=>{
      const m=window.f.manager
      m.openFile({token:'rename-fixture',path:'E:/structure/Before.java',name:'Before.java',text:'class Renamed {}',kind:'text',encoding:'UTF-8',eol:'LF',bom:false,readOnly:false,version:'1'})
      await m.setLanguage(m.activeId,'Java')
      m.renamePath('E:/structure/Before.java','E:/structure/After.ts','After.ts')
    })
    await page.waitForFunction(()=>window.f.manager.activeDocument?.name==='After.ts'&&window.f.manager.activeDocument?.language==='TypeScript'&&window.f.manager.activeDocument?.languageStatus==='ready')
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar .outline-label')?.textContent==='Renamed')
    await page.evaluate(()=>{const m=window.f.manager;const id=m.createUntitled('ts');m.dispatch(id,{changes:{from:0,insert:'function transient() {}'}});m.close(id,true)})
    await open({language:'Markdown',name:'doc.md',source:'# 标题\n\n## 子标题\n\n正文'})
    for(const mode of ['source','live','split']){
      await page.evaluate(mode=>{const m=window.f.manager;m.setMarkdownMode(m.activeId,mode)},mode)
      await row(right,'子标题').click()
      assert.equal(await page.evaluate(()=>{const m=window.f.manager;return m.getMarkdownMode(m.activeId)}),mode)
    }
    assert.equal(await right.getByRole('textbox',{name:'筛选符号'}).count(),0)
    await page.evaluate(()=>window.f.manager.setLanguage(window.f.manager.activeId,'Plain Text'))
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar')?.textContent.includes('纯文本'))
    assert.equal(await right.getByRole('textbox',{name:'筛选符号'}).count(),1)
    assert.equal(await page.evaluate(()=>{const m=window.f.manager;return m.getMarkdownMode(m.activeId)}),'split')
    await page.evaluate(()=>window.f.manager.setLanguage(window.f.manager.activeId,'Markdown'))
    await page.waitForFunction(()=>document.querySelector('.outline-sidebar .outline-label')?.textContent==='标题')
  })
  await test('large-file limits, bounded extraction and 200 cache hits are measured',async()=>{
    for(const count of [100,1000,3500]){
      const parsed=await page.evaluate(f=>window.f.parse(f),{language:'JavaScript',name:'large.js',source:Array.from({length:count},(_,i)=>`function symbol${i}(value) { return value; }`).join('\n')})
      performance.push({count,extractMs:parsed.extractMs,cacheMs:parsed.cacheMs,items:parsed.items.length,notice:parsed.notice})
      assert.ok(parsed.items.length<=1000);assert.ok(parsed.extractMs<150);assert.ok(parsed.cacheMs<30);assert.equal(parsed.cacheSame,true)
      if(count===3500)assert.match(parsed.notice,/预算/)
    }
    const huge=await page.evaluate(()=>window.f.parse({language:'JavaScript',name:'huge.js',source:'// large\n'.repeat(40000)}))
    assert.deepEqual(huge.items,[]);assert.match(huge.notice,/较大/)
    await open({language:'JavaScript',name:'many.js',source:Array.from({length:1000},(_,i)=>`function symbol${i}() {}`).join('\n')})
    const filter=await page.evaluate(async()=>{
      const input=document.querySelector('.outline-sidebar input'),start=performance.now()
      input.value='symbol999';input.dispatchEvent(new Event('input',{bubbles:true}));await window.f.nextTick()
      return {filterMs:performance.now()-start,names:[...document.querySelectorAll('.outline-sidebar .outline-label')].map(el=>el.textContent)}
    })
    assert.deepEqual(filter.names,['symbol999']);assert.ok(filter.filterMs<200)
    performance.push(filter)
    console.log('METRICS '+JSON.stringify(performance))
  })
  assert.deepEqual(errors,[])
  console.log(`PASS ${results.length} code structure groups`)
}finally{
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,errors,matrix,performance},null,2))
  await browser?.close();await server.close()
}
