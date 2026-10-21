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
import {markdownResources} from '/src/editor/markdown/images.ts';
import {FileController} from '/src/features/files/FileController.ts';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';import '/src/editor/markdown/styles.css';
let manager,id,app,revision,host,settings;const copies=[],notices=[],imageReads=[];textClipboard.writeText=async value=>copies.push(value);
const canvas=document.createElement('canvas');canvas.width=120;canvas.height=50;const context=canvas.getContext('2d');context.fillStyle='#6595ba';context.fillRect(0,0,120,50);context.fillStyle='white';context.font='14px sans-serif';context.fillText('Markumo',25,30);const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
window.addEventListener('editor-notice',e=>notices.push(e.detail));
document.body.style.margin='0';document.body.classList.add('light');
window.t={parseMarkdown,MarkdownSourceBridge,createMarkdownRenderer,htmlForPreview,copies,notices,imageReads,EditorView,
 get manager(){return manager},get id(){return id},get live(){return manager.liveViews.get('main')?.editor},
 source(){return manager.getText(id)},history(){const s=manager.getState(id);return {undo:undoDepth(s),redo:redoDepth(s)}},
 async reset(source,realSplit=false){app?.unmount();manager?.dispose();host=null;manager=markRaw(new DocumentManager([],async()=>[]));manager.setCaretAnimation('off');
  id=manager.openFile({token:'split-fixture',path:'C:/fixture/compare.md',name:'compare.md',text:source,encoding:'UTF-8',bom:false,eol:source.includes('\\r\\n')?'CRLF':'LF',readOnly:false,version:'v1'});
  settings=manager.getMarkdownTypography();if(realSplit)manager.setMarkdownMode(id,'split','main');revision=ref(0);manager.subscribe(()=>revision.value++);
  manager.getState(id).facet(markdownResources).loadLocal=async path=>{imageReads.push(path);if(path!=='safe.png')throw Error('fixture denied local image');return bytes};
  app=createApp({setup:()=>()=>{revision.value;return h('main',{style:'height:calc(100vh - 1px);display:flex;gap:1px;background:var(--line)'},realSplit?
   [h(EditorPane,{manager,pane:'main',doc:manager.metadata(id)})]:[
    h('section',{style:'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--editor)'},[h('header',{style:'padding:8px 16px;font:14px sans-serif'},'Markdown Live'),h('div',{style:'flex:1;min-height:0;display:flex',ref:el=>{if(el&&host!==el){host=el;manager.mountPane(el,'main')}}})]),
    h('section',{style:'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--editor)'},[h('header',{style:'padding:8px 16px;font:14px sans-serif'},'Markdown Split · 只读预览'),h(SplitPreview,{content:manager.getText(id),typography:settings,imageBorder:settings.imageBorder,resources:manager.getState(id).facet(markdownResources),ref:el=>window.preview=el})])])}});app.mount('#app');await nextTick();
 },
 replace(source){manager.dispatch(id,{changes:{from:0,to:manager.getState(id).doc.length,insert:source},userEvent:'input.test'})},
 typography(next){settings={...settings,...next};manager.setMarkdownTypography(settings);revision.value++},
 mode(mode){manager.setMarkdownMode(id,mode,'main');revision.value++},
 async reopen(){const text=manager.saveSnapshot(id).text;await this.reset(text,true)},
 async saveReopen(){let saved;const files=new FileController(manager,{release:async()=>{},save:async(token,text,version,encoding,bom)=>{if(version!=='v1')throw Error('stale fixture baseline');saved=text;return {token,path:'C:/fixture/compare.md',name:'compare.md',version:'v2',encoding,bom,eol:manager.metadata(id).eol,readOnly:false}}},message=>notices.push(message));const success=await files.save(id);const dirty=manager.metadata(id).dirty;files.dispose();await this.reset(saved,true);return {success,dirty,saved}},
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
    assert.equal(await page.locator('.split-preview-content code.language-javascript').count(),1)
    assert.equal(await page.locator('.split-preview-content .md-code-line').count(),6)
    assert.equal((await page.locator('.split-preview-content .md-code-text').allTextContents()).join('\n'),code)
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
  await test('reference definitions use native token positions; duplicate/multiline/unused sources round-trip exactly',async()=>{
    const sources=[
      '[链接][1]\n\n[1]: https://example.com\n',
      '[链接][1]\n\n[1]: https://first.example "title"\n[1]: https://duplicate.example\n[unused]: ./unused.md\n\n',
      '[链接][long label]\n\n[long\n label]:\n  <https://example.com/a>\n  "多行标题"\n\n',
    ]
    for(const source of [...sources,...sources.map(s=>s.replace(/\n/g,'\r\n'))]){
      const result=await page.evaluate(source=>{const b=new window.t.MarkdownSourceBridge(source);return {source:b.prepare(b.doc).source,kinds:b.blocks.map(b=>b.node.attrs.kind),ranges:b.blocks.map(b=>b.raw===source.slice(b.from,b.to))}},source)
      assert.equal(result.source,source);assert.ok(result.kinds.includes('reference'));assert.ok(result.ranges.every(Boolean))
    }
    await reset(sources[1])
    assert.equal(await page.locator('.markdown-live .md-reference-definition').count(),3)
    assert.equal(await page.locator('.markdown-live .md-reference-definition textarea').count(),0)
    const heights=await page.locator('.md-reference-definition').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height))
    assert.ok(heights.every(h=>h<40))
    assert.equal(await page.locator('.markdown-live a').first().getAttribute('href'),'https://first.example/')
    await page.screenshot({path:`${output}/phase03-references-collapsed.png`})
  })
  await test('editing definitions updates preceding links in both panes without rewriting reference syntax; undo/redo works',async()=>{
    const source='[链接][1]\n\n[1]: https://old.example\n\nFooter'
    await reset(source)
    await page.evaluate(()=>{const m=window.t.manager;window.otherPane=m.splitPane('right','main',window.t.id);window.otherHost=document.createElement('div');window.otherHost.style.cssText='height:400px';document.body.append(window.otherHost);m.mountPane(window.otherHost,window.otherPane);m.focusPane('main',false)})
    await page.waitForFunction(()=>document.querySelectorAll('.markdown-live .md-reference-definition').length===2)
    await page.locator('.md-reference-source summary').first().click()
    const input=page.locator('.md-reference-source textarea').first()
    await input.fill('[1]: https://new.example')
    await page.waitForFunction(()=>[...document.querySelectorAll('.markdown-live .md-prose a')].every(a=>a.getAttribute('href')==='https://new.example/'))
    assert.equal(await input.evaluate(el=>document.activeElement===el),true)
    assert.equal(await page.evaluate(()=>window.t.source()),source.replace('old.example','new.example'))
    await input.fill('')
    assert.equal(await input.evaluate(el=>document.activeElement===el),true)
    await input.fill('[1]: https://new.example')
    await page.waitForFunction(()=>document.querySelector('.markdown-live .md-prose a')?.getAttribute('href')==='https://new.example/')
    await page.evaluate(()=>window.t.manager.command('undo'))
    await page.waitForFunction(()=>document.querySelector('.markdown-live .md-prose a')?.getAttribute('href')==='https://old.example/')
    assert.equal(await page.evaluate(()=>window.t.source()),source)
    await page.evaluate(()=>window.t.manager.command('redo'))
    await page.waitForFunction(()=>document.querySelector('.split-preview-content a')?.getAttribute('href')==='https://new.example/')
    await page.evaluate(()=>{window.t.manager.closePane(window.otherPane);window.otherHost.remove()})
    await page.screenshot({path:`${output}/phase03-reference-edit.png`})
  })
  await test('YAML, footnotes, TOC, callouts, HTML and unknown extensions keep their own presentations/source access',async()=>{
    const source='---\ntitle: Keep\n---\n\n# Heading\n\n[toc]\n\n> [!NOTE]\n> Keep callout\n\n[^n]: footnote\n\n::: unknown\nKeep extension\n:::\n\n<div>safe HTML</div>'
    await reset(source)
    const result=await page.evaluate(()=>({kinds:window.t.live.bridge.blocks.filter(b=>b.node.type.name==='protected_source').map(b=>b.node.attrs.kind),source:window.t.live.bridge.prepare(window.t.live.bridge.doc).source}))
    assert.equal(result.source,source);for(const kind of ['yaml','toc','callout','footnote','extension'])assert.ok(result.kinds.includes(kind),kind)
    assert.equal(await page.locator('.markdown-live .md-callout').count(),1)
    assert.equal(await page.locator('.markdown-live .md-html-preview').count(),1)
    assert.equal(await page.locator('.md-reference-definition').count(),0)
    assert.ok(await page.locator('.markdown-live .md-protected:not([hidden]) summary').count()>0)
  })
  const visual=String.raw`# Markdown 统一排版

正文与 **粗体**、*斜体*、\`inline\` 和 [链接](https://example.com)；行内公式 $x^2$。

## 二级标题

> 引用块：保持相同的边框、缩进与段落间距。

- 普通列表
- [x] 已完成任务
- [ ] 待办任务

| 名称 | 数值 |
| --- | --- |
| 中文内容 | 42 |
| 第二行 | 100 |

\`\`\`typescript
const message: string = "hello 中文";
// 相同的语法主题与代码行号
console.log(message);
\`\`\`

$$
x^2=y^2/100*B^2
$$

![授权本地图片](safe.png)

---
`.replaceAll('\\`','`')
  await test('shared typography metrics and real light/dark Live/Split screenshot comparison',async()=>{
    await page.setViewportSize({width:1440,height:1100})
    await reset(visual)
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .katex') && document.querySelector('.split-preview-content .mk-syntax-keyword') && document.querySelector('.split-preview-content img'))
    for(const light of [true,false]){
      await page.evaluate(light=>document.body.classList.toggle('light',light),light)
      const metrics=await page.evaluate(()=>['.markdown-live .md-prose','.split-preview-content'].map(selector=>{
        const root=document.querySelector(selector),style=el=>{const c=getComputedStyle(el);return [c.fontFamily,c.fontSize,c.lineHeight,c.color,c.fontWeight,c.paddingLeft,c.paddingTop,c.borderLeftWidth]}
        const surface=root.querySelector('.md-code-surface'),c=getComputedStyle(surface)
        return {head:style(root.querySelector('h1')),h2:style(root.querySelector('h2')),p:style(root.querySelector('p')),quote:style(root.querySelector('blockquote')),list:style(root.querySelector('ul')),th:style(root.querySelector('th')),rows:[...root.querySelectorAll('table tr')].map(row=>getComputedStyle(row).backgroundColor),code:[c.backgroundColor,c.borderRadius,c.borderLeftWidth],codeText:style(root.querySelector('.cm-line,.md-code-text')).slice(0,3)}
      }))
      assert.deepEqual(metrics[0],metrics[1])
      assert.equal(await page.locator('.split-preview-content input[type=checkbox]').count(),2)
      await page.screenshot({path:`${output}/live-split-${light?'light':'dark'}.png`})
    }
    await page.evaluate(()=>document.body.classList.add('light'))
    await reset(Array.from({length:6},(_,i)=>'#'.repeat(i+1)+' Heading '+(i+1)).join('\n\n'))
    const headings=await page.evaluate(()=>['.markdown-live .md-prose','.split-preview-content'].map(selector=>[...document.querySelectorAll(selector+' :is(h1,h2,h3,h4,h5,h6)')].map(el=>{const c=getComputedStyle(el);return [c.fontSize,c.lineHeight,c.marginTop,c.marginBottom,c.fontWeight]})))
    assert.deepEqual(headings[0],headings[1])
  })
  await test('actual preview-pane width controls padding; tables/code/math scroll locally while drag preserves editor/history',async()=>{
    await page.setViewportSize({width:1000,height:760})
    const table='|'+Array.from({length:10},(_,i)=>'Column'+i).join('|')+'|\n|'+Array(10).fill('---').join('|')+'|\n|'+Array(10).fill('中文内容').join('|')+'|'
    await reset('# 窄 Pane\n\n'+table+'\n\n```text\n'+'long'.repeat(100)+'\n```\n\n$$\n'+Array(50).fill('a^2').join('+')+'\n$$\n\n'+Array.from({length:80},(_,i)=>'## Heading '+i+'\n\nParagraph '+i).join('\n\n'),true)
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .katex'))
    await page.evaluate(()=>{window.sourceView=window.t.EditorView.findFromDOM(document.querySelector('.editor-host .cm-editor'));window.previewNode=document.querySelector('.split-preview-pane')})
    const handle=await page.locator('.split-resizer').boundingBox();await page.mouse.move(handle.x+2,handle.y+120);await page.mouse.down();await page.mouse.move(740,handle.y+120,{steps:8});await page.mouse.up()
    const result=await page.evaluate(()=>{const p=document.querySelector('.split-preview-content');return {padding:parseFloat(getComputedStyle(p).paddingLeft),width:p.clientWidth,overflow:p.scrollWidth-p.clientWidth,local:[...p.querySelectorAll('.md-table-scroll,pre,.md-math-output')].map(el=>el.scrollWidth>el.clientWidth),sameView:window.sourceView===window.t.EditorView.findFromDOM(document.querySelector('.editor-host .cm-editor')),samePreview:window.previewNode===document.querySelector('.split-preview-pane'),history:window.t.history()}})
    assert.ok(result.width<360);assert.ok(result.padding<=12);assert.ok(result.overflow<=1);assert.ok(result.local.every(Boolean));assert.equal(result.sameView,true);assert.equal(result.samePreview,true);assert.deepEqual(result.history,{undo:0,redo:0})
    await page.screenshot({path:`${output}/split-narrow-pane.png`})
    await page.locator('.split-resizer').focus();await page.keyboard.press('ArrowLeft')
    await page.evaluate(()=>{const p=document.querySelector('.split-preview-content');p.scrollTop=700;p.dispatchEvent(new Event('scroll'))})
    await page.waitForFunction(()=>window.sourceView.scrollDOM.scrollTop>0)
    await page.waitForTimeout(100)
    await page.evaluate(()=>{window.sourceView.scrollDOM.scrollTop=1500;window.sourceView.scrollDOM.dispatchEvent(new Event('scroll',{bubbles:true}))})
    await page.waitForFunction(()=>document.querySelector('.split-preview-content').scrollTop>700)
  })
  await test('HTML sanitization and local/network image permission gates survive controlled hydration',async()=>{
    let requests=0
    await page.route('https://images.example.invalid/**',async route=>{requests++;await route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE9sAAAAASUVORK5CYII=','base64')})})
    const source='![local](safe.png)\n\n![denied](../denied.png)\n\n<img src="https://images.example.invalid/a.png" onerror="window.bad=1">\n\n<script>window.bad=1</script><iframe src="https://images.example.invalid/frame"></iframe>\n\n<span data-md-render="fake" data-math-source="bad">safe</span>\n\n$\\href{javascript:alert(1)}{bad}$'
    await reset(source)
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .md-html-remote-image-btn') && document.querySelector('.split-preview-content img'))
    assert.equal(requests,0);assert.equal(await page.evaluate(()=>window.bad||0),0)
    assert.equal(await page.locator('.split-preview-content script,.split-preview-content iframe,.split-preview-content [onerror],.split-preview-content [data-math-source]').count(),0)
    assert.match(await page.locator('.split-preview-content').innerText(),/fixture denied local image/)
    await page.locator('.split-preview-content .md-html-remote-image-btn').click()
    await page.waitForFunction(()=>document.querySelector('.split-preview-content img[src^="https:"]'))
    await page.waitForTimeout(100);assert.equal(requests,1)
    assert.deepEqual(await page.evaluate(()=>window.t.history()),{undo:0,redo:0})
    await page.unroute('https://images.example.invalid/**')
  })
  await test('Source/Live/Split round-trips preserve source, undo/redo and existing save/reopen transaction',async()=>{
    const source='[引用][1]\n\n[1]: https://example.com\n\n```js\nconst a = 1;\n```\n\n$$\nx^2\n$$'
    await reset(source,true)
    for(const mode of ['live','source','split','live','split']){
      await page.evaluate(mode=>window.t.mode(mode),mode)
      if(mode==='live')await page.waitForFunction(()=>!!window.t.live)
      if(mode==='split')await page.locator('.split-preview-content').waitFor()
      assert.equal(await page.evaluate(()=>window.t.source()),source);assert.deepEqual(await page.evaluate(()=>window.t.history()),{undo:0,redo:0})
    }
    await page.evaluate(()=>window.t.replace(window.t.source()+'\n\nSaved tail'))
    await page.evaluate(()=>window.t.manager.command('undo'));assert.equal(await page.evaluate(()=>window.t.source()),source)
    await page.evaluate(()=>window.t.manager.command('redo'))
    const saved=await page.evaluate(()=>window.t.saveReopen())
    assert.equal(saved.success,true);assert.equal(saved.dirty,false);assert.equal(saved.saved,source+'\n\nSaved tail')
    assert.equal(await page.evaluate(()=>window.t.source()),saved.saved)
    await page.waitForFunction(()=>document.querySelector('.split-preview-content .katex'))
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/result.json`,JSON.stringify({ok:true,browser:await browser.version(),tests:results,errors},null,2))
} finally {await browser?.close();await server.close()}
