import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const output='test-results/markdown-stage-a',name=`fixture-${Date.now()}`
const source=await readFile('tests/fixtures/markdown-stage-a.md','utf8')
const pixel=(await readFile('tests/fixtures/assets/pixel.png')).toString('base64')
await mkdir(output,{recursive:true})
await writeFile(`${output}/${name}.html`,`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0}#app{height:100vh;display:flex;flex-direction:column}</style></head><body><div id="app"></div><script type="module" src="./${name}.ts"></script></body></html>`)
await writeFile(`${output}/${name}.ts`,`
import {createApp,h,ref} from 'vue';import {EditorView} from '@codemirror/view';import {EditorSelection} from '@codemirror/state';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';import EditorContainer from '/src/components/layout/EditorContainer.vue';
import {markdownResources} from '/src/editor/markdown/images.ts';import {textClipboard} from '/src/features/shell/clipboard.ts';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/editor/markdown/styles.css';
const manager=new DocumentManager([{id:'md',name:'stage-a.md',path:'stage-a.md',text:${JSON.stringify(source)}},{id:'txt',name:'plain.txt',path:'plain.txt',text:${JSON.stringify('- plain\n![literal](x.png)')}}]);manager.open('md',false);
const revision=ref(0);manager.subscribe(()=>revision.value++);const resources=manager.getState('md').facet(markdownResources);
resources.loadLocal=async path=>{if(path.includes('missing'))throw Error('fixture missing image');return Uint8Array.from(atob('${pixel}'),ch=>ch.charCodeAt(0))};
window.fixture={manager,EditorSelection,copied:null,view:()=>EditorView.findFromDOM(document.querySelector('.main-pane .cm-editor'))};textClipboard.writeText=async text=>{window.fixture.copied=text};
const objectURLs=new Set();const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=originalCreate(blob);objectURLs.add(url);return url};URL.revokeObjectURL=url=>{objectURLs.delete(url);originalRevoke(url)};window.fixture.objectURLs=objectURLs;
createApp({render(){revision.value;return h(EditorContainer,{manager,doc:manager.activeDocument,showOutline:false,desktop:false})}}).mount('#app');
`)
const browser=await chromium.launch({headless:true,channel:process.env.LIGHTEDIT_TEST_BROWSER||'msedge'})
const page=await browser.newPage({viewport:{width:1200,height:780}}),results=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
let networkRequests=0,failure
await page.route('https://example.invalid/**',route=>{networkRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from(pixel,'base64'),headers:{'Access-Control-Allow-Origin':'*'}})})
const editor=()=>page.getByRole('textbox',{name:'文本编辑器',exact:true})
async function raw(){return page.evaluate(()=>window.fixture.manager.getText('md'))}
async function mode(mode){await page.evaluate(mode=>window.fixture.manager.setMarkdownMode('md',mode),mode);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function reset(text=source){await page.evaluate(text=>{const m=window.fixture.manager;m.open('md',false);m.dispatch('md',{changes:{from:0,to:m.getState('md').doc.length,insert:text},selection:{anchor:text.length}})},text)}
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
try{
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL||'http://localhost:1422'}/${output}/${name}.html`)
  await page.waitForFunction(()=>window.fixture?.manager.metadata('md')?.languageStatus==='ready')
  await page.evaluate(position=>{const m=window.fixture.manager;const line=m.getState('md').doc.lineAt(position).number;m.revealPosition('md',line+1,1)},source.indexOf('![相对路径图片]'))
  await test('Live local images, failure placeholder, no implicit network, source unchanged',async()=>{
    await page.locator('.cm-md-image-block img').first().waitFor()
    await page.waitForFunction(()=>[...document.querySelectorAll('.md-image-preview img')].some(image=>image.naturalWidth===1))
    assert.ok((await page.locator('.md-image-preview').allTextContents()).some(text=>text.includes('fixture missing image')&&text.includes('./assets/missing.png')))
    assert.equal(networkRequests,0);assert.equal(await raw(),source)
  })
  await test('Real image click returns to exact source; editing + undo/redo preserve original',async()=>{
    const image=page.locator('.cm-md-image-block img').first();await image.scrollIntoViewIfNeeded();await image.click()
    const position=await page.evaluate(()=>window.fixture.view().state.selection.main.head)
    assert.equal(position,source.indexOf('![相对路径图片]'))
    await page.keyboard.insertText('X');assert.equal((await raw()).slice(position,position+1),'X')
    await page.keyboard.press('Control+z');assert.equal(await raw(),source)
    await page.keyboard.press('Control+y');assert.equal((await raw()).slice(position,position+1),'X')
    await page.keyboard.press('Control+z');assert.equal(await raw(),source)
  })
  await test('Network images load only after explicit per-document consent',async()=>{
    await page.evaluate(length=>window.fixture.manager.dispatch('md',{selection:{anchor:length}}),source.length)
    const button=page.getByRole('button',{name:/加载网络图片/});await button.scrollIntoViewIfNeeded()
    assert.equal(networkRequests,0);await button.click();await page.waitForFunction(()=>[...document.images].some(image=>image.src.startsWith('https://example.invalid')&&image.naturalWidth===1))
    assert.equal(networkRequests,1);assert.equal(await raw(),source)
  })
  await test('Code fence labels/highlight/copy use source text and never nested editors',async()=>{
    const copy=page.getByRole('button',{name:'复制代码',exact:true}).first();await copy.scrollIntoViewIfNeeded();await copy.click()
    assert.equal(await page.evaluate(()=>window.fixture.copied),'const message = "中文 English";\nconsole.log(message);')
    assert.equal(await page.locator('.cm-editor').count(),1);assert.equal(await raw(),source)
    await page.waitForFunction(()=>[...document.querySelectorAll('.cm-md-code-block span')].some(node=>node.textContent==='const'))
  })
  await test('Source/Live/Split keep exact source and image semantics, task checkbox and code copy',async()=>{
    for(const next of ['source','live','split','live','source','split']){await mode(next);assert.equal(await raw(),source)}
    const split=page.getByRole('region',{name:'Markdown 只读预览'});await split.locator('.md-image-preview img').first().waitFor()
    assert.equal(await split.locator('.md-preview-task').count(),2)
    assert.equal(await split.locator('table').count(),1)
    await split.getByRole('button',{name:'复制代码',exact:true}).first().click()
    assert.equal(await page.evaluate(()=>window.fixture.copied),'const message = "中文 English";\nconsole.log(message);')
    const image=split.locator('.md-image-preview img').first();await image.scrollIntoViewIfNeeded();await image.click()
    assert.equal(await page.evaluate(()=>window.fixture.view().state.selection.main.head),source.indexOf('![相对路径图片]'))
    assert.equal(await raw(),source)
  })
  await test('Save As and move refresh relative image resources without duplicate Split controls',async()=>{
    await page.evaluate(()=>{const m=window.fixture.manager;m.saveSnapshot('md').complete({token:'saved-target',path:'E:\\saved\\stage-a.md',name:'stage-a.md',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v2'})})
    await page.waitForFunction(()=>{const slots=[...document.querySelectorAll('.split-preview-content .md-image-slot')];return slots.length>0&&slots.every(host=>host.querySelectorAll('.md-image-path').length===1)})
    await page.evaluate(()=>window.fixture.manager.renamePath('E:\\saved\\stage-a.md','E:\\moved\\stage-a.md','stage-a.md'))
    await page.waitForFunction(()=>{const slots=[...document.querySelectorAll('.split-preview-content .md-image-slot')];return slots.length>0&&slots.every(host=>host.querySelectorAll('.md-image-path').length===1)})
    assert.equal(await raw(),source)
  })
  await test('Keyboard lists/tasks/quotes, empty exit, nested Tab/Shift-Tab and multi-cursors',async()=>{
    await mode('source');await reset('- one\n- two');await editor().focus();await editor().press('Tab')
    assert.equal(await raw(),'- one\n  - two');await editor().press('Shift+Tab');assert.equal(await raw(),'- one\n- two')
    await reset('- [x] done');await editor().focus();await editor().press('Enter');assert.equal(await raw(),'- [x] done\n- [ ] ')
    await editor().press('Enter');assert.equal(await raw(),'- [x] done\n')
    await reset('> > nested');await editor().focus();await editor().press('Enter');assert.equal(await raw(),'> > nested\n> > ')
    await editor().press('Enter');assert.equal(await raw(),'> > nested\n> ')
    await editor().press('Enter');assert.equal(await raw(),'> > nested\n')
    await reset('9. nine');await editor().focus();await editor().press('Enter');assert.equal(await raw(),'9. nine\n10. ')
    await reset('- first\n- second')
    await page.evaluate(()=>{const f=window.fixture;f.manager.dispatch('md',{selection:f.EditorSelection.create([f.EditorSelection.cursor(7),f.EditorSelection.cursor(16)])})})
    await editor().focus();await editor().press('Enter');assert.equal(await raw(),'- first\n- \n- second\n- ')
  })
  await test('Complex selection, composition guard and plain text remain intact',async()=>{
    await reset();await mode('live')
    await page.evaluate(()=>{const f=window.fixture;f.manager.dispatch('md',{selection:f.EditorSelection.create([f.EditorSelection.range(2,120),f.EditorSelection.range(200,350)])})})
    assert.equal(await raw(),source)
    await page.evaluate(()=>window.fixture.manager.dispatch('md',{selection:{anchor:window.fixture.manager.getState('md').doc.length}}))
    const blocked=await page.evaluate(()=>{const f=window.fixture,v=f.view();v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));const blocked=!f.manager.setMarkdownMode('md','source');v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));return blocked})
    assert.equal(blocked,true);assert.equal(await raw(),source)
    await page.waitForFunction(()=>!window.fixture.manager.isComposing)
    await page.evaluate(()=>window.fixture.manager.open('txt',false));assert.equal(await page.locator('.cm-md-image-block,.cm-md-fence-tools').count(),0)
    await editor().focus();await editor().press('Control+End');await editor().press('Enter');assert.equal(await page.evaluate(()=>window.fixture.manager.getText('txt')),'- plain\n![literal](x.png)\n')
  })
  await test('Long document image layout: real DOM click coordinates after scrolling and mode switching',async()=>{
    const long=source.repeat(20);await reset(long)
    for(const next of ['live','source','split','live']){
      await mode(next)
      for(const requested of [5,61,205,409,619,1001]){
        let lineNumber=requested;while(!long.split('\n')[lineNumber-1]?.trim())lineNumber++
        await page.evaluate(line=>window.fixture.manager.revealPosition('md',line,1),lineNumber)
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
        const point=await page.evaluate(number=>{const v=window.fixture.view();const element=[...v.contentDOM.querySelectorAll('.cm-line')].find(node=>v.state.doc.lineAt(v.posAtDOM(node)).number===number);if(!element)return null;const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let text;while((text=walker.nextNode()))if(text.textContent.trim()){const range=document.createRange();range.selectNodeContents(text);const r=range.getBoundingClientRect();if(r.width>0)return{x:r.left+Math.min(4,r.width/2),y:(r.top+r.bottom)/2}}return null},lineNumber)
        assert.ok(point,`${next}: rendered text available at line ${lineNumber}`)
        await page.mouse.click(point.x,point.y)
        assert.equal(await page.evaluate(()=>window.fixture.view().state.doc.lineAt(window.fixture.view().state.selection.main.head).number),lineNumber,`${next} real line ${lineNumber}`)
        await page.keyboard.insertText('X');await page.keyboard.press('Control+z');assert.equal(await raw(),long)
      }
    }
  })
  await test('Dark/light and narrow width keep image controls inside editor',async()=>{
    await reset();await mode('live')
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{document.body.classList.toggle('light',theme==='light');document.documentElement.style.colorScheme=theme;window.fixture.manager.setTheme(theme)},theme)
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--editor').trim()),theme==='light'?'#ffffff':'#191c22')
      await page.evaluate(position=>{const m=window.fixture.manager;const line=m.getState('md').doc.lineAt(position).number;m.revealPosition('md',line+1,1)},source.indexOf('![相对路径图片]'))
      await page.setViewportSize({width:720,height:640});await page.screenshot({path:`${output}/${theme}.png`})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    }
  })
  await test('Switching to Source and destroying views release every image object URL',async()=>{
    await mode('source')
    await page.waitForFunction(()=>window.fixture.objectURLs.size===0)
    await page.evaluate(()=>window.fixture.manager.dispose())
    assert.equal(await page.locator('.cm-editor').count(),0)
  })
  assert.deepEqual(errors,[])
}catch(error){failure=String(error);try{await page.screenshot({path:`${output}/failure.png`})}catch{};throw error}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors,networkRequests,failure,clipboard:'controlled provider; OS clipboard NOT TESTED',ime:'synthetic composition only; real system IME NOT RUN'},null,2));await browser.close()}
