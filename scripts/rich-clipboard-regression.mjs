// Headless, isolated clipboard: never reads or changes the user's OS clipboard.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/rich-clipboard'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {EditorState,AllSelection,TextSelection} from 'prosemirror-state';
import {CellSelection,TableMap} from 'prosemirror-tables';
import {textClipboard} from '/src/features/shell/clipboard.ts';
import {settingsFrom,defaultSettings,persistedSettings} from '/src/features/shell/editorSettings.ts';
import {createApp,h,ref} from 'vue';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';import '/src/styles/variables.css';
import '/src/editor/markdown/styles.css';
document.body.classList.add('light');
let text='',html='',delay=null,readDelay=null;
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
  async write(items){const item=items[0];text=await (await item.getType('text/plain')).text();html=await (await item.getType('text/html')).text();if(delay)await delay;},
  async writeText(value){text=value;html='';if(delay)await delay;},
  async readText(){if(readDelay)await readDelay;return text;}
}});
textClipboard.readText=()=>navigator.clipboard.readText();textClipboard.writeText=value=>navigator.clipboard.writeText(value);
const manager=new DocumentManager();const revision=ref(0);manager.subscribe(()=>revision.value++);
createApp({render(){revision.value;return h(EditorContainer,{manager,doc:manager.activeDocument,desktop:false});}}).mount('#app');
window.f={manager,settingsFrom,defaultSettings,persistedSettings,
  async reset(source){manager.setMarkdownClipboard(defaultSettings().markdownClipboard);const id=manager.createUntitled('md');manager.dispatch(id,{changes:{from:0,insert:source}});manager.setMarkdownMode(id,'live');},
  live:()=>manager.activeLiveEditor,view:()=>manager.activeLiveEditor.view,
  source:()=>manager.getText(manager.activeId),
  all(){const v=this.view();v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc)));},
  range(from,to=from){const v=this.view();v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc,from,to)));},
  cells(top,left,bottom=top,right=left){const v=this.view();let table,at;v.state.doc.descendants((node,pos)=>{if(node.type.name==='table'){table=node;at=pos;return false;}});const map=TableMap.get(table);v.dispatch(v.state.tr.setSelection(CellSelection.create(v.state.doc,at+1+map.map[top*map.width+left],at+1+map.map[bottom*map.width+right])));},
  native(cut=false){const data=new DataTransfer();this.view().dom.dispatchEvent(new ClipboardEvent(cut?'cut':'copy',{bubbles:true,cancelable:true,clipboardData:data}));return {text:data.getData('text/plain'),html:data.getData('text/html')};},
  copied:()=>({text,html}),setClipboard(value){text=value;},
  delayWrite(){delay=new Promise(resolve=>this.releaseWrite=()=>{delay=null;resolve();});},
  delayRead(){readDelay=new Promise(resolve=>this.releaseRead=()=>{readDelay=null;resolve();});}
};
window.notices=[];window.addEventListener('editor-notice',e=>window.notices.push(e.detail));
`)
const port = Number(process.env.MARKUMO_TEST_PORT || 1427)
const server = await createServer({ server: { port, strictPort: true } })
await server.listen()
let browser
const results = []
try {
  browser = await chromium.launch({ headless: true, ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}) })
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://localhost:${port}/` + output + '/index.html')
  await page.waitForFunction(() => window.f)
  const test = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name) }
  const reset = async source => {
    await page.evaluate(source => window.f.reset(source), source)
    await page.waitForFunction(() => window.f.live() && window.f.live().bridge.source === window.f.source())
  }
  await test('settings defaults, old preferences, validation and persistence', async () => {
    const value = await page.evaluate(() => {
      const f = window.f
      return [
        f.defaultSettings().markdownClipboard,
        f.settingsFrom({}).markdownClipboard,
        f.settingsFrom({markdownClipboard:{copyMarkdown:false,copyWholeLine:true}}).markdownClipboard,
        f.settingsFrom({markdownClipboard:{copyMarkdown:'false',copyWholeLine:1}}).markdownClipboard,
        f.persistedSettings(f.settingsFrom({markdownClipboard:{copyMarkdown:false}})).markdownClipboard,
        // Legacy version 5: explicitly saved true must be preserved
        f.settingsFrom({settingsVersion:5,markdownClipboard:{copyMarkdown:true,copyWholeLine:true}}).markdownClipboard,
        // Legacy version 5: explicitly saved false must be preserved
        f.settingsFrom({settingsVersion:5,markdownClipboard:{copyMarkdown:false,copyWholeLine:true}}).markdownClipboard,
        // Legacy version 5: omitted copyMarkdown field must default to false
        f.settingsFrom({settingsVersion:5,markdownClipboard:{copyWholeLine:true}}).markdownClipboard,
        // Legacy version 5: omitted markdownClipboard object must default to false
        f.settingsFrom({settingsVersion:5}).markdownClipboard,
        // Version 6: respects user choice (true or false)
        f.settingsFrom({settingsVersion:6,markdownClipboard:{copyMarkdown:true,copyWholeLine:false}}).markdownClipboard,
        f.settingsFrom({settingsVersion:6,markdownClipboard:{copyMarkdown:false,copyWholeLine:true}}).markdownClipboard,
      ]
    })
    assert.deepEqual(value, [
      {copyMarkdown:false,copyWholeLine:false},
      {copyMarkdown:false,copyWholeLine:false},
      {copyMarkdown:false,copyWholeLine:true},
      {copyMarkdown:false,copyWholeLine:false},
      {copyMarkdown:false,copyWholeLine:false},
      {copyMarkdown:true,copyWholeLine:true},
      {copyMarkdown:false,copyWholeLine:true},
      {copyMarkdown:false,copyWholeLine:true},
      {copyMarkdown:false,copyWholeLine:false},
      {copyMarkdown:true,copyWholeLine:false},
      {copyMarkdown:false,copyWholeLine:true},
    ])
  })
  await reset('# 基于SpringBoot+Vue的摄影约拍管理系统\n\n项目介绍地址：https://example.com/project')
  await test('a selected heading line copies visible text while explicit Markdown retains its heading',async()=>{
    const value=await page.evaluate(async()=>{
      const f=window.f;let at,text;
      f.view().state.doc.descendants((node,pos)=>{if(node.type.name==='heading'){at=pos+1;text=node.textContent;return false;}});
      f.range(at,at+text.length);const native=f.native();await f.live().clipboard('copy');const menu=f.copied();await f.live().clipboard('markdown');
      return {text,native,menu,markdown:f.copied()};
    });
    assert.equal(value.native.text,value.text);assert.equal(value.menu.text,value.text);assert.equal(value.markdown.text,'# '+value.text);
    assert.match(value.native.html,/<h1>/);assert.doesNotMatch(value.native.text,/^# /);
    await page.screenshot({path:`${output}/single-heading-copy.png`});
    await reset('# '+value.text+'\n');
    const whole=await page.evaluate(()=>{window.f.all();return window.f.native();});assert.equal(whole.text,value.text);
  })
  await test('visual wrapping of a single rich-text line never switches it to Markdown',async()=>{
    const text='自动折行仍然是同一逻辑行。'.repeat(18);
    await reset('**'+text+'**');await page.setViewportSize({width:580,height:800});
    const value=await page.evaluate(()=>{
      const f=window.f;f.all();const range=document.createRange();range.selectNodeContents(f.view().dom.querySelector('strong'));
      return {copy:f.native(),rows:new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size};
    });
    assert.ok(value.rows>1);assert.equal(value.copy.text,text);assert.match(value.copy.html,/<strong>/);
    await page.setViewportSize({width:1100,height:800});
  })
  await test('multiple logical lines automatically retain Markdown for paragraphs, lists, quotes and breaks',async()=>{
    const sources=['# 标题\n\n**正文** 与 [项目](https://example.com)\n\n- 第一项\n- 第二项','**第一行**\n第二行','第一行  \n**第二行**','- **第一项**\n- 第二项','> 引用 **第一段**\n>\n> 引用第二段'];
    for(const source of sources){
      await reset(source);
      const value=await page.evaluate(async()=>{const f=window.f;f.all();const native=f.native();await f.live().clipboard('copy');const menu=f.copied();await f.live().clipboard('simplified');return {native,menu,simple:f.copied()};});
      assert.equal(value.native.text,source);assert.equal(value.menu.text,source);assert.doesNotMatch(value.simple.text,/\*\*|^# |^- |^> /m);
      assert.equal(value.simple.html,value.native.html);
    }
  })
  await test('partial cross-paragraph selection and a selected final newline retain Markdown',async()=>{
    await reset('# 标题一\n\n**正文二**\n\n不要复制的段落');
    const partial=await page.evaluate(async()=>{
      const f=window.f;let title,body;
      f.view().state.doc.descendants((node,at)=>{if(node.isText&&node.text==='标题一')title=at;if(node.isText&&node.text==='正文二')body=at;});
      f.range(title+1,body+2);const native=f.native();await f.live().clipboard('copy');return {native,menu:f.copied()};
    });
    assert.equal(partial.native.text,'# 题一\n\n**正文**');assert.equal(partial.menu.text,partial.native.text);
    await reset('**第一行**\n第二行');
    const line=await page.evaluate(()=>{const f=window.f;let at;f.view().state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='第一行')at=pos;});f.range(at,at+4);return f.native();});
    assert.equal(line.text,'**第一行**\n');
  })
  await test('an endpoint at the next paragraph start copies Markdown without its first character',async()=>{
    const source='# 标题边界\n\n下一段正文';await reset(source);
    const value=await page.evaluate(async()=>{
      const f=window.f,v=f.view();let title,body;
      v.state.doc.descendants((node,at)=>{if(node.type.name==='heading')title=at+1;if(node.type.name==='paragraph')body=at+1;});
      const results=[];
      for(const [anchor,head] of [[title,body],[body,title]]){
        f.range(anchor,head);const native=f.native();await f.live().clipboard('copy');
        results.push({native,menu:f.copied(),to:v.state.selection.to,toOffset:v.state.selection.$to.parentOffset});
      }
      return {results,source:f.source()};
    });
    for(const item of value.results){assert.match(item.native.text,/^# 标题边界/);assert.doesNotMatch(item.native.text,/下一段正文/);assert.equal(item.menu.text,item.native.text);assert.equal(item.toOffset,0);}
    assert.equal(value.source,source);
  })
  await test('real App mouse dragging lands at the next line start and copies the crossed boundary',async()=>{
    const app=await browser.newPage({viewport:{width:1100,height:800}});app.on('pageerror',e=>errors.push(e.message));
    await app.goto(`http://localhost:${port}/`);
    await app.waitForFunction(()=>document.getElementById('app').__vue_app__?._instance?.setupState?.manager);
    const source='# 基于SpringBoot+Vue的摄影约拍管理系统\n\n项目获取地址：https://example.com/project\n\n项目体验地址：https://example.com/demo';
    await app.evaluate(source=>{
      const s=document.getElementById('app').__vue_app__._instance.setupState,m=s.manager;m.createUntitled('md');const id=m.activeId;
      m.dispatch(id,{changes:{from:0,to:m.getState(id).doc.length,insert:source}});m.setMarkdownMode(id,'live');window.testManager=m;
    },source);
    await app.locator('.md-prose h1').waitFor();
    const geometry=await app.evaluate(()=>{
      const v=window.testManager.activeLiveEditor.view;let title,body;v.state.doc.descendants((node,at)=>{if(node.type.name==='heading')title=at+1;if(node.type.name==='paragraph'&&body===undefined)body=at+1;});
      return {title,body,start:v.coordsAtPos(title),end:v.coordsAtPos(body)};
    });
    const start={x:geometry.start.left+1,y:(geometry.start.top+geometry.start.bottom)/2},end={x:geometry.end.left,y:(geometry.end.top+geometry.end.bottom)/2};
    for(const reverse of [false,true]){
      // Start a fresh selection gesture rather than double-clicking the previous
      // mouseup point or dragging the text that is still selected.
      await app.evaluate(({title})=>{const v=window.testManager.activeLiveEditor.view;v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc,title)));},geometry);
      await app.waitForTimeout(550);
      const from=reverse?end:start,to=reverse?start:end;await app.mouse.move(from.x,from.y);await app.mouse.down();await app.mouse.move(to.x,to.y,{steps:16});await app.mouse.up();
      await app.waitForFunction(({title,body})=>{const s=window.testManager.activeLiveEditor.view.state.selection;return s.from===title&&s.to===body},geometry);
      const value=await app.evaluate(()=>{
        const m=window.testManager,v=m.activeLiveEditor.view,s=v.state.selection,data=new DataTransfer();v.dom.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));
        return {offset:s.$to.parentOffset,text:data.getData('text/plain'),html:data.getData('text/html'),source:m.getText(m.activeId)};
      });
      assert.equal(value.offset,0);assert.match(value.text,/^# 基于SpringBoot\+Vue的摄影约拍管理系统/);assert.doesNotMatch(value.text,/项目获取地址/);assert.match(value.html,/<h1>/);assert.equal(value.source,source,reverse?'reverse drag':'forward drag');
    }
    await app.screenshot({path:`${output}/next-line-start-selection.png`});await app.close();
  })
  const tableSource = '| 角色 | 测试账号 | 测试密码 |\n| --- | --- | --- |\n| 系统管理员 | admin | 123456 |\n| 普通用户 | zhangsan | 123456 |'
  await reset(tableSource)
  await test('copying a cell word returns only that word in native and menu copy', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;let pos;
      f.view().state.doc.descendants((node,at)=>{if(node.isText&&node.text==='admin')pos=at;});
      f.range(pos,pos+5);const native=f.native();await f.live().clipboard('copy');const menu=f.copied();
      await f.live().clipboard('markdown');const markdown=f.copied();
      f.manager.setMarkdownClipboard({copyMarkdown:true,copyWholeLine:false});const optIn=f.native();
      f.range(pos+1,pos+4);const partial=f.native();
      return {native,menu,markdown,optIn,partial,source:f.source()};
    })
    for(const copy of [value.native,value.menu,value.markdown,value.optIn])assert.equal(copy.text,'admin')
    assert.equal(value.partial.text,'dmi')
    for(const copy of [value.native,value.menu,value.optIn,value.partial])assert.doesNotMatch(copy.html, /<table>|<th>|<td>|\|/)
    assert.equal(value.source,tableSource)
  })
  await reset('项目介绍地址：https://example.com/project?id=123&view=detail\n\n[查看项目](https://example.com/project)')
  await test('ordinary URL and labeled-link copy returns visible text without Markdown delimiters', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f,results=[];
      for(const text of ['https://example.com/project?id=123&view=detail','查看项目']){
        let pos;f.view().state.doc.descendants((node,at)=>{if(node.isText&&node.text===text)pos=at;});
        if(pos===undefined)throw Error('Missing link text '+text);
        f.range(pos,pos+text.length);const native=f.native();await f.live().clipboard('copy');
        results.push({text,native,menu:f.copied()});
      }
      return results;
    })
    for(const result of value){assert.equal(result.native.text,result.text);assert.equal(result.menu.text,result.text);assert.match(result.native.html, /<a href=/)}
  })
  await reset(tableSource)
  await test('whole-table copy keeps semantic HTML and Markdown; cutting cell text is undoable', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;f.all();const table=f.native();await f.live().clipboard('markdown');const markdown=f.copied();
      let pos;f.view().state.doc.descendants((node,at)=>{if(node.isText&&node.text==='admin')pos=at;});
      f.range(pos,pos+5);const cut=f.native(true),after=f.source();f.manager.command('undo');
      return {table,markdown,cut,after,undo:f.source()};
    })
    assert.equal(value.table.text,tableSource);assert.match(value.table.html, /<table>/)
    assert.equal(value.markdown.text,tableSource);assert.equal(value.cut.text,'admin')
    assert.doesNotMatch(value.after, /admin/);assert.equal(value.undo,tableSource)
  })
  await reset(tableSource)
  await test('explicit cell selection of header plus one row copies exactly the selected table', async () => {
    const copy=await page.evaluate(async()=>{const f=window.f;f.cells(0,0,1,2);const native=f.native();await f.live().clipboard('copy');return {native,menu:f.copied(),source:f.source()};});
    assert.equal(await page.locator('.selectedCell').count(),6);
    for(const value of [copy.native,copy.menu]){
      assert.match(value.text,/\| 角色 \| 测试账号 \| 测试密码 \|/);assert.match(value.text,/\| 系统管理员 \| admin \| 123456 \|/);
      assert.doesNotMatch(value.text,/zhangsan|普通用户/);assert.match(value.html,/<table>/);
    }
    assert.equal(copy.source,tableSource);
    await page.screenshot({path:`${output}/selected-table-copy.png`});
  })
  await test('rows, columns, rectangles, single cells and whole-table cell selections keep their grid', async () => {
    const cases=[{range:[1,0,1,2],grid:[['系统管理员','admin','123456']]},{range:[0,1,2,1],grid:[['测试账号'],['admin'],['zhangsan']]},{range:[1,1,2,2],grid:[['admin','123456'],['zhangsan','123456']]},{range:[1,1,1,1],grid:[['admin']]},{range:[0,0,2,2],grid:[['角色','测试账号','测试密码'],['系统管理员','admin','123456'],['普通用户','zhangsan','123456']]},{range:[1,2,0,0],grid:[['角色','测试账号','测试密码'],['系统管理员','admin','123456']]}];
    for(const item of cases){
      const value=await page.evaluate(async item=>{
        const f=window.f;f.cells(...item.range);const copy=f.native();await f.live().clipboard('copy');const menu=f.copied();
        const dom=new DOMParser().parseFromString(copy.html,'text/html');
        const grid=[...dom.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent));
        const headers=dom.querySelectorAll('th').length;await f.live().clipboard('markdown');
        return {copy,menu,grid,headers,markdown:f.copied(),source:f.source()};
      },item);
      assert.deepEqual(value.grid,item.grid,JSON.stringify(item.range));assert.equal(value.menu.text,value.copy.text);assert.equal(value.markdown.text,value.copy.text);
      assert.match(value.copy.text,/\|.*\|\n\|.*---/);assert.equal(value.headers,Math.min(...[item.range[0],item.range[2]])===0?item.grid[0].length:0);
      assert.equal(value.source,tableSource);
    }
  })
  await test('selected rows paste back as a table through native HTML and menu Markdown', async () => {
    for(const [top,expected] of [[0,[['角色','测试账号','测试密码'],['系统管理员','admin','123456']]],[1,[['','',''],['系统管理员','admin','123456']]]]){
      await reset(tableSource);
      const copied=await page.evaluate(async top=>{const f=window.f;f.cells(top,0,1,2);await f.live().clipboard('copy');return f.copied();},top);
      await reset('Paste target');
      const value=await page.evaluate(async copied=>{
        const f=window.f;f.all();f.setClipboard(copied.text);await f.live().clipboard('paste');
        const rows=[...f.view().dom.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent));
        return {rows,source:f.source()};
      },copied);
      assert.deepEqual(value.rows,expected);assert.doesNotMatch(value.source,/zhangsan/);
      await reset('Native paste target');
      const nativeRows=await page.evaluate(copied=>{
        const f=window.f;f.all();const data=new DataTransfer();data.setData('text/plain',copied.text);data.setData('text/html',copied.html);
        f.view().dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
        return [...f.view().dom.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent));
      },copied);
      assert.deepEqual(nativeRows,top===0?expected:expected.slice(1));
    }
  })
  await reset(tableSource)
  await test('cutting a table row copies its structure, clears selected cells only and undoes exactly', async()=>{
    const value=await page.evaluate(async()=>{const f=window.f;f.cells(1,0,1,2);await f.live().clipboard('cut');const copy=f.copied(),after=f.source();f.manager.command('undo');return {copy,after,undo:f.source()};});
    assert.match(value.copy.text,/\| 系统管理员 \| admin \| 123456 \|/);assert.doesNotMatch(value.after,/admin/);assert.match(value.after,/zhangsan/);assert.equal(value.undo,tableSource);
  })
  const source = '# 项目标题\n\n**加粗** 与 *斜体*、[链接](https://example.com)\n\n- 列表一\n- 列表二\n\n| A | B |\n| --- | --- |\n| 内容 | 😀 |\n\n```js\nconst n = 1\n```\n'
  await reset(source)
  await test('Markdown opt-in preserves exact whole-document source and semantic HTML', async () => {
    const copy = await page.evaluate(() => {window.f.manager.setMarkdownClipboard({copyMarkdown:true,copyWholeLine:false});window.f.all();return window.f.native()})
    assert.equal(copy.text, source)
    assert.match(copy.html, /<h1>项目标题<\/h1>/)
    assert.match(copy.html, /<strong>加粗<\/strong>/)
    assert.match(copy.html, /<table>/)
    assert.doesNotMatch(copy.html, /md-code-tools|contenteditable|onerror|data-pm-/)
  })
  await test('partial inline selection retains Markdown marks', async () => {
    const value = await page.evaluate(() => {
      const f=window.f,v=f.view();let pos;
      v.state.doc.descendants((node,at)=>{if(node.isText&&node.text==='加粗')pos=at;});
      f.range(pos,pos+2);return f.native();
    })
    assert.equal(value.text, '**加粗**')
  })
  await test('automatic multi-line copy and explicit Markdown/HTML/simplified copy', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;f.all();f.manager.setMarkdownClipboard({copyMarkdown:false,copyWholeLine:false});
      const plain=f.native();await f.live().clipboard('markdown');const markdown=f.copied();
      await f.live().clipboard('html');const html=f.copied();await f.live().clipboard('simplified');return {plain,markdown,html,simple:f.copied()};
    })
    assert.equal(value.plain.text, source)
    assert.equal(value.markdown.text, source)
    assert.match(value.html.text, /<h1>/)
    assert.equal(value.html.html, '')
    assert.doesNotMatch(value.simple.text, /\*\*|^# /)
    assert.match(value.simple.text, /项目标题/)
    assert.match(value.simple.html, /<strong>/)
  })
  await reset('first\nsecond\nthird')
  await test('no-selection opt-in copies/cuts logical line, undo restores content', async () => {
    const value = await page.evaluate(() => {
      const f=window.f;f.range(8);const disabled=f.native();
      f.manager.setMarkdownClipboard({copyMarkdown:true,copyWholeLine:true});
      const copy=f.native();f.native(true);const cut=f.source();f.manager.command('undo');return {disabled,copy,cut,undo:f.source()};
    })
    assert.equal(value.disabled.text, '')
    assert.match(value.copy.text, /^second/)
    assert.doesNotMatch(value.cut, /second/)
    assert.equal(value.undo, 'first\nsecond\nthird')
  })
  await reset('Original')
  await test('Markdown paste parses formatting; plain paste inserts literal syntax', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;f.all();f.setClipboard('## Title\n\n**bold**');await f.live().clipboard('paste');
      const rendered=f.view().dom.innerHTML;f.all();f.setClipboard('**literal**');await f.live().clipboard('paste-plain');
      return {rendered,text:f.view().state.doc.textContent,source:f.source()};
    })
    assert.match(value.rendered, /<h2>/)
    assert.match(value.rendered, /<strong>bold<\/strong>/)
    assert.equal(value.text, '**literal**')
    assert.match(value.source, /\\\*/)
  })
  await reset('Do not cut a different selection')
  await test('asynchronous cut and paste cancel after selection changes', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;f.range(1,3);f.delayWrite();const cutting=f.live().clipboard('cut');
      f.range(4);f.releaseWrite();await cutting;const cut=f.source();
      f.setClipboard('replacement');f.delayRead();const pasting=f.live().clipboard('paste').catch(e=>String(e));
      f.range(5);f.releaseRead();return {cut,error:await pasting,paste:f.source()};
    })
    assert.equal(value.cut, 'Do not cut a different selection');assert.equal(value.paste,value.cut)
    assert.match(value.error, /选区变化/)
  })
  await reset('## 四、技术栈\n\n后端：**Spring Boot**\n\n前端：Vue')
  const prose = page.locator('.md-prose')
  await test('rich context menu structure, heading state and keyboard navigation', async () => {
    await page.evaluate(() => window.f.range(2,5))
    await prose.locator('h2').click({button:'right',position:{x:20,y:15}})
    const menu = page.getByRole('menu', {name:'富文本编辑',exact:true})
    await menu.waitFor();assert.equal(await menu.locator('.md-context-icons').count(),3)
    assert.equal(await menu.getByRole('menuitem',{name:'复制',exact:true}).isEnabled(),true)
    await menu.getByRole('menuitem',{name:'复制 / 粘贴为…',exact:true}).hover()
    await page.getByRole('menuitem',{name:'复制为 Markdown',exact:true}).waitFor()
    await page.screenshot({path:`${output}/copy-menu.png`})
    await menu.getByRole('menuitem',{name:'二级标题',exact:true}).hover()
    assert.equal(await page.getByRole('menuitemradio',{name:'二级标题',exact:true}).getAttribute('aria-checked'),'true')
    await page.getByRole('menuitemradio',{name:'一级标题',exact:true}).click()
    assert.match(await page.evaluate(()=>window.f.source()),/^# 四、技术栈/)
    await prose.locator('h1').click({button:'right'})
    await menu.getByRole('menuitem',{name:'插入',exact:true}).hover()
    for(const name of ['图像','脚注','链接引用','表格','代码块','公式块','内容目录','YAML Front Matter','段落（上方）','段落（下方）']) await page.getByRole('menuitem',{name,exact:true}).waitFor()
    await page.screenshot({path:`${output}/insert-menu.png`})
    await page.getByRole('menuitem',{name:'图像',exact:true}).focus();await page.keyboard.press('ArrowLeft')
    assert.equal(await menu.getByRole('menuitem',{name:'插入',exact:true}).evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Escape');assert.equal(await page.locator('.md-context-menu').count(),0)
  })
  await test('rich-only heading shortcuts and literal paste shortcut', async () => {
    await page.evaluate(() => window.f.range(2))
    await prose.focus();await page.keyboard.press('Control+3')
    assert.match(await page.evaluate(()=>window.f.source()),/^### /)
    await page.keyboard.press('Control+0')
    assert.doesNotMatch(await page.evaluate(()=>window.f.source()),/^#/)
    await page.evaluate(()=>{window.f.all();window.f.setClipboard('**plain**')})
    await page.keyboard.press('Control+Shift+V')
    assert.equal(await page.evaluate(()=>window.f.view().state.doc.textContent),'**plain**')
  })
  await test('format icons reflect state and toggle quote/list/task formatting', async () => {
    const click = async name => {
      await prose.locator('p').first().click({button:'right',position:{x:12,y:10}})
      await page.getByRole('menuitem',{name,exact:true}).click()
    }
    await reset('Item')
    await click('引用');assert.match(await page.evaluate(()=>window.f.source()),/^> Item/)
    await click('引用');assert.equal(await page.evaluate(()=>window.f.source()),'Item')
    await click('无序列表');assert.match(await page.evaluate(()=>window.f.source()),/^- Item/)
    await click('有序列表');assert.match(await page.evaluate(()=>window.f.source()),/^1\. Item/)
    await click('任务列表');assert.match(await page.evaluate(()=>window.f.source()),/^- \[ \] Item/)
    await click('任务列表');assert.match(await page.evaluate(()=>window.f.source()),/^- Item/)
    await click('无序列表');assert.equal(await page.evaluate(()=>window.f.source()),'Item')
  })
  await test('insert entries produce real source and are undoable', async () => {
    for (const [name,pattern] of [['脚注',/\[\^1\]: 脚注内容/],['链接引用',/\[链接\]\[1\][\s\S]*\[1\]: https:\/\/example.com/],['公式块',/\$\$\nx\^2\n\$\$/],['内容目录',/\[TOC\]/],['YAML Front Matter',/^---\ntitle: ""\n---/],['表格',/\|.*\|/],['段落（上方）',/^\n/],['段落（下方）',/\n/]]) {
      await reset('Text');await page.evaluate(()=>window.f.range(1));
      await prose.locator('p').first().click({button:'right'})
      await page.getByRole('menuitem',{name:'插入',exact:true}).hover()
      await page.getByRole('menuitem',{name,exact:true}).click()
      assert.match(await page.evaluate(()=>window.f.source()),pattern,name)
      await page.evaluate(()=>window.f.manager.command('undo'))
      assert.equal(await page.evaluate(()=>window.f.source()),'Text',name+' undo')
    }
  })
  await test('read-only editor copies but blocks mutation', async () => {
    await reset('Read only')
    const value = await page.evaluate(async()=>{
      const f=window.f;f.all();f.live().options.readOnly=()=>true;const copy=f.native();f.native(true);
      f.setClipboard('bad');await f.live().clipboard('paste');f.live().format('bold');return {copy,source:f.source()};
    })
    assert.equal(value.copy.text,'Read only');assert.equal(value.source,'Read only')
  })
  await test('menu closes on editor disposal; source pane keeps native context menu', async () => {
    await reset('Final');await prose.locator('p').click({button:'right'})
    assert.equal(await page.locator('.md-context-menu').count(),1)
    await page.evaluate(()=>{const f=window.f;f.manager.setMarkdownMode(f.manager.activeId,'source')})
    await page.locator('.cm-content').waitFor();assert.equal(await page.locator('.md-context-menu').count(),0)
    await page.locator('.cm-content').click({button:'right'});assert.equal(await page.locator('.md-context-menu').count(),0)
  })
  await test('real settings UI saves and reloads clipboard preferences', async () => {
    const app = await browser.newPage()
    app.on('pageerror',e=>errors.push(e.message))
    await app.goto(`http://localhost:${port}/`)

    // 1. settingsVersion: 5 with explicitly saved copyMarkdown: true -> preserved as checked
    await app.evaluate(()=>localStorage.setItem('markumo.settings.v1',JSON.stringify({settingsVersion:5,markdownClipboard:{copyMarkdown:true,copyWholeLine:false}})))
    await app.reload()
    await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-md-copy').waitFor({state:'attached'})
    await app.locator('#settings-md-copy').scrollIntoViewIfNeeded()
    assert.equal(await app.locator('#settings-md-copy').isChecked(),true)
    assert.equal(await app.locator('#settings-md-copy-line').isChecked(),false)

    // 2. settingsVersion: 5 with omitted copyMarkdown -> defaults to unchecked
    await app.evaluate(()=>localStorage.setItem('markumo.settings.v1',JSON.stringify({settingsVersion:5,markdownClipboard:{copyWholeLine:true}})))
    await app.reload()
    await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-md-copy').waitFor({state:'attached'})
    await app.locator('#settings-md-copy').scrollIntoViewIfNeeded()
    assert.equal(await app.locator('#settings-md-copy').isChecked(),false)
    assert.equal(await app.locator('#settings-md-copy-line').isChecked(),true)

    // 3. User checks copyMarkdown -> persists to settingsVersion 6 with copyMarkdown: true
    await app.locator('#settings-md-copy').check()
    await app.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}');return saved.settingsVersion===6&&saved.markdownClipboard?.copyMarkdown===true})
    await app.reload();await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-md-copy').scrollIntoViewIfNeeded()
    assert.equal(await app.locator('#settings-md-copy').isChecked(),true)

    // 4. User unchecks copyMarkdown and checks copyWholeLine -> persists to settingsVersion 6 with copyMarkdown: false, copyWholeLine: true
    await app.locator('#settings-md-copy').uncheck()
    await app.locator('#settings-md-copy-line').check()
    await app.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').markdownClipboard?.copyWholeLine===true&&JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').markdownClipboard?.copyMarkdown===false)
    await app.screenshot({path:`${output}/settings.png`})
    await app.reload();await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-md-copy').scrollIntoViewIfNeeded()
    assert.equal(await app.locator('#settings-md-copy').isChecked(),false)
    assert.equal(await app.locator('#settings-md-copy-line').isChecked(),true)
    await app.getByRole('button',{name:'完成',exact:true}).click()
    await app.getByRole('menuitem',{name:'文件',exact:true}).click()
    await app.getByRole('menuitem',{name:'新建 Markdown',exact:true}).click()
    const body=app.locator('.md-prose');await body.waitFor();await body.click()
    await app.keyboard.insertText('标题');await app.keyboard.press('Control+2')
    await body.locator('h2').waitFor()
    const plain=await body.evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain')})
    assert.equal(plain,'标题') // No selection: persisted whole-line + plain-text settings.
    await app.keyboard.press('Control+0');await body.locator('p').waitFor()
    await app.close()
  })
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.notices),[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:results,errors},null,2))
  console.log(`PASS ${results.length} rich clipboard/context menu checks`)
} finally { await browser?.close(); await server.close() }
