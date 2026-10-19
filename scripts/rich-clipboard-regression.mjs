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
      return [f.defaultSettings().markdownClipboard, f.settingsFrom({}).markdownClipboard,
        f.settingsFrom({markdownClipboard:{copyMarkdown:false,copyWholeLine:true}}).markdownClipboard,
        f.settingsFrom({markdownClipboard:{copyMarkdown:'false',copyWholeLine:1}}).markdownClipboard,
        f.persistedSettings(f.settingsFrom({markdownClipboard:{copyMarkdown:false}})).markdownClipboard,
        f.settingsFrom({settingsVersion:5,markdownClipboard:{copyMarkdown:true,copyWholeLine:true}}).markdownClipboard,
        f.settingsFrom({settingsVersion:6,markdownClipboard:{copyMarkdown:true,copyWholeLine:false}}).markdownClipboard]
    })
    assert.deepEqual(value, [{copyMarkdown:false,copyWholeLine:false},{copyMarkdown:false,copyWholeLine:false},{copyMarkdown:false,copyWholeLine:true},{copyMarkdown:false,copyWholeLine:false},{copyMarkdown:false,copyWholeLine:false},{copyMarkdown:false,copyWholeLine:true},{copyMarkdown:true,copyWholeLine:false}])
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
  await test('whole-table copy keeps semantic HTML and explicit Markdown; cutting cell text is undoable', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;f.all();const table=f.native();await f.live().clipboard('markdown');const markdown=f.copied();
      let pos;f.view().state.doc.descendants((node,at)=>{if(node.isText&&node.text==='admin')pos=at;});
      f.range(pos,pos+5);const cut=f.native(true),after=f.source();f.manager.command('undo');
      return {table,markdown,cut,after,undo:f.source()};
    })
    assert.doesNotMatch(value.table.text, /\||---/);assert.match(value.table.html, /<table>/)
    assert.equal(value.markdown.text,tableSource);assert.equal(value.cut.text,'admin')
    assert.doesNotMatch(value.after, /admin/);assert.equal(value.undo,tableSource)
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
  await test('plain-text preference and explicit Markdown/HTML/simplified copy', async () => {
    const value = await page.evaluate(async () => {
      const f=window.f;f.all();f.manager.setMarkdownClipboard({copyMarkdown:false,copyWholeLine:false});
      const plain=f.native();await f.live().clipboard('markdown');const markdown=f.copied();
      await f.live().clipboard('html');const html=f.copied();await f.live().clipboard('simplified');return {plain,markdown,html,simple:f.copied()};
    })
    assert.doesNotMatch(value.plain.text, /\*\*|^# /)
    assert.equal(value.markdown.text, source)
    assert.match(value.html.text, /<h1>/)
    assert.equal(value.html.html, '')
    assert.equal(value.simple.text, value.plain.text)
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
    await app.evaluate(()=>localStorage.setItem('markumo.settings.v1',JSON.stringify({settingsVersion:5,markdownClipboard:{copyMarkdown:true,copyWholeLine:false}})))
    await app.reload()
    await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-md-copy').waitFor({state:'attached'})
    await app.locator('#settings-md-copy').scrollIntoViewIfNeeded()
    assert.equal(await app.locator('#settings-md-copy').isChecked(),false)
    assert.equal(await app.locator('#settings-md-copy-line').isChecked(),false)
    await app.locator('#settings-md-copy').check()
    await app.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}');return saved.settingsVersion===6&&saved.markdownClipboard?.copyMarkdown===true})
    await app.reload();await app.getByTitle('设置',{exact:true}).click()
    await app.locator('#settings-md-copy').scrollIntoViewIfNeeded()
    assert.equal(await app.locator('#settings-md-copy').isChecked(),true)
    await app.locator('#settings-md-copy').uncheck()
    await app.locator('#settings-md-copy-line').check()
    await app.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').markdownClipboard?.copyWholeLine===true)
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
