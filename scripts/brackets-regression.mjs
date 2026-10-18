// Uses an isolated browser and mock documents; never writes the OS clipboard.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'

const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output='test-results/brackets-p2'
const pairs='()[]{}'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><div id="fixture" style="height:420px"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`,`
import {EditorState,EditorSelection,Compartment} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {syntaxTree,forceParsing,ensureSyntaxTree} from '@codemirror/language';
import {undo,redo} from '@codemirror/commands';
import {bracketHighlight,bracketModes,bracketLimits,rainbowBrackets,matchingBrackets} from '/src/editor/core/brackets.ts';
import {languageRegistry,loadLanguage} from '/src/editor/languages/index.ts';
import {syntaxSamples} from '/scripts/fixtures/syntax-samples.mjs';
import {coreExtensions,editorTheme} from '/src/editor/core/extensions.ts';
import {applySyntaxStyle} from '/src/editor/core/syntaxTheme.ts';
import {defaultSettings,settingsFrom} from '/src/features/shell/editorSettings.ts';
import {createApp,nextTick} from 'vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';import '/src/editor/markdown/styles.css';
window.f={EditorState,EditorSelection,Compartment,EditorView,syntaxTree,forceParsing,ensureSyntaxTree,undo,redo,bracketHighlight,bracketModes,bracketLimits,rainbowBrackets,matchingBrackets,languageRegistry,loadLanguage,syntaxSamples,applySyntaxStyle,defaultSettings,settingsFrom,nextTick};
window.reset=async(name,source,mode='rainbow')=>{window.view?.destroy();window.config=new Compartment();window.view=new EditorView({parent:document.getElementById('fixture'),state:EditorState.create({doc:source,extensions:[coreExtensions,await loadLanguage(name),window.config.of(bracketHighlight(mode)),editorTheme('dark')]})});forceParsing(window.view,Math.min(source.length,50000),100);window.view.focus();await new Promise(r=>setTimeout(r,60));};
window.spans=(plugin=rainbowBrackets)=>{const view=window.view, marks=view.plugin(plugin)?.decorations;const spans=[];if(marks)for(let c=marks.iter();c.value;c.next())spans.push({from:c.from,to:c.to,text:view.state.sliceDoc(c.from,c.to),class:c.value.spec.class});return spans;};
window.mountApp=async()=>{window.view?.destroy();window.view=null;document.getElementById('fixture').remove();const {default:App}=await import('/src/App.vue');window.app=createApp(App);window.app.mount('#app');window.s=window.app._instance.setupState;await nextTick();};
window.doc=async(source,kind='txt',mode='source')=>{const m=window.s.manager;m.mergeAllPanes();m.createUntitled(kind);const id=m.activeId;m.dispatch(id,{changes:{from:0,to:m.getState(id).doc.length,insert:source},selection:{anchor:0}});if(kind==='md')m.setMarkdownMode(id,mode);await nextTick();return id;};
`)
const server=await createServer({optimizeDeps:{include:['@codemirror/legacy-modes/mode/pug']},server:{host:'127.0.0.1',port:1439,strictPort:true}})
await server.listen()
let browser
const tests=[],errors=[],performanceResults=[]
try {
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage({viewport:{width:1280,height:850},reducedMotion:'reduce'})
  page.setDefaultTimeout(12000)
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',e=>{if(/crashed|Unknown highlighting tag/.test(e.text()))errors.push(e.text())})
  await page.goto(`http://127.0.0.1:1439/${output}/index.html`)
  await page.waitForFunction(()=>window.f)
  const test=async(name,run)=>{await run();tests.push(name);console.log('PASS '+name)}
  const reset=(name,source,mode)=>page.evaluate(([name,source,mode])=>window.reset(name,source,mode),[name,source,mode])
  const spans=()=>page.evaluate(()=>window.spans())
  await test('old/invalid preferences default to matching; all modes round-trip',async()=>{
    const data=await page.evaluate(()=>({old:window.f.settingsFrom({}).bracketMode,bad:window.f.settingsFrom({bracketMode:'wrong'}).bracketMode,modes:window.f.bracketModes.map(bracketMode=>window.f.settingsFrom(JSON.parse(JSON.stringify({...window.f.defaultSettings(),bracketMode}))).bracketMode)}))
    assert.deepEqual(data,{old:'matching',bad:'matching',modes:['off','matching','rainbow']})
  })
  await test('nested and mixed brackets use the same level for each pair and cycle softly',async()=>{
    await reset('JavaScript','const value = ({items: [call({deep: [1]})]});')
    const result=await spans();assert.equal(result.map(s=>s.text).join(''),'({[({[]})]})')
    assert.deepEqual(result.map(s=>s.class),[1,2,3,4,1,2,2,1,4,3,2,1].map(n=>'mk-bracket-'+n))
    await reset('JavaScript','const x = '+ '('.repeat(200)+'1'+')'.repeat(200)+';')
    const deep=await spans();assert.ok(deep.length>0);assert.ok(deep.every(s=>s.to-s.from===1));assert.ok((await page.evaluate(()=>window.view.plugin(window.f.rainbowBrackets).work)).ancestors<=16000)
  })
  await test('strings, comments, regexps and template text stay untouched; interpolated code works',async()=>{
    const source='const s = "([{ }])"; // ([{}])\n/* ({[]}) */ const r = /[(){}]/;\nconst text = `raw ([{}]) ${call({items:[1]})}`;'
    await reset('JavaScript',source);const result=await spans()
    assert.equal(result.map(s=>s.text).join(''),'({[]})');assert.ok(result.every(s=>s.from>=source.indexOf('call(')))
  })
  await test('native grammar languages produce bounded delimiter marks, including YAML flow data and SQL',async()=>{
    const cases={TypeScript:'function f(x: number[]) { return ({a: [x]}); }',Java:'class A { int f() { return call(new int[]{1}); } }',Rust:'fn f() { let v = vec![(1, 2)]; }',Python:'def f(x):\n    return {"items": [call(x)]}',Go:'package main\nfunc f() { v := []int{1, 2}; call(v) }',JSON:'{"items": [{"ok":true}]}',SQL:'SELECT COALESCE((age + 1), 2) FROM users;',YAML:'items: [{name: "([)]", enabled: true}]'}
    for(const [name,source] of Object.entries(cases)){await reset(name,source);const result=await spans();assert.ok(result.length>=2,name);assert.ok(result.every(s=>pairs.includes(s.text)),name);const quote=source.indexOf('"([)]"');if(quote>=0)assert.ok(!result.some(s=>s.from>quote&&s.from<quote+6),name)}
  })
  await test('all registry entries load safely; StreamLanguage and plain formats have explicit fallback',async()=>{
    const matrix=[]
    for(const row of await page.evaluate(()=>window.f.languageRegistry.map(l=>({id:l.id,name:l.name,parser:l.parser})))){
      await page.evaluate(async row=>{const source=window.f.syntaxSamples[row.id].source;await window.reset(row.name,row.id==='php'?'<?php\n'+source:source)},row)
      const result=await spans();if(row.parser!=='lezer')assert.equal(result.length,0,row.name)
      matrix.push({...row,rainbow:result.length>0,marks:result.length,strategy:row.parser==='stream'?'bounded matching only':row.parser==='none'?'matching only':'syntax delimiters / embedded languages only'})
    }
    fs.writeFileSync(`${output}/language-matrix.json`,JSON.stringify(matrix,null,2));assert.equal(matrix.length,48)
    for(const name of ['C','C#','JSONC','TOML']){
      await reset(name,'({items:[1]}) /* ([)] */ "([)]"');await page.evaluate(()=>window.view.dispatch({selection:{anchor:1}}))
      const matches=await page.evaluate(()=>window.spans(window.f.matchingBrackets));assert.equal(matches.length,2,name);assert.ok(matches.every(s=>s.class==='mk-bracket-match'),name)
    }
  })
  await test('JSX, HTML and Vue respect embedded boundaries and ignore tag angles, attributes and prose',async()=>{
    const cases={JSX:'const x = <div title="([)]">plain ([)] {call({a:[1]})}</div>;',HTML:'<p title="([)]">plain ([)]</p><script>call({a:[1]})</script><style>.a { width:calc(1px + 2px); }</style>',Vue:'<template><p title="([)]">plain ([)] {{ call({a:[1]}) }}</p></template><script setup lang="ts">const a = [call({n:1})]</script>'}
    for(const [name,source] of Object.entries(cases)){await reset(name,source);const result=await spans();assert.ok(result.length>=6,name);assert.ok(result.every(s=>!'< >'.includes(s.text)),name);const attr=source.indexOf('([)]');assert.ok(result.every(s=>s.from<attr||s.from>=attr+4),name);const prose=source.indexOf('plain (')+6;assert.ok(result.every(s=>s.from<prose||s.from>=prose+4),name)}
  })
  await test('Markdown source fences use their parser, prose and unsupported fences stay plain',async()=>{
    const source='Text ([{}])\n\n```javascript\ncall({a:[1]})\n```\n\n```text\n([{}])\n```\n'
    await reset('Markdown',source);await page.waitForFunction(()=>window.spans().length===6)
    const result=await spans();assert.equal(result.map(s=>s.text).join(''),'({[]})');assert.ok(result.every(s=>s.from>=source.indexOf('call(')&&s.to<=source.indexOf('\n```',source.indexOf('call('))))
    const separate='```c\n(\n```\n\n```c\n)\n```';await reset('Markdown',separate,'matching');await page.evaluate(()=>window.view.dispatch({selection:{anchor:6}}));const matches=await page.evaluate(()=>window.spans(window.f.matchingBrackets));assert.ok(matches.every(s=>s.class==='mk-bracket-invalid'));assert.ok(matches.length<=1,'never pair across independent fences')
  })
  await test('matching mode is exclusive, malformed brackets warn, and multiple cursors deduplicate',async()=>{
    await reset('JavaScript','call({items:[1]}); next();','matching');await page.evaluate(()=>window.view.dispatch({selection:window.f.EditorSelection.create([window.f.EditorSelection.cursor(5),window.f.EditorSelection.cursor(12)])}))
    assert.equal((await spans()).length,0);const matches=await page.evaluate(()=>window.spans(window.f.matchingBrackets));assert.equal(matches.length,4);assert.equal(new Set(matches.map(s=>s.from)).size,matches.length)
    await page.evaluate(()=>window.view.dispatch({selection:{anchor:2}}));assert.equal((await page.evaluate(()=>window.spans(window.f.matchingBrackets))).length,0)
    await page.evaluate(()=>window.view.dispatch({selection:{anchor:5}}));await page.evaluate(()=>window.view.contentDOM.blur());await page.waitForFunction(()=>window.spans(window.f.matchingBrackets).length===0)
    await reset('JavaScript','const x = ([1,2];','matching');await page.evaluate(()=>window.view.dispatch({selection:{anchor:11}}));assert.ok((await page.evaluate(()=>window.spans(window.f.matchingBrackets))).some(s=>s.class==='mk-bracket-invalid'))
    await reset('JavaScript','{]');const malformed=await spans();assert.equal(malformed.some(s=>s.text===']'),false,'error recovery must not invent a rainbow pair')
  })
  await test('six palettes update computed colors; matching wins over rainbow without background blocks',async()=>{
    await reset('JavaScript','call({a:[1]});');await page.evaluate(()=>window.view.dispatch({selection:{anchor:5}}))
    const colors=[]
    for(const theme of ['dark','light'])for(const style of ['soft','standard','vivid']){
      const data=await page.evaluate(({theme,style})=>{document.body.classList.toggle('light',theme==='light');window.f.applySyntaxStyle(style);const match=document.querySelector('.mk-bracket-match'),rainbow=document.querySelector('.mk-bracket-3'),body=getComputedStyle(document.body);const actual=el=>{const leaf=el.querySelector('span')||el;return {color:getComputedStyle(leaf).color,background:getComputedStyle(leaf).backgroundColor}};const probe=document.createElement('span');probe.style.color='var(--syntax-bracket-match)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {match:actual(match),rainbow:actual(rainbow),expected,tokens:['1','2','3','4','match','invalid'].map(r=>body.getPropertyValue('--syntax-bracket-'+r).trim())}},{theme,style})
      assert.equal(data.match.color,data.expected);assert.equal(data.match.background,'rgba(0, 0, 0, 0)');assert.ok(data.tokens.every(c=>/^#[\da-f]{6}$/i.test(c)));colors.push({theme,style,...data})
    }
    fs.writeFileSync(`${output}/palettes.json`,JSON.stringify(colors,null,2));assert.equal(new Set(colors.map(c=>c.tokens[0])).size,6)
  })
  await test('off removes plugin instances and leaves auto-close, history, copyable text and selection intact',async()=>{
    await reset('JavaScript','const x = ({a:[1]});');const result=await page.evaluate(()=>{const f=window.f,v=window.view,doc=v.state.doc,selection=v.state.selection;v.dispatch({effects:window.config.reconfigure(f.bracketHighlight('off'))});return {rainbow:v.plugin(f.rainbowBrackets)===null,matching:v.plugin(f.matchingBrackets)===null,doc:v.state.doc===doc,selection:v.state.selection.eq(selection)}})
    assert.deepEqual(result,{rainbow:true,matching:true,doc:true,selection:true});assert.equal(await page.locator('[class*=mk-bracket-]').count(),0)
    await reset('JavaScript','','off');await page.locator('#fixture .cm-content').click();await page.keyboard.type('(');assert.equal(await page.evaluate(()=>window.view.state.doc.toString()),'()')
    await page.keyboard.type('a');await page.evaluate(()=>window.f.undo(window.view));await page.evaluate(()=>window.f.redo(window.view));assert.ok((await page.evaluate(()=>window.view.state.doc.toString())).includes('a'))
  })
  await test('rainbow marks preserve clipboard payloads, paste, undo/redo and cursor coordinates',async()=>{
    await reset('JavaScript','call({a:[1]});')
    const data=await page.evaluate(()=>{const f=window.f,v=window.view,source=v.state.doc.toString();v.focus();v.dispatch({selection:{anchor:0,head:source.length}});const clipboard=new DataTransfer();v.contentDOM.dispatchEvent(new ClipboardEvent('copy',{clipboardData:clipboard,bubbles:true,cancelable:true}));const copied=clipboard.getData('text/plain');v.dispatch({selection:{anchor:0}});const original=v.coordsAtPos(5);v.dispatch({effects:window.config.reconfigure(f.bracketHighlight('off'))});const off=v.coordsAtPos(5);v.dispatch({effects:window.config.reconfigure(f.bracketHighlight('rainbow'))});const pasted=new DataTransfer();pasted.setData('text/plain','// 粘贴\n');v.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:pasted,bubbles:true,cancelable:true}));const text=v.state.doc.toString();f.undo(v);const undone=v.state.doc.toString();f.redo(v);return {copied,source,text,undone,redone:v.state.doc.toString(),coordinates:Math.abs(original.left-off.left)<.1&&Math.abs(original.top-off.top)<.1}})
    assert.equal(data.copied,data.source);assert.equal(data.text,'// 粘贴\n'+data.source);assert.equal(data.undone,data.source);assert.equal(data.redone,data.text);assert.equal(data.coordinates,true)
  })
  await test('edit, undo and redo invalidate cached positions while retaining pair levels',async()=>{
    await reset('JavaScript','call({items:[1]});');const before=await spans()
    await page.evaluate(()=>window.view.dispatch({changes:{from:0,insert:'// shift\n'}}));const changed=await spans()
    assert.deepEqual(changed.map(s=>({...s,from:s.from-9,to:s.to-9})),before)
    await page.evaluate(()=>window.f.undo(window.view));assert.deepEqual(await spans(),before)
    await page.evaluate(()=>window.f.redo(window.view));assert.deepEqual(await spans(),changed)
  })
  await test('large files, a huge block and a million-character plain line stay within work budgets',async()=>{
    for(const name of ['JavaScript','JSON','SQL','C#']){
      const result=await page.evaluate(async name=>{const f=window.f,line=name==='JavaScript'?'call({a:[1,2]});':name==='JSON'?'[1, {"a":[2,3]}],':name==='SQL'?'SELECT COALESCE((age+1),2) FROM users;':'Call(new [] {1,2});';const source=name==='JSON'?'[\n'+Array.from({length:30000},()=>line).join('\n').replace(/,$/,'')+'\n]':name==='JavaScript'?'function f() {\n'+Array.from({length:30000},()=>line).join('\n')+'\n}':Array.from({length:30000},()=>line).join('\n');const results=[];let v;for(const mode of ['off','matching','rainbow']){await window.reset(name,source,mode);v=window.view;v.scrollDOM.scrollTop=0;v.dispatch({effects:window.config.reconfigure(f.bracketHighlight(mode)),selection:{anchor:0}});await new Promise(r=>setTimeout(r,80));f.forceParsing(v,v.viewport.to,100);const samples=[];for(let i=0;i<25;i++){const start=performance.now();v.dispatch({changes:{from:Math.min(20,v.state.doc.length),insert:' '}});samples.push(performance.now()-start);}const editMs=samples.reduce((a,b)=>a+b,0),sorted=[...samples].sort((a,b)=>a-b),medianMs=sorted[12],p95Ms=sorted[23];v.scrollDOM.scrollTop=v.scrollDOM.scrollHeight;await new Promise(r=>setTimeout(r,120));const wasPending=!f.ensureSyntaxTree(v.state,v.viewport.to,0);if(mode==='rainbow'&&name!=='C#')f.forceParsing(v,v.viewport.to,3000);await new Promise(r=>setTimeout(r,40));results.push({mode,editMs,medianMs,p95Ms,lines:v.dom.querySelectorAll('.cm-line').length,work:v.plugin(f.rainbowBrackets)?.work||null,marks:window.spans().length,wasPending});}if(name==='JavaScript'){v.scrollDOM.scrollTop=0;v.dispatch({selection:{anchor:14}});await new Promise(r=>setTimeout(r,40));const matches=window.spans(f.matchingBrackets);if(!matches.some(s=>s.class==='mk-bracket-match'))throw Error('Large block lost structural matching');}return {name,results}},name)
      for(const row of result.results){assert.ok(row.editMs<2500,JSON.stringify(result));assert.ok(row.medianMs<16,JSON.stringify(result));assert.ok(row.lines<300);if(row.work){assert.ok(row.work.nodes<=6000);assert.ok(row.work.marks<=2000);assert.ok(row.work.ancestors<=16000);if(name!=='C#')assert.ok(row.marks>0,name+' parsed viewport')}}performanceResults.push(result)
    }
    await reset('Plain Text','('+ 'a'.repeat(1_000_000)+')','matching');const result=await page.evaluate(()=>{const start=performance.now();window.view.dispatch({selection:{anchor:1}});return {ms:performance.now()-start,marks:window.spans(window.f.matchingBrackets)}});assert.ok(result.ms<500);assert.equal(result.marks.length,0)
  })
  await test('real settings persist; tabs, shared panes and new documents receive the chosen mode',async()=>{
    await page.evaluate(()=>window.mountApp());await page.waitForFunction(()=>window.s?.settingsRef)
    await page.evaluate(async()=>{await window.doc('const x = ({a:[1]});');await window.s.manager.setLanguage(window.s.manager.activeId,'JavaScript');window.s.settingsRef.openSection('editor')})
    await page.locator('#settings-bracket-mode').getByRole('radio',{name:'彩虹括号',exact:true}).click();await page.waitForSelector('.mk-bracket-3');assert.equal(await page.evaluate(()=>window.s.bracketMode),'rainbow')
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').bracketMode==='rainbow');await page.evaluate(()=>window.s.settingsRef.close())
    const data=await page.evaluate(async()=>{const m=window.s.manager,id=m.activeId,view=m.activeEditorView;window.firstId=id;m.dispatch(id,{changes:{from:0,insert:'// edit\n'}});window.s.bracketMode='matching';await window.f.nextTick();m.command('undo');const undo=m.getText(id);m.command('redo');const redo=m.getText(id);window.s.bracketMode='rainbow';await window.f.nextTick();const same=m.activeEditorView===view;m.splitPane('right');await window.f.nextTick();return {same,undo,redo,snapshot:m.saveSnapshot(id).text,panes:m.layout.getAllLeafIds().length}})
    assert.equal(data.panes,2);assert.equal(data.snapshot,data.redo);assert.ok(!data.undo.startsWith('// edit'));assert.ok(data.redo.startsWith('// edit'));assert.equal(data.same,true)
    await page.waitForFunction(()=>document.querySelectorAll('.pane-body .mk-bracket-1').length>=4)
    await page.evaluate(async()=>{const m=window.s.manager;m.mergeAllPanes();await window.doc('call([2]);');await m.setLanguage(m.activeId,'JavaScript');m.open(window.firstId)});await page.waitForSelector('.mk-bracket-3')
    await page.reload();await page.waitForFunction(()=>window.f);await page.evaluate(()=>window.mountApp());await page.waitForFunction(()=>window.s?.bracketMode==='rainbow')
  })
  await test('live code blocks share the setting; switching language and editing retain CM and undo',async()=>{
    await page.evaluate(()=>window.doc('```javascript\ncall({a:[1]});\n```','md','live'));await page.waitForSelector('.md-code-block .mk-bracket-3')
    await page.evaluate(()=>window.codeCM=window.f.EditorView.findFromDOM(document.querySelector('.md-code-block .cm-editor')))
    await page.evaluate(()=>window.s.bracketMode='off');await page.waitForFunction(()=>!document.querySelector('.md-code-block [class*=mk-bracket-]'));assert.equal(await page.evaluate(()=>window.codeCM.plugin(window.f.rainbowBrackets)),null)
    await page.evaluate(()=>window.s.bracketMode='rainbow');await page.waitForSelector('.md-code-block .mk-bracket-3');assert.equal(await page.evaluate(()=>window.codeCM===window.f.EditorView.findFromDOM(document.querySelector('.md-code-block .cm-editor'))),true)
    await page.locator('.md-code-block .cm-content').click();await page.locator('.md-code-lang-btn').click();const input=page.getByRole('combobox',{name:/^搜索代码语言/});await input.fill('text');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('.md-code-block')?.dataset.languageStatus==='ready');assert.equal(await page.locator('.md-code-block [class*=mk-bracket-1]').count(),0)
    await page.locator('.md-code-lang-btn').click();await input.fill('json');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('.md-code-block')?.dataset.languageStatus==='ready');await page.evaluate(()=>window.codeCM.dispatch({changes:{from:0,to:window.codeCM.state.doc.length,insert:'{"items":[1]}'}}));await page.waitForSelector('.md-code-block .mk-bracket-2')
    await page.evaluate(()=>window.s.manager.command('undo'));await page.evaluate(()=>window.s.manager.command('redo'));assert.ok((await page.evaluate(()=>window.s.manager.getText(window.s.manager.activeId))).includes('"items"'))
  })
  await test('many live blocks switch mode without rebuilding views or accumulating plugins',async()=>{
    await page.evaluate(()=>window.doc(Array.from({length:40},(_,i)=>'```javascript\ncall({items:['+i+']});\n```').join('\n\n'),'md','live'))
    await page.waitForFunction(()=>document.querySelectorAll('.md-code-block .mk-bracket-3').length===80)
    const result=await page.evaluate(async()=>{const f=window.f,views=[...document.querySelectorAll('.md-code-block .cm-editor')].map(dom=>f.EditorView.findFromDOM(dom)),start=performance.now();for(let i=0;i<12;i++){window.s.bracketMode=i%2?'off':'rainbow';await f.nextTick()}return {elapsed:performance.now()-start,count:views.length,same:views.every((view,i)=>view===f.EditorView.findFromDOM(document.querySelectorAll('.md-code-block .cm-editor')[i])),clean:views.every(view=>!view.plugin(f.rainbowBrackets)&&!view.plugin(f.matchingBrackets))}})
    assert.equal(result.count,40);assert.equal(result.same,true);assert.equal(result.clean,true);assert.ok(result.elapsed<2500);performanceResults.push({name:'40 live code blocks / 12 toggles',...result})
    await page.evaluate(()=>window.s.bracketMode='rainbow')
  })
  await test('Hex, ClassFile and media viewers never receive bracket plugins',async()=>{
    const result=await page.evaluate(async()=>{const {DocumentManager}=await import('/src/editor/core/DocumentManager.ts'),f=window.f,m=new DocumentManager([{id:'class',name:'Sample.class',path:'/Sample.class',text:'class Fake {}',kind:'javaClass'}]);m.setBracketMode('rainbow');m.open('class');const file={kind:'text',token:'hex',name:'raw.dat',path:'/raw.dat',text:'([{}])',encoding:'Hex',bom:false,eol:'LF',readOnly:true,version:'1'},hex=m.openFile(file);m.setBracketMode('matching');m.setBracketMode('rainbow');const states=['class',hex].map(id=>{const host=document.createElement('div');document.body.append(host);const view=new f.EditorView({parent:host,state:m.getState(id)});const clean=!view.plugin(f.rainbowBrackets)&&!view.plugin(f.matchingBrackets);view.destroy();host.remove();return clean});const image=m.openFile({...file,token:'image',kind:'image',path:'/image.png',name:'image.png',media:{format:'png',byteLength:10}});const noState=m.getState(image)===undefined;m.dispose();return {states,noState}})
    assert.deepEqual(result,{states:[true,true],noState:true})
  })
  await test('IME composition maps marks without view replacement and setting changes settle safely',async()=>{
    await page.evaluate(async()=>{await window.doc('call({items:[1]});');await window.s.manager.setLanguage(window.s.manager.activeId,'JavaScript');const cm=window.s.manager.activeEditorView;window.imeView=cm;cm.focus();const target=cm.contentDOM.editContext||cm.contentDOM;target.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));cm.dispatch({changes:{from:6,insert:'汉'}});window.s.bracketMode='off';target.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'汉'}))})
    await page.waitForFunction(()=>!document.querySelector('[class*=mk-bracket-]'));assert.equal(await page.evaluate(()=>window.imeView===window.s.manager.activeEditorView),true);assert.ok((await page.evaluate(()=>window.s.manager.getText(window.s.manager.activeId))).includes('汉'))
  })
  await test('three modes have real App screenshots and repeated toggles release plugins',async()=>{
    await page.evaluate(async()=>{await window.doc('function read(items) {\n  // 括号层级与匹配\n  return items.map(item => ({\n    title: "string ([{}])",\n    values: [call(item, {enabled: true})]\n  }));\n}\n');await window.s.manager.setLanguage(window.s.manager.activeId,'JavaScript');window.s.theme='dark';window.s.syntaxStyle='soft';window.s.manager.activeEditorView.dispatch({selection:{anchor:19}})})
    for(const mode of ['off','matching','rainbow']){await page.evaluate(mode=>window.s.bracketMode=mode,mode);await page.waitForTimeout(80);await page.screenshot({path:`${output}/${mode}.png`})}
    const result=await page.evaluate(async()=>{const f=window.f,m=window.s.manager,v=m.activeEditorView,doc=v.state.doc,selection=v.state.selection;for(let i=0;i<60;i++){window.s.bracketMode=i%2?'off':'rainbow';window.s.syntaxStyle=['soft','standard','vivid'][i%3];await f.nextTick()}return {same:v===m.activeEditorView,text:doc===v.state.doc,selection:v.state.selection.eq(selection),rainbow:v.plugin(f.rainbowBrackets)===null,matching:v.plugin(f.matchingBrackets)===null}})
    assert.deepEqual(result,{same:true,text:true,selection:true,rainbow:true,matching:true})
  })
  await test('destroying rainbow views releases caches after pending CM measurement frames finish',async()=>{
    const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Runtime.getHeapUsage')
    await page.evaluate(async()=>{const f=window.f,{coreExtensions,editorTheme}=await import('/src/editor/core/extensions.ts'),language=await f.loadLanguage('JavaScript');for(let i=0;i<60;i++){const host=document.createElement('div');document.body.append(host);const view=new f.EditorView({parent:host,state:f.EditorState.create({doc:'call({items:[1,2,3]});',extensions:[coreExtensions,language,f.bracketHighlight('rainbow'),editorTheme('dark')]})});view.destroy();host.remove()}})
    await page.waitForTimeout(180);await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Runtime.getHeapUsage');await cdp.detach();const retained=after.usedSize-before.usedSize;assert.ok(retained<8_000_000);performanceResults.push({name:'60 rainbow views / destroy / GC',retainedBytes:retained})
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:tests.length,tests,performanceResults,errors},null,2))
  console.log(`PASS all ${tests.length} bracket regressions`)
}catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:`${output}/failure.png`})}throw error}
finally{await browser?.close();await server.close()}
