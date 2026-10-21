import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/split-unification'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,h,ref,markRaw,nextTick} from 'vue';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {EditorView} from '@codemirror/view';
import {undoDepth,redoDepth} from '@codemirror/commands';
import SplitPreview from '/src/editor/markdown/splitPreview.vue';
import EditorPane from '/src/components/layout/EditorPane.vue';
import {parseMarkdown} from '/src/editor/markdown/wysiwyg/MarkdownParser.ts';
import {MarkdownSourceBridge} from '/src/editor/markdown/wysiwyg/MarkdownSourceBridge.ts';
import {createMarkdownRenderer} from '/src/editor/markdown/rendering.ts';
import {htmlForPreview} from '/src/editor/markdown/html/SafeHtmlRenderer.ts';
import {textClipboard} from '/src/features/shell/clipboard.ts';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';import '/src/editor/markdown/styles.css';
let manager,id,app,revision,host,settings;const copies=[],notices=[];textClipboard.writeText=async value=>copies.push(value);
window.addEventListener('editor-notice',e=>notices.push(e.detail));
document.body.style.margin='0';document.body.classList.add('light');
window.t={parseMarkdown,MarkdownSourceBridge,createMarkdownRenderer,htmlForPreview,copies,notices,EditorView,
 get manager(){return manager},get id(){return id},get live(){return manager.liveViews.get('main')?.editor},
 source(){return manager.getText(id)},history(){const s=manager.getState(id);return {undo:undoDepth(s),redo:redoDepth(s)}},
 async reset(source,realSplit=false){app?.unmount();manager?.dispose();host=null;manager=markRaw(new DocumentManager([],async()=>[]));manager.setCaretAnimation('off');
  id=manager.openFile({token:'split-fixture',path:'C:/fixture/compare.md',name:'compare.md',text:source,encoding:'UTF-8',bom:false,eol:source.includes('\\r\\n')?'CRLF':'LF',readOnly:false,version:'v1'});
  settings=manager.getMarkdownTypography();if(realSplit)manager.setMarkdownMode(id,'split','main');revision=ref(0);manager.subscribe(()=>revision.value++);
  app=createApp({setup:()=>()=>{revision.value;return h('main',{style:'height:820px;display:flex;gap:1px;background:var(--line)'},realSplit?
   [h(EditorPane,{manager,pane:'main',doc:manager.metadata(id)})]:[
    h('section',{style:'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--editor)'},[h('header',{style:'padding:8px 16px;font:14px sans-serif'},'Markdown Live'),h('div',{style:'flex:1;min-height:0;display:flex',ref:el=>{if(el&&host!==el){host=el;manager.mountPane(el,'main')}}})]),
    h('section',{style:'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--editor)'},[h('header',{style:'padding:8px 16px;font:14px sans-serif'},'Markdown Split · 只读预览'),h(SplitPreview,{content:manager.getText(id),typography:settings,imageBorder:settings.imageBorder,ref:el=>window.preview=el})])])}});app.mount('#app');await nextTick();
 },
 replace(source){manager.dispatch(id,{changes:{from:0,to:manager.getState(id).doc.length,insert:source},userEvent:'input.test'})},
 typography(next){settings={...settings,...next};manager.setMarkdownTypography(settings);revision.value++},
 mode(mode){manager.setMarkdownMode(id,mode,'main');revision.value++},
 async reopen(){const text=manager.saveSnapshot(id).text;await this.reset(text,true)},
};
`)
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
await server.listen()
const port = server.httpServer.address().port
const results=[],errors=[]
let browser
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME || (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)})
  const page=await browser.newPage({viewport:{width:1440,height:860}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(()=>window.t)
  const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
  const reset=async(source,real=false)=>{await page.evaluate(({source,real})=>window.t.reset(source,real),{source,real});if(!real)await page.waitForFunction(()=>!!window.t.live)}
  const math=String.raw`# 公式对照

行内 $x^2$、中文与公式 $\alpha+\beta$。

$$
x^2=y^2/100*B^2
$$
$$
\begin{aligned}
a&=b+c\\
d&=\frac{1}{2}
\end{aligned}
$$

金额 $100 和 $200，转义 \$x\$，代码 \texttt{plain}。
`
  await test('Live/Split share inline/block KaTeX, LF/CRLF and readonly math',async()=>{
    for(const source of [math,math.replace(/\n/g,'\r\n')]){
      await reset(source)
      await page.waitForFunction(()=>document.querySelectorAll('.split-preview-content .katex').length===4 && document.querySelectorAll('.markdown-live .katex').length===4)
      const values=await page.evaluate(()=>['.markdown-live','.split-preview-content'].map(selector=>[...document.querySelectorAll(selector+' .katex annotation')].map(el=>el.textContent)))
      assert.deepEqual(values[0],values[1]);assert.equal(await page.locator('.split-preview-content textarea').count(),0)
      await page.locator('.split-preview-content .md-math-output').first().click();assert.equal(await page.locator('.split-preview-content textarea').count(),0)
      assert.deepEqual(await page.evaluate(()=>window.t.history()),{undo:0,redo:0})
    }
    await page.screenshot({path:`${output}/phase01-math-light.png`})
  })
  await test('dollars in code, escapes and currency stay literal; empty/invalid formulas bounded safely',async()=>{
    const source='Costs $100 and $200. \\$escaped\\$\n\n`$code$`\n\n```js\nconst dollars = "$no$"\n$$notMath$$\n```\n\n$$$$\n\n$$\n\\badcommand{\n$$\n\n$$\n'+ 'x'.repeat(4097)+'\n$$'
    await reset(source)
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .katex-error') && document.querySelector('.split-preview-content .md-render-error'))
    assert.equal(await page.locator('.split-preview-content .md-inline-math').count(),0)
    assert.equal(await page.locator('.split-preview-content .md-math-output').count(),3)
    assert.match(await page.locator('.split-preview-content').innerText(),/Costs \$100 and \$200/)
    assert.equal(await page.locator('.split-preview-content script,.split-preview-content iframe').count(),0)
  })
  await test('rapid edits discard stale async math and 1MiB budget remains enforced',async()=>{
    await reset('$old$\n\n$$\na\n$$')
    await page.evaluate(()=>{window.t.replace('$next$\n\n$$\nb\n$$');queueMicrotask(()=>window.t.replace('$latest$\n\n$$\nc\n$$'))})
    await page.waitForFunction(()=>document.querySelector('.split-preview-content annotation')?.textContent==='latest')
    assert.deepEqual(await page.locator('.split-preview-content annotation').allTextContents(),['latest','c'])
    await page.evaluate(()=>window.t.replace('x'.repeat(1024*1024+1)))
    await page.waitForFunction(()=>document.querySelector('.split-preview-content').textContent.includes('暂停只读预览'))
  })
  await test('static code uses native syntax spans, aligned line numbers, raw copy and live settings without EditorViews',async()=>{
    const code='/* multiline\n * comment 中文\n */\nconst message = "hello";\n\n'+ 'long_value_'.repeat(45)
    await reset('# Code\n\n```javascript\n'+code+'\n```')
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .mk-syntax-keyword'))
    assert.equal(await page.locator('.split-preview-content .cm-editor').count(),0)
    assert.equal(await page.locator('.split-preview-content .md-code-line').count(),6)
    assert.deepEqual((await page.locator('.split-preview-content .md-code-number').allTextContents()).map(s=>s.trim()),['1','2','3','4','5','6'])
    assert.match(await page.locator('.split-preview-content .md-code-line').nth(1).locator('.mk-syntax-comment').innerText(),/comment/)
    const aligns=await page.locator('.split-preview-content .md-code-line').evaluateAll(lines=>lines.map(line=>{const [number,text]=line.children;return Math.abs(number.getBoundingClientRect().top-text.getBoundingClientRect().top)}))
    assert.ok(aligns.every(n=>n<1))
    const scroll=await page.locator('.split-preview-content pre').evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(scroll,true)
    await page.locator('.split-preview-content .md-preview-fence').hover();await page.locator('.split-preview-content .md-code-copy').click()
    assert.equal(await page.evaluate(()=>window.t.copies.at(-1)),code)
    await page.evaluate(()=>{window.codeHost=document.querySelector('.split-preview-content .md-code-line');window.t.typography({codeLineNumbers:false,codeWrap:true,fontSize:19,lineHeight:1.8,fontFamily:'serif'})})
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.split-preview-content .md-code-number')).display==='none')
    assert.equal(await page.locator('.markdown-live .cm-lineNumbers').count(),0)
    assert.equal(await page.evaluate(()=>window.codeHost===document.querySelector('.split-preview-content .md-code-line')),true)
    assert.equal(await page.locator('.split-preview-content pre').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
    assert.equal(await page.locator('.split-preview-content .md-code-line').count(),6)
    await page.evaluate(()=>window.t.typography({codeLineNumbers:true,codeWrap:false,fontSize:16,lineHeight:1.6,fontFamily:'system'}))
    await page.waitForFunction(()=>document.querySelector('.markdown-live .cm-lineNumbers'))
    await page.screenshot({path:`${output}/phase02-code-light.png`})
  })
  await test('Mermaid is a readonly diagram with guarded errors and raw-source copying',async()=>{
    await reset('```mermaid\nflowchart LR\n A-->B\n```')
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .md-diagram svg'))
    assert.equal(await page.locator('.split-preview-content .md-code-line').count(),0)
    await page.locator('.split-preview-content .md-preview-fence').hover();await page.locator('.split-preview-content .md-code-copy').click()
    assert.equal(await page.evaluate(()=>window.t.copies.at(-1)),'flowchart LR\n A-->B')
    await page.evaluate(()=>window.t.replace('```mermaid\nflowchart LR\n A-->B\n click A "https://evil.invalid"\n```'))
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .md-render-error'))
    assert.equal(await page.locator('.split-preview-content .md-diagram a').count(),0)
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/result.json`,JSON.stringify({ok:true,browser:await browser.version(),tests:results,errors},null,2))
} finally {await browser?.close();await server.close()}
