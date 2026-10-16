import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'
import { selectCodeLanguage } from './helpers/code-language.mjs'

const output='test-results/language-experience',root='tests/fixtures/language-experience'
await mkdir(output,{recursive:true})
const files=await Promise.all(['Hello.java','example.js','main.ts','example.cpp','example.sh','example.bat','example.py','Example.vue','Example.cs','example.sql','README.md'].map(async name=>({id:name,name,path:name,text:await readFile(`${root}/${name}`,'utf8')})))
const module=`fixture-${Date.now()}.ts`
await writeFile(`${output}/fixture.html`,`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`)
await writeFile(`${output}/${module}`,`
import {createApp,h,ref} from 'vue';import {DocumentManager} from '/src/editor/core/DocumentManager.ts';import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';import {textClipboard} from '/src/features/shell/clipboard.ts';
import {syntaxTree} from '@codemirror/language';
const manager=new DocumentManager(${JSON.stringify(files)});manager.open('Hello.java',false);
const revision=ref(0);manager.subscribe(()=>revision.value++);window.fixture={manager,syntaxTree,copied:'',live:()=>manager.liveViews.get('main')?.editor,view:()=>manager.liveViews.get('main')?.editor.view};
textClipboard.writeText=async text=>{window.fixture.copied=text};
createApp({render(){revision.value;return h(EditorContainer,{doc:manager.activeDocument,manager,showOutline:false,desktop:false})}}).mount('#app');
`)
const browser=await chromium.launch(browserOptions),page=await browser.newPage({viewport:{width:1280,height:950}}),results=[],errors=[],evidence={}
page.on('pageerror',error=>errors.push(error.message))
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
const raw=()=>page.evaluate(()=>window.fixture.manager.getText('README.md'))
const original=files.find(f=>f.name==='README.md').text.replace(/\r\n/g,'\n')
async function colors(selector){return page.locator(selector).first().evaluate(el=>[...el.querySelectorAll('.cm-line span')].filter(s=>s.textContent.trim()).map(s=>({text:s.textContent,color:getComputedStyle(s).color,class:s.className})))}
try{
  await page.route('**/tests/fixtures/logo.png',route=>route.fulfill({path:`${root}/logo.png`,contentType:'image/png'}))
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`)
  await test('normal Java/JS/TS/C++/Shell/Batch generate real syntax trees and distinct computed token colors in both themes',async()=>{
    for(const theme of ['dark','light']){
      await page.evaluate(theme=>document.body.classList.toggle('light',theme==='light'),theme)
      for(const file of files.filter(f=>f.id!=='README.md')){
        await page.evaluate(id=>window.fixture.manager.open(id,false),file.id)
        await page.waitForFunction(id=>window.fixture.manager.metadata(id).languageStatus==='ready',file.id)
        const tokens=await colors('.main-pane .editor-host>.cm-editor')
        assert.ok(tokens.length>5,file.id)
        assert.ok(new Set(tokens.map(t=>t.color)).size>=3,`${theme} ${file.id} colors`)
        const tree=await page.evaluate(id=>window.fixture.syntaxTree(window.fixture.manager.getState(id)).toString(),file.id)
        assert.ok(tree.length>25)
        evidence[`${theme}-${file.id}`]={tokens,tree}
        await page.screenshot({path:`${output}/${theme}-${file.id}.png`})
      }
    }
  })
  await page.evaluate(()=>window.fixture.manager.open('README.md',false))
  await page.locator('.md-prose').waitFor()
  await test('Live Java/Bash/JS/SQL have actual colored tokens; Live document has no global gutters',async()=>{
    await page.waitForFunction(()=>[...document.querySelectorAll('.md-code-block')].every(b=>b.dataset.languageStatus==='ready'))
    for(const theme of ['dark','light']){
      await page.evaluate(theme=>document.body.classList.toggle('light',theme==='light'),theme)
      await page.evaluate(()=>document.querySelector('.markdown-live').scrollTop=0)
      await page.waitForFunction(()=>document.querySelector('.md-live-image img')?.naturalWidth>0)
      await page.screenshot({path:`${output}/${theme}-markdown-page.png`})
      for(let index=0;index<4;index++){
        const block=page.locator('.md-code-block').nth(index)
        await block.scrollIntoViewIfNeeded()
        const tokens=await block.evaluate(el=>[...el.querySelectorAll('.cm-line span')].filter(s=>s.textContent.trim()).map(s=>({text:s.textContent,color:getComputedStyle(s).color})))
        assert.ok(new Set(tokens.map(t=>t.color)).size>=3,`${theme} fence ${index}`)
        evidence[`${theme}-fence-${index}`]=tokens
        assert.equal(await block.locator('.cm-gutterElement').filter({hasText:/^1$/}).count(),1)
        await page.screenshot({path:`${output}/${theme}-fence-${index}.png`})
      }
    }
    assert.equal(await page.locator('.md-prose > .cm-gutters,.md-prose > .cm-activeLine,.md-prose > .cm-foldGutter').count(),0)
    assert.equal(await raw(),original)
  })
  await test('searchable keyboard language selector preserves fence parameters, editor and caret; SVG copy returns content only',async()=>{
    const block=page.locator('.md-code-block').first(),before=await raw()
    await block.locator('.cm-content').click()
    const identity=await page.evaluate(()=>{const code=[...window.fixture.live().codeViews][0];window.codeIdentity=code.cm;return code.cm.state.selection.main.head})
    await block.locator('.md-code-lang > button').click()
    await block.getByRole('combobox').fill('bash')
    await block.getByRole('combobox').press('ArrowDown');await block.getByRole('combobox').press('ArrowUp')
    await page.screenshot({path:`${output}/language-picker.png`})
    const layout=await block.evaluate(el=>{
      const content=el.querySelector('.md-code-editor-wrap').getBoundingClientRect(),menu=el.querySelector('.md-language-menu').getBoundingClientRect(),next=el.nextElementSibling.getBoundingClientRect(),b=el.getBoundingClientRect()
      return {menuTop:menu.top,codeBottom:content.bottom,menuRight:menu.right,blockRight:b.right,nextTop:next.top,blockBottom:b.bottom}
    })
    assert.ok(layout.menuTop>=0)
    assert.ok(layout.menuRight<=layout.blockRight)
    assert.ok(layout.nextTop>=layout.blockBottom)
    await block.getByRole('combobox').press('Enter')
    await page.waitForFunction(()=>document.querySelector('.md-code-block').dataset.languageStatus==='ready')
    assert.ok((await raw()).includes('```shell extra-info'))
    assert.equal(await page.evaluate(()=>window.codeIdentity===[...window.fixture.live().codeViews][0].cm),true)
    assert.equal(await page.evaluate(()=>window.codeIdentity.state.selection.main.head),identity)
    await block.hover();const copy=block.getByRole('button',{name:'复制代码',exact:true})
    assert.equal(await copy.locator('svg').count(),1)
    const box=await copy.boundingBox();await copy.click();assert.deepEqual(await copy.boundingBox(),box)
    assert.equal(await page.evaluate(()=>window.fixture.copied),await block.locator('.cm-content').innerText())
    assert.ok(!(await page.evaluate(()=>window.fixture.copied)).includes('```'))
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await block.locator('.md-code-lang > button').click();await block.getByRole('combobox').fill('unknown-mode');await block.getByRole('combobox').press('Escape')
    assert.equal(await raw(),before)
    await selectCodeLanguage(block,'unknown-mode','unknown-mode（未注册，纯文本）')
    assert.ok((await block.locator('.md-code-language-status').textContent()).includes('纯文本'))
    assert.equal((await colors('.md-code-block .cm-editor')).length,0)
    await page.evaluate(()=>window.fixture.manager.command('undo'))
  })
  await test('H3 focus shows level without changing height; only current link exposes editable Markdown source and exact undo',async()=>{
    const heading=page.locator('.md-prose h3').first(),height=(await heading.boundingBox()).height
    await heading.click();assert.equal(await heading.getAttribute('data-heading-level'),'h3');assert.equal((await heading.boundingBox()).height,height)
    await page.screenshot({path:`${output}/h3-focused.png`})
    const before=await raw()
    await page.locator('.md-prose a').filter({hasText:'中文 English 链接'}).click()
    await page.locator('.md-inline-source-input').waitFor()
    assert.equal(await page.locator('.md-local-source').count(),1)
    assert.equal(await page.locator('.md-prose a').filter({hasText:'另一个链接'}).isVisible(),true)
    assert.ok((await page.locator('.md-inline-source-input').innerText()).startsWith('[中文 English 链接]('))
    await page.screenshot({path:`${output}/link-focused.png`})
    assert.equal(await page.evaluate(()=>document.getSelection().isCollapsed),true)
    await page.locator('.md-inline-source-input').fill('[中文 English 链接](https://example.com/new)')
    assert.equal(await raw(),before.replace('https://example.com/old','https://example.com/new'))
    await page.keyboard.press('Escape');assert.equal(await page.locator('.md-local-source').count(),0)
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await page.evaluate(()=>window.fixture.manager.command('redo'));assert.ok((await raw()).includes('https://example.com/new'))
    await page.evaluate(()=>window.fixture.manager.command('undo'))
  })
  await test('image local source keeps image visible; text path/alt edits use exact source patch and undo',async()=>{
    // Browser resource fixture is explicitly provided by the test, not production fallback.
    const image=page.locator('.md-live-image img').first();await image.waitFor()
    const centering=await image.evaluate(img=>{const a=img.getBoundingClientRect(),p=img.closest('p').getBoundingClientRect();return Math.abs((a.left+a.right)-(p.left+p.right))/2})
    assert.ok(centering<1,'standalone image centers despite PM trailing break')
    await image.click();await page.locator('.md-inline-source-input').waitFor()
    assert.equal(await image.isVisible(),true)
    await page.locator('.md-inline-source-input').scrollIntoViewIfNeeded()
    await page.locator('.md-inline-source-input').click()
    await page.screenshot({path:`${output}/image-focused.png`})
    const before=await raw()
    await page.locator('.md-inline-source-input').fill('![更新后的图片](./logo.png)')
    assert.equal(await raw(),before.replace('![LightEdit 图片]','![更新后的图片]'))
    await page.keyboard.press('Escape');assert.equal(await page.locator('.md-live-image img').first().isVisible(),true)
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
  })
  await test('caret entry permits local emphasis source editing; table remains structured; modes preserve all source',async()=>{
    const before=await raw()
    const strong=page.locator('.md-prose strong').first()
    await strong.click({position:{x:3,y:(await strong.boundingBox()).height/2}});await page.keyboard.press('ArrowRight')
    await page.locator('.md-inline-source-input').waitFor()
    assert.ok((await page.locator('.md-inline-source-input').innerText()).includes('**'))
    await page.locator('.md-inline-source-input').fill('**加粗更新**');await page.keyboard.press('Escape')
    assert.equal(await raw(),before.replace('**加粗中文**','**加粗更新**'))
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await page.locator('.md-prose td').first().click();assert.equal(await page.locator('.md-prose table').count(),1)
    await page.screenshot({path:`${output}/table-edit.png`})
    for(const mode of ['source','split','live']){
      await page.evaluate(mode=>window.fixture.manager.setMarkdownMode('README.md',mode),mode)
      if(mode==='live')await page.locator('.md-prose').waitFor()
      assert.equal(await raw(),before)
    }
  })
  await test('Source Markdown fences highlight through the same registry; multi-pane modes stay isolated',async()=>{
    await page.evaluate(()=>window.fixture.manager.setMarkdownMode('README.md','source'))
    await page.waitForFunction(()=>document.querySelector('.editor-host>.cm-editor .cm-content').textContent.includes('public class Hello'))
    await page.waitForTimeout(250)
    evidence.sourceTokens=await colors('.main-pane .editor-host>.cm-editor')
    assert.ok(evidence.sourceTokens.some(t=>t.text==='public'))
    await page.evaluate(()=>{const m=window.fixture.manager;m.setMarkdownMode('README.md','live');m.splitEditor()})
    await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
    await page.evaluate(()=>{const m=window.fixture.manager;const pane=[...m.liveViews.keys()].find(p=>p!=='main');m.focusPane(pane,false);m.open('Hello.java',false)})
    await page.locator('.secondary-pane .editor-host>.cm-editor').waitFor()
    assert.equal(await page.locator('.main-pane .md-prose').count(),1)
    assert.ok(new Set((await colors('.secondary-pane .editor-host>.cm-editor')).map(t=>t.color)).size>=3)
    await page.evaluate(()=>{const m=window.fixture.manager;m.focusPane('main',false);m.mergeAllPanes()})
  })
  await test('italic/strike/inline-code allow local edits; invalid drafts and synthetic composition retain content and block unsafe lifecycle changes',async()=>{
    await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===1)
    const before=await raw()
    for(const [selector,oldRaw,newRaw] of [['em','*斜体文字*','*斜体更新*'],['s','~~删除线~~','~~删除更新~~'],['code','`inline code`','`inline updated`']]){
      const target=page.locator(`.md-prose ${selector}`).first()
      await target.click({position:{x:3,y:(await target.boundingBox()).height/2}});await page.keyboard.press('ArrowRight')
      await page.locator('.md-inline-source-input').waitFor()
      await page.locator('.md-inline-source-input').fill(newRaw);await page.keyboard.press('Escape')
      assert.equal(await raw(),before.replace(oldRaw,newRaw))
      await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    }
    await page.locator('.md-prose a').filter({hasText:'中文 English 链接'}).click()
    await page.locator('.md-inline-source-input').waitFor()
    await page.locator('.md-inline-source-input').fill('one\n\nsecond')
    const guard=await page.evaluate(()=>{const m=window.fixture.manager;return {composing:m.isComposing,snapshot:m.saveSnapshot('README.md'),mode:m.setMarkdownMode('README.md','source')}})
    assert.equal(guard.composing,true);assert.equal(guard.snapshot,null);assert.equal(guard.mode,false)
    assert.ok((await page.locator('.md-inline-source-input').innerText()).includes('second'))
    assert.equal(await raw(),before)
    await page.keyboard.press('Escape');assert.equal(await raw(),before)
    await page.locator('.md-prose a').filter({hasText:'中文 English 链接'}).click()
    await page.locator('.md-inline-source-input').waitFor()
    const composition=await page.evaluate(()=>{
      const m=window.fixture.manager,cm=window.fixture.live().inlineSource.input
      cm.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}))
      const result={composing:m.isComposing,snapshot:m.saveSnapshot('README.md')}
      cm.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}))
      return result
    })
    assert.equal(composition.composing,true);assert.equal(composition.snapshot,null)
    await page.keyboard.press('Escape');assert.equal(await raw(),before)
    await page.evaluate(()=>{window.testOpenedLinks=[];window.open=url=>{window.testOpenedLinks.push(url);return null}})
    await page.locator('.md-prose a').filter({hasText:'中文 English 链接'}).click({modifiers:['Control']})
    assert.deepEqual(await page.evaluate(()=>window.testOpenedLinks),['https://example.com/old'])
    assert.equal(await page.locator('.md-local-source').count(),0)
  })
  await test('native inline glyph caret, Chinese insertion, typography and document shortcuts match observed Typora behavior',async()=>{
    const before=await raw(),strong=page.locator('.md-prose strong').first()
    await strong.scrollIntoViewIfNeeded()
    const point=await strong.evaluate(el=>{const range=document.createRange();range.setStart(el.firstChild,2);range.setEnd(el.firstChild,3);const r=range.getBoundingClientRect();return {x:r.left+.1,y:r.top+r.height/2}})
    await page.mouse.click(point.x,point.y)
    const input=page.locator('.md-inline-source-input');await input.waitFor()
    assert.equal(await page.evaluate(()=>document.getSelection().isCollapsed),true)
    assert.equal(await input.evaluate(el=>getComputedStyle(el.parentElement).display),'inline')
    assert.equal(await input.evaluate(el=>getComputedStyle(el).fontFamily===getComputedStyle(el.closest('p')).fontFamily),true)
    assert.equal(await input.locator('.cm-editor').count(),0)
    await page.keyboard.insertText('测试')
    assert.equal(await raw(),before.replace('**加粗中文**','**加粗测试中文**'))
    await page.keyboard.press('Escape');await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await strong.click();await input.waitFor();await page.keyboard.press('Control+f')
    assert.equal(await page.locator('.md-live-search').isVisible(),true)
    assert.equal(await page.evaluate(()=>window.fixture.manager.activeDocument.mode),'live')
    await page.keyboard.press('Escape')
    await strong.click();await input.waitFor();await page.keyboard.press('Control+a')
    assert.equal(await page.evaluate(()=>window.fixture.view().state.selection.toJSON().type),'all')
    assert.equal(await page.locator('.md-local-source').count(),0)
    assert.equal(await raw(),before)
    await page.locator('.md-prose h1').click()
    await strong.click();await input.waitFor()
    await page.keyboard.press('Enter')
    assert.ok((await raw()).includes('**加粗**\n\n**中文**'),'Enter splits the paragraph at the visible glyph, preserving both strong runs')
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await strong.click();await input.waitFor();await page.keyboard.press('Control+b');await page.keyboard.insertText('plain')
    assert.equal(await page.evaluate(()=>{let marked;window.fixture.view().state.doc.descendants(n=>{if(n.isText&&n.text.includes('plain'))marked=n.marks.some(m=>m.type.name==='strong')});return marked}),false)
    await page.evaluate(()=>window.fixture.manager.command('undo'));assert.equal(await raw(),before)
    await page.locator('.md-prose h1').click()
    await page.screenshot({path:`${output}/native-inline-shortcuts.png`})
  })
  await test('failed language imports fall back visibly; late Java loads cannot overwrite a switched file, closed tab or code block',async()=>{
    const fail=await browser.newPage()
    const isJava=url=>url.includes('@codemirror_lang-java')||url.includes('@codemirror/lang-java')
    await fail.route('**/*',route=>isJava(route.request().url())?route.abort('failed'):route.continue())
    await fail.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`)
    await fail.waitForFunction(()=>window.fixture.manager.metadata('Hello.java').languageStatus==='error')
    assert.ok((await fail.evaluate(()=>window.fixture.manager.metadata('Hello.java').languageError)).includes('纯文本'))
    assert.equal(await fail.locator('.editor-host>.cm-editor .cm-line span').count(),0)
    await fail.close()
    const race=await browser.newPage()
    let release;const gate=new Promise(r=>release=r)
    let held=false
    await race.route('**/*',async route=>{if(isJava(route.request().url())){held=true;await gate}await route.continue()})
    await race.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/fixture.html`,{waitUntil:'domcontentloaded'})
    for(let i=0;i<50&&!held;i++)await new Promise(r=>setTimeout(r,20))
    assert.equal(held,true,'actually delayed Java module import')
    await race.evaluate(()=>{const m=window.fixture.manager;m.setLanguage('Hello.java','Python');m.open('README.md',false)})
    await race.locator('.md-code-block').first().waitFor()
    const block=race.locator('.md-code-block').first()
    await selectCodeLanguage(block,'sql','SQL')
    await race.evaluate(()=>window.fixture.manager.close('Hello.java',true))
    release()
    await race.waitForFunction(()=>document.querySelector('.md-code-block').dataset.languageStatus==='ready')
    assert.equal(await block.locator('.md-code-lang').getAttribute('data-language'),'sql')
    const actual=await block.evaluate(el=>[...el.querySelectorAll('.cm-line span')].find(s=>s.textContent==='public')?.className||'')
    evidence.delayedJava={held,codeLanguage:'sql',publicClass:actual,closedFileStillClosed:await race.evaluate(()=>!window.fixture.manager.metadata('Hello.java'))}
    assert.equal(evidence.delayedJava.closedFileStillClosed,true)
    await race.close()
  })
  await test('ordinary 512KB TypeScript editing and scrolling retain the editor and bound viewport DOM',async()=>{
    evidence.codePerformance=await page.evaluate(async()=>{
      const m=window.fixture.manager,text=('// 中文 performance\nconst value: number = 42; console.log("LightEdit");\n').repeat(9000).slice(0,524288)
      const t=performance.now(),id=m.openFile({token:'perf-ts',name:'large.ts',path:'large.ts',text,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'},false)
      while(m.metadata(id).languageStatus!=='ready')await new Promise(r=>setTimeout(r,10))
      const v=m.paneView('main'),identity=v.dom,times=[]
      for(let i=0;i<30;i++){const start=performance.now();v.dispatch({changes:{from:3,insert:'中'}});times.push(performance.now()-start)}
      const start=performance.now();v.scrollDOM.scrollTop=v.scrollDOM.scrollHeight/2;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      times.sort((a,b)=>a-b)
      return {characters:text.length,loadMs:start-t,medianEditMs:times[15],p95EditMs:times[28],scrollTwoFramesMs:performance.now()-start,renderedLines:v.dom.querySelectorAll('.cm-line').length,sameEditor:v.dom===identity,sourceIntact:m.getText(id)===text.slice(0,3)+'中'.repeat(30)+text.slice(3)}
    })
    assert.equal(evidence.codePerformance.sameEditor,true)
    assert.equal(evidence.codePerformance.sourceIntact,true)
    assert.ok(evidence.codePerformance.renderedLines<1000)
  })
  assert.deepEqual(errors,[])
}catch(error){console.error(error);const debug=await page.evaluate(()=>{const e=window.fixture.live?.(),v=e?.view;return {selection:v?.state.selection.toJSON(),marks:v?.state.selection.$from.marks().map(m=>m.type.name),composing:e?.composing,inline:!!e?.inlineSource,dismissed:e?.dismissedInline,activeElement:document.activeElement?.outerHTML.slice(0,300)}});console.log(debug);results.push({name:'failure',result:'FAIL',error:String(error),debug});await page.screenshot({path:`${output}/failure.png`});process.exitCode=1}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors,evidence},null,2));await browser.close()}
