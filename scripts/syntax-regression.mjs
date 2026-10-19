import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'

const {chromium} = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/syntax-p1'
fs.mkdirSync(output, {recursive:true})
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><div id="gallery"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {EditorState,Compartment} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {LanguageSupport,syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {undo} from '@codemirror/commands';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {languageRegistry,detectLanguage,resolveLanguage,loadLanguage,createLanguageLoader} from '/src/editor/languages/index.ts';
import {markumoHighlight,markumoSyntax,applySyntaxStyle,syntaxStyles,syntaxRoles} from '/src/editor/core/syntaxTheme.ts';
import {syntaxSpans} from '/src/editor/core/syntaxSpans.ts';
import {coreExtensions,editorTheme} from '/src/editor/core/extensions.ts';
import {syntaxSamples} from '/scripts/fixtures/syntax-samples.mjs';
import {createMarkdownRenderer} from '/src/editor/markdown/rendering.ts';
import {createApp,nextTick} from 'vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';import '/src/editor/markdown/styles.css';
window.f={EditorState,EditorView,Compartment,LanguageSupport,syntaxTree,ensureSyntaxTree,undo,DocumentManager,languageRegistry,detectLanguage,resolveLanguage,loadLanguage,createLanguageLoader,markumoHighlight,markumoSyntax,applySyntaxStyle,syntaxStyles,syntaxRoles,syntaxSpans,coreExtensions,editorTheme,syntaxSamples,createMarkdownRenderer,nextTick};
window.views=[];
window.mountApp=async()=>{for(const view of window.views)view.destroy();window.views=[];document.getElementById('gallery').replaceChildren();const {default:App}=await import('/src/App.vue');const app=createApp(App);app.mount('#app');window.s=app._instance.setupState;return true};
window.doc=async(text,kind='txt',mode='source')=>{const m=window.s.manager;m.mergeAllPanes();m.createUntitled(kind);const id=m.activeId;m.dispatch(id,{changes:{from:0,to:m.getState(id).doc.length,insert:text},selection:{anchor:0}});if(kind==='md')m.setMarkdownMode(id,mode);await nextTick();return id};
`)
const port=Number(process.env.MARKUMO_TEST_PORT||1438)
const server = await createServer({optimizeDeps:{include:['@codemirror/legacy-modes/mode/pug']},server:{host:'127.0.0.1',port,strictPort:true}})
await server.listen()
let browser
const results=[], errors=[]
try {
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage({viewport:{width:1500,height:1050},reducedMotion:'reduce'})
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.text().includes('Unknown highlighting tag'))errors.push(message.text())})
  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(()=>window.f)
  const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
  const matrix=await page.evaluate(async()=>{
    const f=window.f, rows=[]
    for(const definition of f.languageRegistry){
      const example=f.syntaxSamples[definition.id]
      if(!example)throw Error('Missing registry example: '+definition.id)
      const source=definition.id==='php'?'<?php\n'+example.source:example.source
      const support=await f.loadLanguage(definition.name)
      const spans=support instanceof f.LanguageSupport?f.syntaxSpans(source,support):[]
      const roles=[...new Set(spans.flatMap(span=>span.classes.split(' ').map(name=>name.replace('mk-syntax-',''))))]
      const fenceSupport=await f.loadLanguage(definition.name,'fence')
      const fenceRoles=fenceSupport instanceof f.LanguageSupport?[...new Set(f.syntaxSpans(example.source,fenceSupport).flatMap(span=>span.classes.split(' ').map(name=>name.replace('mk-syntax-',''))))]:[]
      const fileChecks=[...definition.filenames,...definition.extensions.map(ext=>'sample.'+ext)].map(name=>({name,detected:f.detectLanguage(name.toUpperCase())}))
      const detected=definition.filenames.length?f.detectLanguage(definition.filenames[0].toUpperCase()):definition.extensions.length?f.detectLanguage('sample.'+definition.extensions[0].toUpperCase()):null
      const resolved=f.resolveLanguage(definition.id.toUpperCase())?.name
      const appearances=[]
      if(support instanceof f.LanguageSupport){
        const host=document.createElement('div');host.style.cssText='height:250px;width:900px';document.getElementById('gallery').append(host)
        const view=new f.EditorView({parent:host,state:f.EditorState.create({doc:source,extensions:[support,f.markumoSyntax,f.editorTheme('dark')]})})
        await new Promise(resolve=>requestAnimationFrame(resolve))
        for(const theme of ['dark','light']){
          f.applySyntaxStyle('soft');document.body.classList.toggle('light',theme==='light')
          const colored=Array.from(host.querySelectorAll('[class*=mk-syntax-]')).find(el=>Array.from(el.classList).some(name=>f.syntaxRoles.includes(name.replace('mk-syntax-',''))))
          const comments=Array.from(host.querySelectorAll('.mk-syntax-comment,.mk-syntax-doc-comment')).map(el=>({font:getComputedStyle(el).fontStyle,weight:getComputedStyle(el).fontWeight}))
          appearances.push({theme,highlighted:!!colored,comments})
        }
        view.destroy();host.remove()
      }
      if(support instanceof f.LanguageSupport){support.language.parser.parse(source.slice(0,Math.floor(source.length*.8)));support.language.parser.parse(source+'\n🙂 中文 incomplete "')}
      rows.push({id:definition.id,name:definition.name,parser:definition.parser,coverage:definition.coverage,highlights:definition.highlights,detected,resolved,loaded:support instanceof f.LanguageSupport,roles,fenceRoles,fileChecks,appearances,missing:example.roles.filter(role=>!roles.includes(role)||!fenceRoles.includes(role))})
    }
    return rows
  })
  fs.writeFileSync(`${output}/coverage-matrix.json`,JSON.stringify(matrix,null,2))
  await test('registry-driven language coverage: detection, load, representative tags and incomplete Unicode',async()=>{
    const missing=matrix.filter(row=>row.missing.length)
    console.log('Language matrix: '+matrix.length+' entries; missing roles: '+JSON.stringify(missing))
    for(const row of matrix){assert.equal(row.resolved,row.name,row.id);if(row.detected)assert.equal(row.detected,row.name,row.id);for(const check of row.fileChecks)assert.equal(check.detected,row.name,check.name);assert.equal(row.loaded,row.highlights,row.id);assert.deepEqual(row.missing,[],row.id);if(row.highlights)assert.ok(row.roles.length>=2,row.id);else assert.deepEqual(row.roles,[]);for(const appearance of row.appearances){assert.equal(appearance.highlighted,true,row.id);for(const comment of appearance.comments){assert.equal(comment.font,'normal',row.id);assert.equal(comment.weight,'400',row.id)}}}
  })
  await test('all semantic roles have six valid palettes; comments are neutral, normal and readable',async()=>{
    const palettes=await page.evaluate(()=>{
      const f=window.f,result=[];const host=document.getElementById('gallery')
      for(const style of f.syntaxStyles)for(const theme of ['dark','light']){
        f.applySyntaxStyle(style);document.body.classList.toggle('light',theme==='light')
        const colors=Object.fromEntries(f.syntaxRoles.map(role=>{const span=document.createElement('span');span.className='mk-syntax-'+role;host.append(span);const computed=getComputedStyle(span);const value={color:computed.color,fontStyle:computed.fontStyle,fontWeight:computed.fontWeight};span.remove();return [role,value]}))
        result.push({style,theme,colors,background:getComputedStyle(document.body).getPropertyValue('--editor').trim()})
      }
      return result
    })
    fs.writeFileSync(`${output}/palettes.json`,JSON.stringify(palettes,null,2))
    const luminance=hex=>{const match=hex.match(/[\da-f]{2}/gi);const c=match.map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722}
    for(const palette of palettes){for(const token of Object.values(palette.colors))assert.match(token.color,/^rgb\(/);for(const role of ['comment','doc-comment']){const token=palette.colors[role];assert.equal(token.fontStyle,'normal');assert.equal(token.fontWeight,'400');const rgb=token.color.match(/\d+/g).map(n=>Number(n).toString(16).padStart(2,'0')).join(''),a=luminance(rgb),b=luminance(palette.background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,JSON.stringify({palette:palette.style,theme:palette.theme,role}))}assert.notEqual(palette.colors.keyword.color,palette.colors.string.color);assert.notEqual(palette.colors.type.color,palette.colors.function.color)}
    for(const theme of ['dark','light'])assert.equal(new Set(palettes.filter(p=>p.theme===theme).map(p=>p.colors.keyword.color)).size,3)
  })
  await test('named-theme settings migrate back to the original three highlight choices',async()=>{
    const result=await page.evaluate(async()=>{const {settingsFrom,defaultSettings}=await import('/src/features/shell/editorSettings.ts');return {default:defaultSettings().syntaxStyle,styles:['soft','standard','vivid','fleet','fleet-dark','fleet-light','monokai-pro','monokai-classic','one-dark','github-dark','github-light','unknown'].map(syntaxStyle=>settingsFrom({syntaxStyle}).syntaxStyle)}});
    assert.deepEqual(result,{default:'soft',styles:['soft','standard','vivid','soft','soft','soft','vivid','vivid','standard','standard','standard','soft']});
  })
  await test('filename rules and existing manual selector aliases are unambiguous',async()=>{
    const result=await page.evaluate(()=>{const f=window.f;return Object.fromEntries(['Dockerfile','Dockerfile.dev','CONTAINERFILE.ci','Makefile','GNUmakefile','CMakeLists.txt','.bashrc','.zshrc','.bash_profile','Gemfile','TYPES.D.TS','view.TSX','view.JSX','.env','.env.local','.gitignore','.editorconfig','config.JSONC','graph.MMD','unknown.binary'].map(name=>[name,f.detectLanguage(name)]))})
    assert.deepEqual(result,{'Dockerfile':'Dockerfile','Dockerfile.dev':'Dockerfile','CONTAINERFILE.ci':'Dockerfile','Makefile':'Makefile','GNUmakefile':'Makefile','CMakeLists.txt':'CMake','.bashrc':'Shell','.zshrc':'Shell','.bash_profile':'Shell','Gemfile':'Ruby','TYPES.D.TS':'TypeScript','view.TSX':'TSX','view.JSX':'JSX','.env':'INI','.env.local':'INI','.gitignore':'Ignore','.editorconfig':'INI','config.JSONC':'JSONC','graph.MMD':'Mermaid','unknown.binary':'Plain Text'})
  })
  await test('JSON/JSONC keys, values, booleans and null remain distinct across escapes and comments',async()=>{
    for(const name of ['JSON','JSONC']){
      const roles=await page.evaluate(async name=>{const f=window.f,code='{ "key"\n: "中文 \\" quote #", "truth":true, "nil":null, "list":[false,12] }';const spans=f.syntaxSpans(code,await f.loadLanguage(name));return Object.fromEntries(['key','中文','true','null','false','12'].map(word=>[word,spans.find(s=>s.from<=code.indexOf(word)&&s.to>code.indexOf(word))?.classes]))},name)
      assert.equal(roles.key,'mk-syntax-property');assert.equal(roles['中文'],'mk-syntax-string');assert.equal(roles.true,'mk-syntax-boolean');assert.equal(roles.false,'mk-syntax-boolean');assert.equal(roles.null,'mk-syntax-null');assert.equal(roles['12'],'mk-syntax-number')
    }
  })
  await test('CSV quoted multiline fields and escaped quotes; log levels only in a real header',async()=>{
    const result=await page.evaluate(async()=>{const f=window.f,code='a,"x,y\n# INFO ""quote""",z\n';const spans=f.syntaxSpans(code,await f.loadLanguage('CSV'));const log='message contains ERROR and INFO\n2026-10-18 10:00:00 WARN careful\n';return {csv:spans.map(s=>({text:code.slice(s.from,s.to),class:s.classes})),log:f.syntaxSpans(log,await f.loadLanguage('Log')).map(s=>({text:log.slice(s.from,s.to),class:s.classes}))}})
    assert.ok(result.csv.filter(s=>s.class==='mk-syntax-string').some(s=>s.text.includes('# INFO')));assert.equal(result.csv.filter(s=>s.class==='mk-syntax-punctuation').length,2);assert.equal(result.log.some(s=>s.text.includes('ERROR')),false);assert.ok(result.log.some(s=>s.text==='WARN'&&s.class==='mk-syntax-annotation'))
  })
  await test('YAML scalar supplement is bounded to visible parsed values and ignores keys/string comments',async()=>{
    const result=await page.evaluate(async()=>{const f=window.f,host=document.getElementById('gallery');host.style.height='220px';host.style.overflow='hidden';const source=f.syntaxSamples.yaml.source+Array.from({length:10000},(_,i)=>'item'+i+': 42').join('\n');const view=new f.EditorView({parent:host,state:f.EditorState.create({doc:source,extensions:[await f.loadLanguage('YAML'),f.markumoSyntax,f.editorTheme('light')]})});f.ensureSyntaxTree(view.state,source.length,5000);await new Promise(r=>setTimeout(r,100));const numbers=host.querySelectorAll('.mk-syntax-number').length,comments=[...host.querySelectorAll('.mk-syntax-comment')].map(el=>el.textContent),keys=[...host.querySelectorAll('.mk-syntax-property')].map(el=>el.textContent),value=host.querySelector('.mk-syntax-number');const data={numbers,comments,keys,color:value&&getComputedStyle(value).color,expected:getComputedStyle(document.body).getPropertyValue('--syntax-number').trim()};view.destroy();host.replaceChildren();host.removeAttribute('style');return data})
    assert.ok(result.numbers<200);assert.ok(result.numbers>0);assert.ok(result.comments.every(text=>!text.includes('literal')&&!text.includes('content')));assert.ok(result.keys.includes('count'))
  })
  await test('six visual comparisons cover Markdown, TypeScript, Java, JSON, Vue and SQL',async()=>{
    await page.evaluate(async()=>{const f=window.f,g=document.getElementById('gallery');g.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:18px';for(const id of ['markdown','typescript','java','json','vue','sql']){const item=document.createElement('article');item.style.cssText='height:455px;min-width:0;border:1px solid var(--line);background:var(--editor);overflow:hidden';const title=document.createElement('h2');title.textContent=f.languageRegistry.find(l=>l.id===id).name;title.style.cssText='font:600 15px sans-serif;padding:12px;margin:0;background:var(--bar)';item.append(title);g.append(item);const view=new f.EditorView({parent:item,state:f.EditorState.create({doc:f.syntaxSamples[id].source,extensions:[f.coreExtensions,f.EditorView.lineWrapping,await f.loadLanguage(title.textContent),f.editorTheme('dark')]})});window.views.push(view)}document.documentElement.style.setProperty('--editor-size','14px')})
    for(const theme of ['dark','light'])for(const style of ['soft','standard','vivid']){await page.evaluate(({theme,style})=>{document.body.classList.toggle('light',theme==='light');window.f.applySyntaxStyle(style)}, {theme,style});await page.waitForTimeout(100);await page.screenshot({path:`${output}/${style}-${theme}.png`})}
    assert.ok(await page.locator('#gallery .mk-syntax-keyword').count()>0)
  })
  await test('shared Markdown preview and source highlighter produce the same function/type/JSON roles',async()=>{
    const result=await page.evaluate(async()=>{const f=window.f,md=f.createMarkdownRenderer();const source='```typescript\n'+f.syntaxSamples.typescript.source+'\n```\n```json\n'+f.syntaxSamples.json.source+'\n```\n```csv\na,"b,c"\n```';md.render(source);await new Promise(r=>setTimeout(r,150));return md.render(source)})
    for(const role of ['class','type','method','parameter','property','boolean','null'])assert.ok(result.includes('mk-syntax-'+role),role)
    assert.ok(result.includes('language-csv'));assert.ok(!result.includes('tok-keyword'))
  })
  await test('rapid language reconfiguration rejects stale results, clears old highlighting and permits retry',async()=>{
    const result=await page.evaluate(async()=>{const f=window.f,pending=[];const m=new f.DocumentManager([],name=>new Promise((resolve,reject)=>pending.push({name,resolve,reject})));const id=m.createUntitled();const initial=pending.shift();initial.resolve([]);await Promise.resolve();const a=m.setLanguage(id,'Java'),b=m.setLanguage(id,'TypeScript');pending.find(p=>p.name==='TypeScript').resolve(await f.loadLanguage('TypeScript'));await b;pending.find(p=>p.name==='Java').resolve(await f.loadLanguage('Java'));await a;const language=m.metadata(id).language;const fail=m.setLanguage(id,'JSON');pending.find(p=>p.name==='JSON').reject(Error('fixture'));await fail;const failed=[m.metadata(id).languageStatus,f.syntaxTree(m.getState(id)).type.name];pending.length=0;const retry=m.setLanguage(id,'JSON');pending[0].resolve(await f.loadLanguage('JSON'));await retry;const ready=m.metadata(id).languageStatus;m.dispose();return {language,failed,ready}})
    assert.equal(result.language,'TypeScript');assert.equal(result.failed[0],'error');assert.equal(result.ready,'ready')
  })
  await test('every registry parser can finish late without overwriting a newer plain-text intent',async()=>{
    const result=await page.evaluate(async()=>{const f=window.f,rows=[];for(const definition of f.languageRegistry.filter(l=>l.highlights)){let finish;const manager=new f.DocumentManager([],name=>name==='Plain Text'?Promise.resolve([]):new Promise(resolve=>finish=resolve));const id=manager.createUntitled();await Promise.resolve();const stale=manager.setLanguage(id,definition.name);await manager.setLanguage(id,'Plain Text');finish(await f.loadLanguage(definition.name));await stale;rows.push({name:definition.name,language:manager.metadata(id).language,empty:f.syntaxTree(manager.getState(id)).type.isAnonymous});manager.dispose()}return rows})
    for(const row of result){assert.equal(row.language,'Plain Text',row.name);assert.equal(row.empty,true,row.name)}
  })
  await test('real settings switch immediately, persist and keep main/embedded editor identity and undo',async()=>{
    await page.evaluate(()=>window.mountApp());await page.waitForFunction(()=>window.s?.settingsRef)
    await page.evaluate(async()=>{await window.doc(window.f.syntaxSamples.typescript.source);await window.s.manager.setLanguage(window.s.manager.activeId,'TypeScript')});await page.waitForSelector('.cm-content .mk-syntax-keyword')
    const before=await page.locator('.cm-content .mk-syntax-keyword').first().evaluate(el=>getComputedStyle(el).color)
    await page.evaluate(()=>{window.originalView=window.s.manager.activeEditorView;window.s.manager.dispatch(window.s.manager.activeId,{changes:{from:0,insert:'// edit\n'}});window.originalState=window.s.manager.getState(window.s.manager.activeId);window.s.settingsRef.openSection('appearance')})
    await page.locator('#settings-syntax-style').getByRole('radio',{name:'鲜明',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.s.syntaxStyle),'vivid');assert.notEqual(await page.locator('.cm-content .mk-syntax-keyword').first().evaluate(el=>getComputedStyle(el).color),before)
    assert.equal(await page.evaluate(()=>window.s.manager.activeEditorView===window.originalView&&window.s.manager.getState(window.s.manager.activeId)===window.originalState),true)
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').syntaxStyle==='vivid');await page.evaluate(()=>window.s.settingsRef.close())
    assert.equal(await page.evaluate(()=>{window.s.manager.command('undo');return window.s.manager.getText(window.s.manager.activeId).startsWith('// edit')}),false)
    await page.evaluate(()=>window.doc('```typescript\nconst title: string = "中文";\n```','md','live'));await page.waitForSelector('.md-code-block .cm-editor');await page.waitForSelector('.md-code-block .mk-syntax-keyword')
    await page.evaluate(()=>{window.embedded=window.f.EditorView.findFromDOM(document.querySelector('.md-code-block .cm-editor'));window.s.syntaxStyle='soft';window.s.theme='dark'})
    const dark=await page.locator('.md-code-block .mk-syntax-keyword').first().evaluate(el=>getComputedStyle(el).color)
    await page.evaluate(()=>{window.s.syntaxStyle='standard';window.s.theme='light'})
    assert.notEqual(await page.locator('.md-code-block .mk-syntax-keyword').first().evaluate(el=>getComputedStyle(el).color),dark);assert.equal(await page.evaluate(()=>window.embedded===window.f.EditorView.findFromDOM(document.querySelector('.md-code-block .cm-editor'))),true)
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').syntaxStyle==='standard');await page.reload();await page.waitForFunction(()=>window.f);await page.evaluate(()=>window.mountApp());await page.waitForFunction(()=>window.s?.syntaxStyle==='standard');assert.equal(await page.evaluate(()=>document.body.dataset.syntaxStyle),'standard')
  })
  await test('source/split/live panes share palette, language changes drop the old parser, and copies remain raw',async()=>{
    await page.evaluate(()=>window.doc('```json\n{"名字":"你好", "enabled":true}\n```','md','split'));await page.waitForSelector('.split-preview-content .mk-syntax-property')
    await page.waitForSelector('.cm-content .mk-syntax-property')
    const colors=await page.evaluate(()=>({source:getComputedStyle(document.querySelector('.cm-content .mk-syntax-property')).color,preview:getComputedStyle(document.querySelector('.split-preview-content .mk-syntax-property')).color,text:document.querySelector('.split-preview-content pre code').textContent}));assert.equal(colors.source,colors.preview);assert.ok(colors.text.includes('"名字":"你好"'))
    await page.evaluate(()=>{const m=window.s.manager;m.splitPane('right');m.setMarkdownMode(m.activeId,'live')});await page.waitForSelector('.md-code-block .mk-syntax-boolean')
    await page.evaluate(()=>{window.s.syntaxStyle='vivid';window.s.theme='dark'});const all=await page.locator('.mk-syntax-property').evaluateAll(elements=>[...new Set(elements.map(el=>getComputedStyle(el).color))]);assert.equal(all.length,1)
  })
  await test('YAML fences keep number/boolean/null roles in Markdown source and embedded editors',async()=>{
    await page.evaluate(()=>window.doc('```yaml\ncount: 42\nenabled: true\nempty: null\n```','md','source'))
    await page.waitForSelector('.cm-content .mk-syntax-number');await page.waitForSelector('.cm-content .mk-syntax-boolean');await page.waitForSelector('.cm-content .mk-syntax-null')
    await page.evaluate(()=>window.s.manager.setMarkdownMode(window.s.manager.activeId,'live'))
    await page.waitForSelector('.md-code-block .mk-syntax-number');await page.waitForSelector('.md-code-block .mk-syntax-boolean');await page.waitForSelector('.md-code-block .mk-syntax-null')
  })
  await test('changing the live code-block language clears old tokens without replacing its CM view',async()=>{
    await page.evaluate(()=>window.doc('```json\n{"key":true,"value":42}\n```','md','live'));await page.waitForSelector('.md-code-block .mk-syntax-boolean')
    await page.evaluate(()=>window.switchingCodeView=window.f.EditorView.findFromDOM(document.querySelector('.md-code-block .cm-editor')))
    await page.locator('.md-code-block .cm-content').click();await page.locator('.md-code-lang-btn').click();const input=page.getByRole('combobox',{name:/^搜索代码语言/});await input.fill('text');await input.press('Enter')
    await page.waitForFunction(()=>document.querySelector('.md-code-block')?.dataset.languageStatus==='ready');assert.equal(await page.locator('.md-code-block [class*=mk-syntax-]').count(),0);assert.equal(await page.evaluate(()=>window.switchingCodeView===window.f.EditorView.findFromDOM(document.querySelector('.md-code-block .cm-editor'))),true)
    await page.locator('.md-code-lang-btn').click();await input.fill('java');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('.md-code-block')?.dataset.languageStatus==='ready')
    await page.evaluate(()=>{const cm=window.switchingCodeView;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'class Demo { int count = 42; }'}})});await page.waitForSelector('.md-code-block .mk-syntax-class');assert.ok((await page.evaluate(()=>window.s.manager.getText(window.s.manager.activeId))).includes('```java'))
  })
  await test('static exports snapshot all six palettes and preserve selectable raw code',async()=>{
    for(const theme of ['dark','light'])for(const style of ['soft','standard','vivid']){
      const data=await page.evaluate(async({theme,style})=>{window.f.applySyntaxStyle(style);document.body.classList.toggle('light',theme==='light');const {renderMarkdownForExport}=await import('/src/features/document-conversion/ExportRenderer.ts'),{buildCompleteHtml}=await import('/src/features/document-conversion/ExportStyles.ts');const code='{"名字":"你好", "enabled":true}\n';const rendered=await renderMarkdownForExport('```json\n'+code+'```',undefined,false,false);const probe=document.createElement('span');probe.className='mk-syntax-property';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return {color,code,html:buildCompleteHtml('Syntax export',rendered.bodyHtml,true)}},{theme,style})
      const exported=await browser.newPage();try{await exported.setContent(data.html);assert.equal(await exported.locator('.mk-syntax-property').first().evaluate(el=>getComputedStyle(el).color),data.color);assert.equal(await exported.locator('pre code').textContent(),data.code)}finally{await exported.close()}
    }
  })
  await test('plain text, unknown language fallback and read-only Hex/Class/media stay unhighlighted',async()=>{
    const result=await page.evaluate(async()=>{const f=window.f,m=new f.DocumentManager([{id:'class',name:'Sample.class',path:'/Sample.class',text:'class Fake {}',kind:'javaClass'}]);m.open('class');await m.setLanguage('class','Java');const binary=[m.metadata('class').language,f.syntaxTree(m.getState('class')).length];const file={kind:'text',token:'hex',name:'raw.dat',path:'/raw.dat',text:'CA FE BA BE',encoding:'Hex',bom:false,eol:'LF',readOnly:true,version:'1'};const id=m.openFile(file);await m.setLanguage(id,'Java');const hex=m.metadata(id).language;const media=m.openFile({...file,path:'/image.png',name:'image.png',token:'image',kind:'image',media:{format:'png',byteLength:10}});const image=m.getState(media);m.dispose();return {binary,hex,image:image===undefined,unknown:f.detectLanguage('unknown.zzzz')}})
    assert.equal(result.binary[0],'Plain Text');assert.equal(result.hex,'Plain Text');assert.equal(result.image,true);assert.equal(result.unknown,'Plain Text')
  })
  await test('large JSON/log/SQL stay viewport bounded across style changes and long scrolling',async()=>{
    for(const language of ['JSON','Log','SQL']){
      const data=await page.evaluate(async language=>{const f=window.f,m=window.s.manager;await window.doc(language==='JSON'?'[\n'+Array.from({length:10000},(_,i)=>'{"id":'+i+',"name":"中文"}').join(',\n')+'\n]':Array.from({length:10000},()=>language==='Log'?'2026-10-18 10:00:00 INFO 服务正常':'SELECT name FROM users WHERE id = 42;').join('\n'));const started=performance.now();await m.setLanguage(m.activeId,language);await new Promise(r=>setTimeout(r,80));const view=m.activeEditorView;view.scrollDOM.scrollTop=view.scrollDOM.scrollHeight;await new Promise(r=>setTimeout(r,80));const before=view.state;for(let i=0;i<30;i++)f.applySyntaxStyle(f.syntaxStyles[i%3]);return {elapsed:performance.now()-started,nodes:view.dom.querySelectorAll('.cm-line').length,same:view.state===before}},language)
      assert.ok(data.elapsed<10000,language);assert.ok(data.nodes<250,language);assert.equal(data.same,true)
    }
  })
  await test('repeated theme switching and editor teardown retain neither history states nor listeners',async()=>{
    const cdp=await page.context().newCDPSession(page)
    // One collectGarbage can leave a partially reclaimed heap, so a single sample
    // reflects GC timing rather than retained editor state. Collect until two
    // consecutive samples agree before reporting the used size.
    const settledHeap=async()=>{let previous=-1;for(let round=0;round<6;round++){await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(120);const used=(await cdp.send('Runtime.getHeapUsage')).usedSize;if(previous>=0&&Math.abs(used-previous)<64*1024)return used;previous=used}return previous}
    const before=await settledHeap()
    await page.evaluate(async()=>{const f=window.f,support=await f.loadLanguage('TypeScript');for(let i=0;i<60;i++){const host=document.createElement('div');document.body.append(host);const view=new f.EditorView({parent:host,state:f.EditorState.create({doc:f.syntaxSamples.typescript.source,extensions:[support,f.markumoSyntax]})});const state=view.state;for(const style of f.syntaxStyles)f.applySyntaxStyle(style);if(view.state!==state)throw Error('Style switch replaced state');view.destroy();host.remove()}})
    const after=await settledHeap();assert.ok(after-before<8_000_000,JSON.stringify({before,after}));await cdp.detach()
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:results.length,tests:results,errors},null,2))
  console.log('PASS all '+results.length+' syntax regressions; '+matrix.length+' registry entries')
} catch(error) {
  if(browser){const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:`${output}/failure.png`})}
  throw error
} finally {await browser?.close();await server.close()}
