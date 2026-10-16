import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'
import { selectCodeLanguage } from './helpers/code-language.mjs'
const output='test-results/markdown-wysiwyg';await mkdir(output,{recursive:true})
const markdown=await readFile('tests/fixtures/markdown-wysiwyg.md','utf8')
const fixtureModule=`fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`,`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:850px;display:flex;flex-direction:column"></div><script type="module" src="./${fixtureModule}"></script></body></html>`)
await writeFile(`${output}/${fixtureModule}`, `
import {createApp,h,ref} from 'vue';import {DocumentManager} from '/src/editor/core/DocumentManager.ts';import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';import {textClipboard} from '/src/features/shell/clipboard.ts';
import {StateEffect,EditorState} from '@codemirror/state';
const manager=new DocumentManager([{id:'md',name:'fixture.md',path:'fixture.md',text:${JSON.stringify(markdown)}},{id:'txt',name:'plain.txt',path:'plain.txt',text:'plain text'}]);manager.open(location.search.includes('plain')?'txt':'md',false);
const revision=ref(0);manager.subscribe(()=>revision.value++);window.fixture={manager,StateEffect,EditorState,live:()=>manager.liveViews.get('main')?.editor,view:()=>manager.liveViews.get('main')?.editor.view,copied:''};textClipboard.writeText=async text=>{window.fixture.copied=text};
createApp({render(){revision.value;return h(EditorContainer,{doc:manager.activeDocument,manager,showOutline:false,desktop:false})}}).mount('#app');
`)
const browser=await chromium.launch(browserOptions),page=await browser.newPage({viewport:{width:1280,height:900}}),results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
const raw=()=>page.evaluate(()=>window.fixture.manager.saveSnapshot('md')?.text)
try{
  await page.goto((process.env.LIGHTEDIT_TEST_URL||'http://127.0.0.1:1422')+`/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()
  await test('PM Live is editable; no document CM, no pin; opening and switching preserves all source',async()=>{
    assert.equal(await page.locator('.editor-host>.cm-editor').count(),0);assert.equal(await page.locator('.pin-icon').count(),0)
    assert.equal(await raw(),markdown.replace(/\r\n/g,'\n'))
    for(let i=0;i<10;i++)for(const mode of ['source','split','live']){await page.evaluate(mode=>window.fixture.manager.setMarkdownMode('md',mode),mode);if(mode==='live')await page.locator('.md-prose').waitFor();assert.equal(await raw(),markdown.replace(/\r\n/g,'\n'))}
    await page.locator('.md-prose h1').click();await page.keyboard.press('End');await page.keyboard.insertText('新增');assert.ok((await raw()).includes('# Markdown 写作新增'));assert.equal(await page.locator('.md-prose h1').textContent(),'Markdown 写作新增')
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),markdown.replace(/\r\n/g,'\n'))
  })
  await test('table direct cell typing, Tab, row/column toolbar, shared undo',async()=>{
    const cell=page.locator('.md-prose tbody tr').nth(1).locator('td').first()
    // PM tables render all rows directly; choose by visible cell text.
    const target=page.locator('.md-prose td').filter({hasText:'内容'}).first();await target.click();await page.keyboard.press('End');await page.keyboard.insertText('编辑')
    assert.ok((await raw()).includes('内容编辑'));assert.equal(await page.locator('.md-prose table').count(),1);assert.equal(await page.locator('.md-prose').innerText().then(t=>t.includes('| :---')),false)
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.fixture.view().state.selection.$from.node(-1).type.name),'table_cell')
    const rows=await page.locator('.md-prose tr').count();await page.getByRole('button',{name:'后插行',exact:true}).click();assert.equal(await page.locator('.md-prose tr').count(),rows+1)
    await page.getByRole('button',{name:'后插列',exact:true}).click();assert.equal(await page.locator('.md-prose tr').first().locator('th').count(),4)
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await page.locator('.md-prose tr').first().locator('th').count(),3)
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await page.locator('.md-prose tr').count(),rows)
    void cell
  })
  await test('embedded code CM keeps fences hidden, numbered, highlighted and synchronized with canonical undo',async()=>{
    const block=page.locator('.md-code-block').first(),editor=block.locator('.cm-content');await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n// 新代码')
    assert.ok((await raw()).includes('// 新代码'));assert.equal(await block.locator('.cm-gutterElement').filter({hasText:/^1$/}).count(),1);assert.ok(!(await editor.innerText()).includes('~~~~'))
    await selectCodeLanguage(block,'ts','TypeScript');assert.ok((await raw()).includes('~~~~typescript extra-info'))
    await block.getByRole('button',{name:'复制代码'}).click();assert.ok((await page.evaluate(()=>window.fixture.copied)).includes('// 新代码'))
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.ok((await raw()).includes('~~~~javascript extra-info'))
  })
  await test('link edits stay local; tasks update source; protected YAML/HTML never execute',async()=>{
    await page.locator('.md-prose a').filter({hasText:'链接文字'}).first().click();await page.locator('.md-inline-source-input').waitFor();await page.locator('.md-inline-source-input').fill('[链接文字](https://example.org/new)');await page.keyboard.press('Escape');assert.ok((await raw()).includes('https://example.org/new'))
    const taskBefore=await raw(),task=page.locator('.md-task input[type="checkbox"]').first();await task.check();assert.ok((await raw()).includes('[x] 待完成'));await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),taskBefore);await page.evaluate(()=>window.fixture.manager.command('redo'));assert.ok((await raw()).includes('[x] 待完成'))
    assert.equal(await page.locator('.md-prose script,.md-prose iframe,.md-prose img[src^="https:"]').count(),0);assert.ok((await raw()).includes('title: LightEdit 原位写作验收'));assert.ok((await raw()).includes('<table><tr><td colspan="2">'))
  })
  await test('two panes share PM changes, keep selection independent, and undo works after mode switches',async()=>{
    await page.evaluate(()=>window.fixture.manager.splitEditor());await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
    const before=await raw();await page.locator('.main-pane .md-prose h1').click();await page.keyboard.press('End');await page.keyboard.insertText('双栏')
    assert.equal(await page.locator('.secondary-pane .md-prose h1').textContent(),await page.locator('.main-pane .md-prose h1').textContent())
    await page.evaluate(()=>window.fixture.manager.setMarkdownMode('md','source'));await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await page.evaluate(()=>window.fixture.manager.setMarkdownMode('md','live'));await page.locator('.main-pane .md-prose').waitFor()
    await page.evaluate(()=>window.fixture.manager.command('redo'));assert.ok((await raw()).includes('双栏'))
  })
  await test('math and Mermaid render automatically; TOC and footnotes preserve source',async()=>{
    await page.evaluate(()=>{const m=window.fixture.manager;m.focusPane('main',false);m.mergeAllPanes()})
    await page.locator('.md-inline-math .katex').waitFor({timeout:30000})
    const before=await raw()
    assert.equal(await page.locator('.md-inline-math').count(),1);assert.ok(await page.locator('.md-toc button').count()>=6);assert.equal(await page.locator('.md-footnote').count(),1);assert.equal(await page.locator('.md-callout').count(),1)
    await page.locator('.md-inline-math .katex').waitFor({timeout:30000})
    await page.locator('.md-diagram svg').waitFor({timeout:60000});assert.equal(await page.locator('.md-diagram script,.md-diagram foreignObject,.md-diagram a').count(),0)
    assert.equal(await raw(),before)
    await page.evaluate(()=>{document.querySelector('.markdown-live').scrollTop=0;document.body.classList.add('light')});await page.screenshot({path:`${output}/live-document-light.png`});await page.evaluate(()=>document.body.classList.remove('light'));await page.screenshot({path:`${output}/live-document-dark.png`})
  })
  await test('40 real long-document clicks place edits at DOM glyphs and undo preserves source',async()=>{
    const content=Array.from({length:120},(_,i)=>`## 标题-${i} heading\n\n段落-${i} 中文 English position check and longer readable line.`).join('\n\n')
    await page.evaluate(content=>{const m=window.fixture.manager;m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:content}})},content)
    for(let i=0;i<40;i++){
      const index=(i*7)%120,label=i%2?`标题-${index} heading`:`段落-${index} 中文 English position check and longer readable line.`,selector=i%2?'.md-prose h2':'.md-prose p',target=page.locator(selector).filter({hasText:label}).first(),offset=label.indexOf(' ')+2
      await target.scrollIntoViewIfNeeded()
      const point=await target.evaluate((node,offset)=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),text=walker.nextNode(),range=document.createRange();range.setStart(text,offset);range.setEnd(text,offset+1);const rect=range.getBoundingClientRect();return {x:rect.left+.1,y:rect.top+rect.height/2}},offset)
      await page.mouse.click(point.x,point.y);await page.keyboard.insertText('X')
      const from=content.indexOf(label)+offset,expected=content.slice(0,from)+'X'+content.slice(from);assert.equal(await raw(),expected,`actual glyph click ${i}`)
      await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),content)
    }
  })
  await test('clipboard, HTML safety, real DOM selection and synthetic composition guards migrate the old Live contract',async()=>{
    await page.evaluate(()=>{const m=window.fixture.manager;m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:'paragraph'}})})
    await page.locator('.md-prose p').first().click();await page.keyboard.press('Control+a')
    await page.evaluate(()=>{const v=window.fixture.view(),data=new DataTransfer();data.setData('text/plain','中文 **literal**\nsecond line');v.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))})
    assert.ok((await page.locator('.md-prose').innerText()).includes('中文 **literal**'))
    await page.evaluate(()=>{const v=window.fixture.view(),data=new DataTransfer();data.setData('text/html','<p>safe<script>window.wysiwygUnsafe=true</script><img src="https://invalid.invalid/track" onerror="bad()"><a href="javascript:alert(1)">bad</a></p>');data.setData('text/plain','safe');v.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))})
    assert.equal(await page.evaluate(()=>!!window.wysiwygUnsafe),false);assert.equal(await page.locator('.md-prose script,.md-prose iframe,.md-prose img[src^="https:"]').count(),0)
    const guarded=await page.evaluate(()=>{const m=window.fixture.manager,v=window.fixture.view();v.dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));const result={composing:m.isComposing,modeAccepted:m.setMarkdownMode('md','source'),snapshot:m.saveSnapshot('md')};v.dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}));return result})
    assert.equal(guarded.composing,true);assert.equal(guarded.modeAccepted,false);assert.equal(guarded.snapshot,null)
    await page.waitForTimeout(50)
    await page.evaluate(()=>window.fixture.manager.setMarkdownMode('md','source'))
    const source=await raw(),copied=await page.evaluate(()=>{const m=window.fixture.manager,v=m.paneView('main');v.focus();v.dispatch({selection:{anchor:0,head:v.state.doc.length}});const data=new DataTransfer();v.contentDOM.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain')});assert.equal(copied,source)
    await page.evaluate(()=>window.fixture.manager.setMarkdownMode('md','live'));await page.locator('.md-prose').waitFor()
    await page.evaluate(()=>{const {manager:m,StateEffect,EditorState}=window.fixture;m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:'- [ ] readonly task'}});m.dispatch('md',{effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))})})
    const readonly=await raw();await page.locator('.md-task input').click();assert.equal(await raw(),readonly);assert.equal(await page.locator('.md-task input').isChecked(),false)
  })
  await test('theme/typography keep PM state and non-Markdown stays CodeMirror',async()=>{
    const result=await page.evaluate(()=>{const m=window.fixture.manager,v=window.fixture.view(),state=v.state,selection=v.state.selection;m.setMarkdownTypography({width:700,fontSize:18,fontFamily:'serif',lineHeight:1.8,codeLineNumbers:true,codeWrap:true});document.body.classList.add('light');return v.state===state&&v.state.selection===selection});assert.equal(result,true)
    await page.screenshot({path:`${output}/light.png`});await page.evaluate(()=>document.body.classList.remove('light'));await page.screenshot({path:`${output}/dark.png`})
    await page.evaluate(()=>{window.fixture.manager.focusPane('main',false);window.fixture.manager.open('txt',false)});assert.equal(await page.locator('.main-pane .editor-host>.cm-editor').count(),1)
    await page.evaluate(()=>window.fixture.manager.dispose());assert.equal(await page.locator('.cm-editor,.ProseMirror').count(),0)
  })
  assert.deepEqual(errors,[])
}catch(error){console.error(error);results.push({name:'failure',result:'FAIL',error:String(error),source:await raw(),debug:await page.evaluate(()=>({selection:window.fixture.view()?.state.selection.toJSON(),panel:document.querySelector('.md-properties')?.outerHTML}))});await page.screenshot({path:`${output}/failure.png`});process.exitCode=1}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
