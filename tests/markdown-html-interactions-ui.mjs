import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {chromium,browserOptions} from './helpers/markdown-browser.mjs'
const output='test-results/markdown-html-interactions'
await mkdir(output,{recursive:true})
const pixel=[...await readFile('public/favicon.png')]
await writeFile(`${output}/fixture.html`,'<!doctype html><meta charset="utf-8"><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./fixture.ts"></script>')
await writeFile(`${output}/fixture.ts`,`
import {createApp,h,ref} from 'vue';import {EditorView as CMView} from '@codemirror/view';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {markdownResources} from '/src/editor/markdown/images.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/editor/markdown/styles.css';
const manager=new DocumentManager([{id:'md',name:'interactions.md',path:'interactions.md',text:'# start'},{id:'txt',name:'plain.txt',text:'plain text'}]);manager.open('md',false);
manager.getState('md').facet(markdownResources).loadLocal=async path=>{await new Promise(r=>setTimeout(r,60));if(path.includes('missing'))throw new Error('<img src=x onerror="window.pwned=1">');return new Uint8Array(${JSON.stringify(pixel)})};
const revision=ref(0);manager.subscribe(()=>revision.value++);window.fixture={manager,live:(pane='main')=>manager.liveViews.get(pane)?.editor,cm:el=>CMView.findFromDOM(el)};
document.body.classList.add('light');createApp({render(){revision.value;return h(EditorContainer,{doc:manager.activeDocument,manager,showOutline:true,desktop:false})}}).mount('#app');`)
const browser=await chromium.launch(browserOptions),page=await browser.newPage({viewport:{width:1100,height:900}}),results=[],errors=[],requests=[]
page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(12000);
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('untrusted.invalid'))requests.push(request.url())})
const raw=()=>page.evaluate(()=>window.fixture.manager.getText('md'))
async function source(text){await page.evaluate(text=>{const m=window.fixture.manager;m.focusPane('main',false);m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:text}})},text);await page.waitForTimeout(80)}
async function test(name,run){console.log(`RUN ${name}`);await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function replaceHtml(locator,text){await locator.click();await page.keyboard.press('Control+a');await page.keyboard.insertText(text);await page.waitForTimeout(60)}
try{
 await page.goto((process.env.LIGHTEDIT_TEST_URL||'http://127.0.0.1:1422')+`/${output}/fixture.html`);await page.locator('.md-prose').waitFor()
 await test('Image border defaults on actual Markdown and HTML pixels, toggles immediately in both themes and Split',async()=>{
  await source('![image](a.png)\n\n<img src="b.png" width="40">')
  await page.waitForFunction(()=>[...document.querySelectorAll('.md-prose img:not(.ProseMirror-separator)')].length===2&&[...document.querySelectorAll('.md-prose img:not(.ProseMirror-separator)')].every(img=>img.naturalWidth))
  const borders=()=>page.locator('.md-prose img:not(.ProseMirror-separator)').evaluateAll(imgs=>imgs.map(img=>({width:getComputedStyle(img).borderTopWidth,radius:getComputedStyle(img).borderTopLeftRadius})))
  assert.deepEqual(await borders(),[{width:'1px',radius:'4px'},{width:'1px',radius:'4px'}])
  await page.evaluate(()=>document.body.classList.remove('light'));assert.equal((await borders())[0].width,'1px')
  await page.screenshot({path:`${output}/border-dark.png`})
  await page.evaluate(()=>{const m=window.fixture.manager;m.setMarkdownTypography({...m.getMarkdownTypography(),imageBorder:false})})
  assert.ok((await borders()).every(x=>x.width==='0px'))
  await page.evaluate(()=>{const m=window.fixture.manager;m.setMarkdownMode('md','split')})
  await page.locator('.split-preview-content img').first().waitFor()
  assert.equal(await page.locator('.split-preview-content img').first().evaluate(img=>getComputedStyle(img).borderTopWidth),'0px')
  await page.evaluate(()=>{const m=window.fixture.manager;m.setMarkdownTypography({...m.getMarkdownTypography(),imageBorder:true})})
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.split-preview-content img')).borderTopWidth==='1px')
  await page.evaluate(()=>{document.body.classList.add('light');window.fixture.manager.setMarkdownMode('md','live')})
  assert.equal(await raw(),'![image](a.png)\n\n<img src="b.png" width="40">')
 })
 await test('Image center/edges select full syntax end for duplicate, Unicode, title, quote/list/table images',async()=>{
  const samples=['![😀中文](<assets/中文 图片.png> "完整 title")','> ![quote](a.png "title")','- ![list](b.png)','| a | b |\n| - | - |\n| ![table](c.png) | ![other](d.png) |','![same](x.png) ![same](x.png)']
  for(const text of samples){
   await source(text);const images=page.locator('.md-live-image img');await images.first().waitFor()
   for(let i=0;i<await images.count();i++)for(const edge of ['center','left','right']){
    await page.locator('.outline-head').click();await page.waitForTimeout(100);const img=images.nth(i);await img.waitFor();await img.scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.md-live-image img')].every(img=>img.naturalWidth))
    const box=await img.boundingBox();await page.mouse.click(box.x+(edge==='left'?0.5:edge==='right'?box.width-0.5:box.width/2),box.y+box.height/2)
    const selected=await page.evaluate(()=>{const f=window.fixture,e=f.live().inlineSource;return {native:e?.selection(),source:e?.sourceTo,raw:e?.input.textContent,canonical:f.manager.getState('md').selection.main.toJSON()}})
    assert.ok(selected.raw?.startsWith('!['),JSON.stringify(selected));assert.equal(selected.native.head,selected.raw.length);assert.equal(selected.native.anchor,selected.raw.length)
    assert.deepEqual(selected.canonical,{anchor:selected.source,head:selected.source})
    assert.equal(await raw(),text)
   }
  }
  await source('before\n\n![图](a.png "标题")\n\nafter');await page.locator('.md-live-image img').click()
  const local=page.getByRole('textbox',{name:'图片局部源码',exact:true});await local.fill('![图](b.png "标题")');await page.locator('.outline-head').click();assert.ok((await raw()).includes('b.png'))
  await page.evaluate(()=>window.fixture.manager.command('undo'));assert.ok((await raw()).includes('a.png'))
  await page.evaluate(()=>window.fixture.manager.command('redo'));assert.ok((await raw()).includes('b.png'))
  await page.screenshot({path:`${output}/image-end-and-border.png`})
 })
 await test('ATX/Setext and HTML H1-H6 render and Outline navigates/collapses without including fenced HTML',async()=>{
  const text=Array.from({length:6},(_,i)=>`${'#'.repeat(i+1)} MD${i+1}`).join('\n\n')+'\n\nSetext H1\n===\n\nSetext H2\n---\n\n'+Array.from({length:6},(_,i)=>`<h${i+1}>HTML${i+1} <em>中文</em></h${i+1}>`).join('\n\n')+'\n\n```html\n<h1>FENCED</h1>\n```'
  await source(text);assert.equal(await page.locator('.outline-item').count(),14)
  for(let level=1;level<=6;level++)assert.equal(await page.locator(`.md-html-preview h${level}`).count(),1)
  await page.locator('.outline-item').filter({hasText:'HTML6 中文'}).click()
  assert.equal(await page.evaluate(()=>{const m=window.fixture.manager;return m.getState('md').doc.lineAt(m.getState('md').selection.main.head).text}),'<h6>HTML6 <em>中文</em></h6>')
  const parent=page.locator('.outline-item').filter({hasText:'HTML1 中文'});await parent.locator('.outline-fold').click();assert.equal(await page.locator('.outline-item').count(),9)
  await parent.locator('.outline-fold').click();assert.equal(await page.locator('.outline-item').count(),14)
  await page.screenshot({path:`${output}/heading-outline.png`})
 })
 await test('Newly typed HTML heading and closed inline tags render through local changes',async()=>{
  await source('BEFORE\n\n');await page.locator('.md-prose p').last().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.insertText('<h1>输入标题</h1>');await page.keyboard.press('Enter')
  assert.equal(await page.locator('.md-html-preview h1').innerText(),'输入标题');assert.ok((await raw()).includes('<h1>输入标题</h1>'))
  await page.keyboard.insertText('inline <span style="color:red">红色文本</span>');await page.waitForTimeout(80)
  assert.equal(await page.locator('.md-html-inline-content span').innerText(),'红色文本');assert.ok((await raw()).includes('<span style="color:red">红色文本</span>'))
  await source('**bold** [link](url "title") <kbd>Ctrl</kbd> tail')
  await page.locator('.md-prose p').click({position:{x:450,y:10}});await page.keyboard.press('End');await page.keyboard.insertText(' <span style="color:red">第二处</span>');await page.waitForTimeout(60)
  assert.equal(await page.locator('.md-html-inline-content span').innerText(),'第二处')
  assert.ok((await raw()).includes('**bold** [link](url "title") <kbd>Ctrl</kbd>'))

 })
 await test('Local HTML CM preserves raw attrs/Markdown/entities, writes immediately, shared undo/redo and blur/keyboard exit',async()=>{
  const original='**prefix** <span data-note="中文" title="属性">**body** &amp; \\*x\\*</span> [link](url "title")\n\n<h1 data-title="原始">标题</h1>\n\nafter'
  await source(original)
  await page.locator('.md-html-inline-content').click();const inline=page.getByRole('textbox',{name:'HTML 局部源码'});await inline.waitFor()
  assert.ok((await inline.boundingBox()).height<100,'inline editor must not inherit document height')
  const replacement='<span data-note="中文" title="属性">**新文** &amp; \\*x\\*</span>'
  await replaceHtml(inline,replacement)
  assert.equal(await raw(),original.replace('<span data-note="中文" title="属性">**body** &amp; \\*x\\*</span>',replacement))
  await page.keyboard.press('Escape');assert.equal(await inline.count(),0)
  await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),original)
  await page.evaluate(()=>window.fixture.manager.command('redo'));assert.ok((await raw()).includes('**新文**'))
  await page.locator('.md-html-preview h1').click();const block=page.getByRole('textbox',{name:'HTML 局部源码'})
  await replaceHtml(block,'<h1 data-title="原始">新标题</h1>');assert.ok((await raw()).includes('新标题'))
  await page.keyboard.press('Enter');assert.equal(await block.count(),0);await page.keyboard.insertText('following paragraph')
  assert.ok((await raw()).includes('</h1>\n\nfollowing paragraph'))
  await page.locator('.md-html-block-view').focus();await page.keyboard.press('F2');await block.waitFor();await page.keyboard.press('Control+Enter');assert.equal(await block.count(),0)
  await page.screenshot({path:`${output}/html-local-edited.png`})
 })
 await test('Incomplete HTML remains editable without losing content and re-renders on blur',async()=>{
  await source('before <span title="属性">原文</span> after')
  await page.locator('.md-html-inline-content').click();const editor=page.getByRole('textbox',{name:'HTML 局部源码'})
  await page.keyboard.press('End');await page.keyboard.press('Backspace');assert.equal(await raw(),'before <span title="属性">原文</span after')
  await page.keyboard.insertText('>');assert.equal(await raw(),'before <span title="属性">原文</span> after')
  await page.locator('.outline-head').click();assert.equal(await editor.count(),0);assert.equal(await page.locator('.md-html-inline-content span').innerText(),'原文')
 })
 await test('Details normal click toggles; Ctrl-click edits; HTML img opens local CM at tag end',async()=>{
  await source('<details><summary>展开</summary>隐藏内容</details>\n\n<img src="a.png" title="中文" width="40">')
  const details=page.locator('.md-html-preview details');await details.locator('summary').click();assert.equal(await details.getAttribute('open'),'');assert.equal(await page.getByRole('textbox',{name:'HTML 局部源码'}).count(),0)
  await details.locator('summary').click({modifiers:['Control']});await page.getByRole('textbox',{name:'HTML 局部源码'}).waitFor();await page.keyboard.press('Escape')
  await page.locator('.md-html-preview img').click();const selected=await page.evaluate(()=>{const f=window.fixture;const dom=document.querySelector('.md-html-source-editor .cm-editor');const cm=f.cm(dom);return{head:cm.state.selection.main.head,length:cm.state.doc.length,canonical:f.manager.getState('md').selection.main.head}})
  assert.equal(selected.head,selected.length);assert.equal(selected.canonical,(await raw()).length)
  const nested='<div><img src="first.png" title="第一张"><img src="second.png" title="第二张"></div>'
  await source(nested);await page.locator('.md-html-preview img').first().click()
  const caret=await page.evaluate(()=>window.fixture.manager.getState('md').selection.main.head)
  assert.equal(caret,nested.indexOf('<img src="second.png"'))
  await page.keyboard.press('Escape')

 })
 await test('Two panes map unrelated HTML edits and invalidate overlapping/deleted old editors',async()=>{
  await source('before\n\n<div title="x">HTML</div>\n\nafter')
  await page.evaluate(()=>window.fixture.manager.splitEditor());await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
  const main=page.locator('.main-pane'),other=page.locator('.editor-pane').filter({hasNot:page.locator('.main-pane')})
  await main.locator('.md-html-preview').click();await main.getByRole('textbox',{name:'HTML 局部源码'}).waitFor()
  await page.evaluate(()=>{const m=window.fixture.manager,v=[...m.liveViews.entries()].find(([p])=>p!=='main')[1].editor.view;v.dispatch(v.state.tr.insertText('远端',1))})
  await replaceHtml(main.getByRole('textbox',{name:'HTML 局部源码'}),'<div title="x">本地</div>');assert.ok((await raw()).startsWith('远端before'));assert.ok((await raw()).includes('本地'))
  await page.evaluate(()=>{const m=window.fixture.manager,v=[...m.liveViews.entries()].find(([p])=>p!=='main')[1].editor.view;let at;v.state.doc.descendants((n,p)=>{if(n.attrs.source?.includes('本地'))at=p});const n=v.state.doc.nodeAt(at);v.dispatch(v.state.tr.setNodeMarkup(at,undefined,{...n.attrs,source:'<div>远端覆盖</div>'}))})
  assert.equal(await main.getByRole('textbox',{name:'HTML 局部源码'}).count(),0);assert.ok((await raw()).includes('远端覆盖'))
  await main.locator('.md-html-preview').click();await page.evaluate(()=>{const m=window.fixture.manager,v=[...m.liveViews.entries()].find(([p])=>p!=='main')[1].editor.view;let at;v.state.doc.descendants((n,p)=>{if(n.attrs.source?.includes('远端覆盖'))at=p});v.dispatch(v.state.tr.delete(at,at+v.state.doc.nodeAt(at).nodeSize))})
  assert.equal(await main.getByRole('textbox',{name:'HTML 局部源码'}).count(),0);assert.ok(!(await raw()).includes('div'))
  await page.evaluate(()=>{const m=window.fixture.manager;const pane=[...m.liveViews.keys()].find(p=>p!=='main');m.closePane(pane);m.focusPane('main',false)})
 })
 await test('YAML ↔ HTML ↔ formula renderer transitions use the correct NodeView',async()=>{
  await source('---\ntitle: first\n---\n\nafter')
  assert.equal(await page.locator('.md-yaml-preview').count(),1)
  await source('<h1>HTML replacement</h1>\n\nafter')
  assert.equal(await page.locator('.md-html-preview h1').innerText(),'HTML replacement');assert.equal(await page.locator('.md-yaml-preview').count(),0)
  await source('$$\nx^2\n$$\n\nafter');await page.locator('.katex-display').waitFor();assert.equal(await page.locator('.md-html-block-view').count(),0)
  await source('<h2>HTML restored</h2>\n\nafter');assert.equal(await page.locator('.md-html-preview h2').innerText(),'HTML restored')
  await source('---\ntitle: restored\n---\n\nafter');assert.equal(await page.locator('.md-yaml-preview').innerText(),'title: restored');assert.equal(await page.locator('.md-html-block-view').count(),0)
 })
 await test('Synthetic composition defers remote HTML sync until composition settles',async()=>{
  await source('before\n\n<div>原文</div>\n\nafter')
  await page.locator('.md-html-preview').click();const editor=page.getByRole('textbox',{name:'HTML 局部源码'})
  await editor.dispatchEvent('compositionstart',{data:''})
  await page.evaluate(()=>{const m=window.fixture.manager;m.dispatch('md',{changes:{from:0,insert:'远端'}})})
  assert.ok((await raw()).startsWith('远端before'))
  await editor.dispatchEvent('compositionend',{data:'中文'})
  await page.waitForTimeout(100)
  assert.ok((await raw()).startsWith('远端before'));assert.ok((await raw()).includes('<div>原文</div>'))
  await page.locator('.outline-head').click();assert.equal(await editor.count(),0)
 })
 await test('HTML sanitizer blocks active content, remote auto-fetch, error-message injection; static SVG and raw fallbacks retained',async()=>{
  await source('<div><img src="https://untrusted.invalid/pixel.png" onerror="window.pwned=1"><img src="missing.png"><a href="javascript:window.pwned=1">bad</a><svg width="40" height="20"><rect width="40" height="20" fill="green" onload="window.pwned=1"/></svg></div>\n\n<video src="https://untrusted.invalid/video">fallback</video>\n\n<custom-tag data-x="属性">未知内容</custom-tag>\n\n<script>window.pwned=1</script>')
  await page.waitForTimeout(150)
  assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>window.pwned),undefined)
  assert.equal(await page.locator('.md-prose script,.md-prose iframe,.md-prose video,.md-prose [onerror],.md-prose [onload],.md-prose a[href^="javascript:"]').count(),0)
  assert.equal(await page.locator('.md-html-preview svg rect').count(),1)
  assert.ok((await page.locator('.md-html-image-error').innerText()).includes('<img src=x onerror='));assert.equal(await page.locator('.md-html-image-error img').count(),0)
  assert.ok((await page.locator('.md-html-raw-fallback').allTextContents()).some(x=>x.includes('<custom-tag data-x="属性">未知内容</custom-tag>')))
  await page.screenshot({path:`${output}/safe-html.png`})
 })
 await test('Async Mermaid → image → HTML/Markdown heading → SQL stays in flow after render, resize, scrolling and panes',async()=>{
  const text='# Layout\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n![图](a.png)\n\n<h1>HTML heading</h1>\n\n## Markdown heading\n\n```sql\nSELECT 1;\n```\n\nafter'
  await source(text);await page.locator('.md-diagram svg').waitFor();await page.waitForFunction(()=>document.querySelector('.md-live-image img')?.naturalWidth)
  const measure=()=>page.locator('.md-prose').evaluateAll(panes=>panes.map(pane=>[...pane.children].map(el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height}})))
  const check=async()=>{for(const blocks of await measure())for(let i=1;i<blocks.length;i++)assert.ok(blocks[i].top>=blocks[i-1].bottom-1,JSON.stringify(blocks))}
  await check();await page.setViewportSize({width:786,height:694});await check();await page.screenshot({path:`${output}/adjacent-small.png`})
  await page.evaluate(()=>window.fixture.manager.splitEditor());await page.waitForFunction(()=>document.querySelectorAll('.md-diagram svg').length===2);await check()
  await page.locator('.markdown-live').first().evaluate(el=>el.scrollTop=el.scrollHeight);await check()
  await page.screenshot({path:`${output}/adjacent-panes.png`})
  await page.evaluate(()=>{const m=window.fixture.manager;m.closePane([...m.liveViews.keys()].find(p=>p!=='main'));m.focusPane('main',false)})
  await page.setViewportSize({width:1100,height:900});assert.equal(await raw(),text)
 })
 await test('Long document typing preserves unrelated DOM, rapid scroll and generic plain-text editor',async()=>{
  const text=Array.from({length:400},(_,i)=>`段落 ${i} 中文 **加粗** [link](url)`).join('\n\n')+'\n\n```sql\nSELECT 1;\n```'
  await source(text);await page.evaluate(()=>window.retainedSql=document.querySelector('.md-code-block .cm-editor'))
  const start=Date.now();await page.locator('.md-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('快速输入😀中文');assert.ok((await raw()).startsWith('快速输入😀中文'))
  assert.ok(Date.now()-start<3000);assert.equal(await page.evaluate(()=>window.retainedSql===document.querySelector('.md-code-block .cm-editor')),true)
  await page.locator('.markdown-live').evaluate(el=>{for(let i=0;i<25;i++)el.scrollTop=i*250});assert.ok((await raw()).endsWith('SELECT 1;\n```'))
  await page.evaluate(()=>window.fixture.manager.open('txt',false));const plain=page.getByRole('textbox',{name:'文本编辑器',exact:true});await plain.waitFor();await plain.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' changed');assert.equal(await page.evaluate(()=>window.fixture.manager.getText('txt')),'plain text changed')
 })
 assert.deepEqual(errors,[])
}catch(error){await page.screenshot({path:`${output}/failure.png`});console.error({errors,source:(await raw()).slice(0,300)});throw error}finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors,requests},null,2));await browser.close()}
