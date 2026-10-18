import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const output='test-results/settings-keybindings';fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,nextTick} from 'vue';import App from '/src/App.vue';
import * as keys from '/src/features/shell/keybindings/index.ts';import * as settings from '/src/features/shell/editorSettings.ts';
import {EditorView} from '@codemirror/view';import {EditorSelection} from '@codemirror/state';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';import '/src/editor/markdown/styles.css';import '/src/editor/core/searchPanel.css';
const app=createApp(App);app.mount('#app');window.s=app._instance.setupState;window.f={...keys,...settings,EditorView,EditorSelection,nextTick};
window.doc=async(text,kind='txt',mode='source')=>{const m=window.s.manager;m.mergeAllPanes();m.createUntitled(kind);const id=m.activeId;m.dispatch(id,{changes:{from:0,to:m.getState(id).doc.length,insert:text},selection:{anchor:0}});if(kind==='md')m.setMarkdownMode(id,mode);await nextTick();return id};
`)
const server=await createServer({server:{host:'127.0.0.1',port:1434,strictPort:true}});await server.listen()
const browser=await chromium.launch({executablePath:process.env.MARKUMO_CHROME,headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1200,height:850},reducedMotion:'reduce'})
const errors=[],results=[];page.on('pageerror',error=>errors.push(error.message))
const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS',name)}catch(error){results.push({name,pass:false,error:String(error)});await page.screenshot({path:`${output}/failure.png`});throw error}}
const openSettings=async section=>{await page.evaluate(id=>window.s.settingsRef.openSection(id),section);await page.waitForTimeout(70)}
const closeSettings=async()=>{await page.evaluate(()=>window.s.settingsRef.close());await page.waitForTimeout(60)}
const content=page.locator('.settings-content')
const row=id=>page.locator('.shortcut-item-row').filter({has:page.locator(`[data-command-id="${id}"]`)})
async function edit(id,key){await page.getByRole('textbox',{name:'搜索快捷键',exact:true}).fill(id);const target=row(id);await target.locator('.keycap-container').click();await page.keyboard.press(key);return target}
async function text(){return page.evaluate(()=>window.s.manager.getState(window.s.manager.activeId).doc.toString())}
try{
 await page.goto('http://127.0.0.1:1434/test-results/settings-keybindings/index.html');await page.waitForFunction(()=>window.s?.manager&&window.f)
 await test('catalog defaults, presets, every command has an actual shell entry',async()=>{
   const result=await page.evaluate(()=>{const f=window.f;return {missing:f.allCommands.filter(c=>!window.s.commandRegistry.get(c.id)).map(c=>c.id),presets:['markumo','fleet','typora'].map(id=>({id,errors:f.validatePresetConflicts(f.getPresetBindings(id)),validation:f.validateShortcuts(f.getPresetBindings(id))})),count:Object.keys(f.defaultSettings().shortcuts).length,catalog:f.allCommands.length}})
   assert.deepEqual(result.missing,[]);assert.equal(result.count,result.catalog);for(const preset of result.presets){assert.deepEqual(preset.errors,[]);assert.equal(preset.validation,null)}
 })
 await test('per-entry legacy migration preserves custom/cleared/full-map bindings and added prefs',async()=>{
  const result=await page.evaluate(()=>{const f=window.f,s=f.settingsFrom({shortcutVersion:3,keymapPreset:'fleet',shortcuts:{new:'Mod+Alt+N',bold:'',table:'Mod+Alt+T','delete-line':'Mod+Y'},customShortcuts:['new','bold','table'],caretAnimation:'quick',autoDownloadUpdates:true});const round=f.settingsFrom(f.persistedSettings(s));const old=f.settingsFrom({shortcutVersion:1,shortcuts:{sidebar:'Mod+B',replace:'Mod+H'}});const bad=f.settingsFrom({shortcuts:{new:'Mod+Alt+N',bold:'invalid key'}});return {bindings:round.shortcuts,custom:round.customShortcuts,prefs:[round.caretAnimation,round.autoDownloadUpdates],old:[old.shortcuts.sidebar,old.shortcuts.replace],bad:bad.shortcuts.new}})
  assert.equal(result.bindings.new,'Mod+Alt+N');assert.equal(result.bindings.bold,'');assert.equal(result.bindings.table,'Mod+Alt+T');assert.equal(result.bindings['delete-line'],'Mod+Y');assert.deepEqual(result.prefs,['quick',true]);assert.deepEqual(result.old,['Mod+Alt+B','Mod+R']);assert.equal(result.bad,'Mod+Alt+N')
 })
 await test('Windows/macOS modifiers, PageUp and punctuation normalization, IME and AltGraph',async()=>{
   const result=await page.evaluate(()=>{const f=window.f;return [f.normalizeKeybinding('Shift+Alt+ArrowDown'),f.normalizeKeybinding('mod+pageDown'),f.normalizeKeybinding('cmd+shift+k'),f.eventToKeybinding(new KeyboardEvent('keydown',{key:'π',code:'Digit1',metaKey:true,altKey:true}),'MacIntel'),f.eventToKeybinding(new KeyboardEvent('keydown',{key:'P',ctrlKey:true}),'MacIntel'),f.eventToKeybinding(new KeyboardEvent('keydown',{key:'p',ctrlKey:true}),'Win32'),f.eventToKeybinding(new KeyboardEvent('keydown',{key:'x',ctrlKey:true,isComposing:true}),'Win32'),f.formatKeycaps('Mod+Alt+Shift+P','MacIntel')]})
   assert.deepEqual(result,['Alt+Shift+ArrowDown','Mod+PageDown','Mod+Shift+K','Mod+Alt+1',null,'Mod+P',null,['⌘','⌥','⇧','P']])
 })
 await test('scope overlap and atomic reassignment remove every overlapping owner',async()=>{
   const result=await page.evaluate(()=>{const f=window.f,b=f.getPresetBindings('markumo'),next=f.reassignBinding(b,'table','Mod+0');return {conflict:f.checkBindingConflict('table','Mod+0',b)?.commandId,editor:f.commandsOverlap('delete-line','table'),global:f.commandsOverlap('zoom-reset','heading-0'),image:f.checkBindingConflict('image','Mod+Shift+I',b),keys:[next.table,next['heading-0'],next['zoom-reset']],live:f.matchingCommand('Mod+0',b,'live').id,plain:f.matchingCommand('Mod+0',b,'text').id}})
   assert.equal(result.global,true);assert.equal(result.editor,true);assert.equal(result.image,null);assert.deepEqual(result.keys,['Mod+0','','']);assert.equal(result.live,'heading-0');assert.equal(result.plain,'zoom-reset')
 })
 await test('manual scroll, top/bottom, PageDown and smooth navigation use only content',async()=>{
   await openSettings('appearance');assert.equal(await page.getByRole('button',{name:'外观',exact:true}).getAttribute('aria-current'),'location')
   for(const id of ['editor','workspace','updates','save','markdown','conversion','shortcuts']){await content.evaluate((el,id)=>{const section=document.getElementById('settings-'+id);el.scrollTop+=section.getBoundingClientRect().top-el.getBoundingClientRect().top-22},id);await page.waitForTimeout(40);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-'+id)}
   await content.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(40);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-shortcuts')
   await page.getByRole('button',{name:'外观',exact:true}).click();await page.waitForTimeout(40);assert.equal(await content.evaluate(el=>el.scrollTop),0)
   await content.focus();await page.keyboard.press('PageDown');await page.waitForTimeout(150);assert.notEqual(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-appearance');assert.equal(await page.evaluate(()=>window.scrollY),0)
 })
 await test('dragging the native content scrollbar selects the final category',async()=>{
   await content.evaluate(el=>el.scrollTop=0);await page.waitForTimeout(40);const rect=await content.boundingBox();const thumb=await content.evaluate(el=>Math.max(18,el.clientHeight*el.clientHeight/el.scrollHeight));await page.mouse.move(rect.x+rect.width-3,rect.y+thumb/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width-3,rect.y+rect.height-2,{steps:12});await page.mouse.up();await page.waitForTimeout(80);assert.equal(await content.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<3),true);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-shortcuts')
 })
 await test('segmented controls keyboard, indentation 1–8, conversion persistence and reload',async()=>{
  await openSettings('appearance');await page.locator('#settings-theme').getByRole('radio',{name:'深色',exact:true}).click();await page.locator('#settings-theme').getByRole('radio',{name:'深色',exact:true}).press('ArrowRight');assert.equal(await page.evaluate(()=>window.s.theme),'system')
  await openSettings('workspace');await page.locator('#settings-tree-click').getByRole('radio',{name:'单击（默认）',exact:true}).click();await page.locator('#settings-auto-follow').getByRole('radio',{name:'开启',exact:true}).click();assert.equal(await page.evaluate(()=>window.s.autoFollowActiveFile),true)
  await openSettings('editor');await page.locator('#settings-indent').fill('7');await page.locator('#settings-indent').dispatchEvent('change');assert.equal(await page.evaluate(()=>window.s.indentSize),7)
  await openSettings('markdown');await page.locator('#settings-md-mode').getByRole('radio',{name:'源码',exact:true}).click()
  await openSettings('conversion');await page.locator('#settings-pdf-orientation').getByRole('radio',{name:'横向',exact:true}).click()
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').indentSize===7);await closeSettings();await page.reload();await page.waitForFunction(()=>window.s.indentSize===7)
  await openSettings('workspace');assert.equal(await page.locator('#settings-tree-click').getByRole('radio',{name:'单击（默认）',exact:true}).getAttribute('aria-checked'),'true');assert.equal(await page.locator('#settings-auto-follow').getByRole('radio',{name:'开启',exact:true}).getAttribute('aria-checked'),'true');await openSettings('conversion');assert.equal(await page.locator('#settings-pdf-orientation').getByRole('radio',{name:'横向',exact:true}).getAttribute('aria-checked'),'true')
 })
 await test('recorder edit, explicit clear and restart retain unbound command',async()=>{
  await openSettings('shortcuts');await edit('table','Control+Alt+T');assert.equal(await page.evaluate(()=>window.s.shortcuts.table),'Mod+Alt+T')
  await row('table').locator('.keycap-container').click();await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>window.s.shortcuts.table),'')
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}').shortcuts.table==='');await closeSettings();await page.reload();await page.waitForFunction(()=>window.s.shortcuts?.table==='');await openSettings('shortcuts');await page.getByRole('textbox',{name:'搜索快捷键',exact:true}).fill('table');assert.equal(await row('table').locator('.keycap-unset').innerText(),'未设置')
 })
 await test('restore individual default checks conflict; cancel and confirmed reassign persist both sides',async()=>{
  await page.getByRole('textbox',{name:'搜索快捷键',exact:true}).fill('table');await row('table').getByRole('button',{name:'恢复默认',exact:true}).click();assert.equal(await page.evaluate(()=>window.s.shortcuts.table),'Mod+T')
  let target=await edit('table','Control+K');await target.getByTitle('取消',{exact:true}).click();assert.equal(await page.evaluate(()=>window.s.shortcuts.table),'Mod+T');assert.equal(await page.evaluate(()=>window.s.shortcuts.link),'Mod+K')
  target=await edit('table','Control+K');await target.getByRole('button',{name:'重新分配',exact:true}).click();assert.deepEqual(await page.evaluate(()=>[window.s.shortcuts.link,window.s.shortcuts.table]),['','Mod+K'])
  await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}');return s.shortcuts.link===''&&s.shortcuts.table==='Mod+K'})
 })
 await test('preset switch requires explicit confirmation and resets atomically',async()=>{
  await page.locator('#settings-keymap-preset').selectOption('fleet');await page.locator('.preset-confirm').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>window.s.keymapPreset),'markumo');assert.equal(await page.evaluate(()=>window.s.shortcuts.table),'Mod+K')
  await page.locator('#settings-keymap-preset').selectOption('fleet');await page.getByRole('button',{name:'确认应用',exact:true}).click();assert.deepEqual(await page.evaluate(()=>[window.s.keymapPreset,window.s.shortcuts.bold,window.s.shortcuts.redo,window.s.shortcuts['copy-line-down']]),['fleet','','Mod+Shift+Z','Mod+D'])
  await page.locator('#settings-keymap-preset').selectOption('typora');await page.getByRole('button',{name:'确认应用',exact:true}).click();assert.equal(await page.evaluate(()=>window.s.shortcuts['workspace-search']),'')
  await page.locator('#settings-keymap-preset').selectOption('markumo');await page.getByRole('button',{name:'确认应用',exact:true}).click()
 })
 await test('filter/search height changes retain navigation and no horizontal overflow with 20px UI',async()=>{
  await page.getByRole('textbox',{name:'搜索快捷键',exact:true}).fill('Ctrl+Shift+K');assert.equal(await page.locator('.shortcut-item-row').count(),1)
  await page.getByRole('textbox',{name:'搜索快捷键',exact:true}).fill('');await page.getByRole('radiogroup',{name:'筛选快捷键'}).getByRole('radio',{name:'未绑定',exact:true}).click();await page.waitForTimeout(60);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-shortcuts')
  await page.getByRole('radiogroup',{name:'筛选快捷键'}).getByRole('radio',{name:'全部',exact:true}).click();await page.evaluate(()=>window.s.uiFontSize=20);await page.setViewportSize({width:540,height:720});await openSettings('shortcuts');await page.waitForTimeout(100);assert.equal(await content.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.screenshot({path:`${output}/narrow-large-font.png`})
  await page.setViewportSize({width:1200,height:850});await page.evaluate(()=>{window.s.uiFontSize=14;window.s.theme='dark'});await openSettings('shortcuts');await page.screenshot({path:`${output}/settings-dark.png`});await page.evaluate(()=>window.s.theme='light');await page.screenshot({path:`${output}/settings-light.png`});await closeSettings()
 })
 await test('custom editor command executes, old native key is suppressed, Fleet line actions work',async()=>{
  await page.evaluate(()=>window.doc('one\ntwo\nthree'));await page.locator('.cm-content').click();await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,'delete-line':'Mod+Alt+K'});s.manager.activeEditorView.dispatch({selection:{anchor:0}});s.manager.activeEditorView.focus()});await page.keyboard.press('Control+Shift+K');assert.equal(await text(),'one\ntwo\nthree');await page.keyboard.press('Control+Alt+K');assert.equal(await text(),'two\nthree')
  await page.evaluate(()=>window.s.updateKeymap({preset:'fleet',bindings:window.f.getPresetBindings('fleet')}));await page.keyboard.press('Control+D');assert.equal(await text(),'two\ntwo\nthree');await page.keyboard.press('Control+Z');assert.equal(await text(),'two\nthree');await page.keyboard.press('Control+Shift+Z');assert.equal(await text(),'two\ntwo\nthree')
 })
 await test('cleared native binding stays disabled, native navigation, clipboard and input undo survive',async()=>{
   await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,'copy-line-down':''});s.manager.activeEditorView.focus()});const before=await text();await page.keyboard.press('Control+D');assert.equal(await text(),before);await page.keyboard.press('End');await page.keyboard.type('!');assert.ok((await text()).includes('!'))
   await page.evaluate(()=>{const input=document.createElement('input');input.id='external-input';document.body.append(input);input.focus()});await page.keyboard.type('hello');await page.keyboard.press('Control+A');await page.keyboard.type('world');await page.keyboard.press('Control+Z');assert.equal(await page.locator('#external-input').inputValue(),'hello');await page.locator('#external-input').evaluate(el=>el.remove())
 })
 await test('Markdown source formatting, heading-0 and rebinding execute through real commands',async()=>{
  await page.evaluate(()=>{window.s.updateKeymap({preset:'markumo',bindings:window.f.getPresetBindings('markumo')});return window.doc('## title\ntext','md','source')});await page.waitForSelector('.cm-content');await page.evaluate(()=>window.s.manager.activeEditorView.focus());await page.keyboard.press('Control+0');assert.equal(await text(),'title\ntext');await page.keyboard.press('Control+1');assert.equal(await text(),'# title\ntext')
  await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,bold:'Mod+Alt+B',sidebar:''});s.manager.activeEditorView.dispatch({selection:{anchor:2,head:7}})});await page.keyboard.press('Control+B');assert.equal(await text(),'# title\ntext');await page.keyboard.press('Control+Alt+B');assert.equal(await text(),'# **title**\ntext')
 })
 await test('live Markdown custom binding, unbinding, source mode command and Mod+0 priority',async()=>{
   await page.evaluate(()=>window.doc('## title\n\ntext','md','live'));await page.waitForSelector('.md-prose');await page.locator('.md-prose h2').click();await page.keyboard.press('Home');await page.keyboard.press('Control+0');assert.ok(!(await text()).includes('##'))
   await page.keyboard.press('Control+A');await page.keyboard.press('Control+Alt+B');assert.ok((await text()).includes('**'))
   await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,bold:''})});const before=await text();await page.keyboard.press('Control+B');assert.equal(await text(),before)
   await page.keyboard.press('Control+Alt+2');await page.waitForSelector('.cm-content');assert.equal(await page.evaluate(()=>window.s.manager.activeDocument.mode),'source')
 })
 await test('embedded CodeMirror line command targets nested code, custom undo synchronizes source',async()=>{
   await page.evaluate(()=>{window.s.updateKeymap({preset:'fleet',bindings:window.f.getPresetBindings('fleet')});return window.doc('intro\n\n```js\none\ntwo\n```\n\nend','md','live')});await page.waitForSelector('.md-code-block .cm-content');await page.locator('.md-code-block .cm-content').click();await page.evaluate(()=>{const view=window.f.EditorView.findFromDOM(document.activeElement);view.dispatch({selection:{anchor:0}});view.focus()});await page.keyboard.press('Control+D');assert.ok((await text()).includes('one\none\ntwo'));await page.keyboard.press('Control+Z');assert.ok(!(await text()).includes('one\none'))
 })
 await test('split pane commands use aliases and edits synchronize same document',async()=>{
   await page.evaluate(()=>{window.s.updateKeymap({preset:'markumo',bindings:window.f.getPresetBindings('markumo')});return window.doc('same\ntext')});await page.evaluate(()=>window.s.manager.activeEditorView.focus());await page.keyboard.press('Control+\\');await page.waitForFunction(()=>window.s.manager.isSplit);assert.equal(await page.locator('.cm-content').count(),2);await page.keyboard.type('X');assert.equal(await page.locator('.cm-content').nth(0).innerText(),await page.locator('.cm-content').nth(1).innerText());await page.keyboard.press('Control+Alt+W');assert.equal(await page.evaluate(()=>window.s.manager.isSplit),false)
 })
 await test('IME composition and settings dialog never dispatch editor commands; reopen initializes first category',async()=>{
   const result=await page.evaluate(()=>{const s=window.s,before=s.manager.getState(s.manager.activeId).doc.toString();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,shiftKey:true,isComposing:true,bubbles:true,cancelable:true}));return before===s.manager.getState(s.manager.activeId).doc.toString()});assert.equal(result,true)
   await openSettings('shortcuts');const before=await text();await page.keyboard.press('Control+Shift+K');assert.equal(await text(),before);await closeSettings();await page.evaluate(()=>window.s.settingsRef.open());await page.waitForTimeout(60);assert.equal(await content.evaluate(el=>el.scrollTop),0);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-appearance')
 })

 await test('pure modifiers and unmodified text cannot execute an unbound command',async()=>{
   await closeSettings();await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,'delete-line':'',bold:''});s.manager.activeEditorView.focus()});const before=await text();await page.keyboard.press('Control');await page.keyboard.press('Shift');await page.keyboard.press('Alt');assert.equal(await text(),before);assert.equal(await page.evaluate(()=>window.f.matchingCommand('',window.s.shortcuts,'text')||null),null)
 })
 await test('rebound search works inside source search field; embedded search stays shared with live document',async()=>{
   await page.evaluate(()=>{window.s.updateKeymap({preset:'markumo',bindings:window.f.getPresetBindings('markumo')});return window.doc('one one one')});await page.evaluate(()=>window.s.manager.activeEditorView.focus());await page.keyboard.press('Control+F');await page.locator('.cm-editor .fleet-search input[name=search]').fill('one');await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,'find-next':'Mod+Alt+F'})});await page.keyboard.press('Control+Alt+F');const position=await page.evaluate(()=>window.s.manager.activeEditorView.state.selection.main.from);await page.locator('.fleet-search input[name=search]').focus();await page.keyboard.press('F3');assert.equal(await page.evaluate(()=>window.s.manager.activeEditorView.state.selection.main.from),position)
   await page.evaluate(()=>window.doc('intro\n\n\x60\x60\x60js\none\ntwo\n\x60\x60\x60\n\nend','md','live'));await page.waitForSelector('.md-code-block .cm-content');await page.locator('.md-code-block .cm-content').click();await page.keyboard.press('Control+F');await page.locator('.md-live-search:not([hidden]) input[name=search]').fill('one');assert.equal(await page.locator('.md-code-block .cm-search').count(),0);await page.keyboard.press('Escape')
 })
 await test('Typora fence key executes in live and source modes; menus show canonical custom bindings',async()=>{
   await page.evaluate(()=>{window.s.updateKeymap({preset:'typora',bindings:window.f.getPresetBindings('typora')});return window.doc('example','md','live')});await page.waitForSelector('.md-prose');await page.locator('.md-prose').click();await page.keyboard.press('Control+Shift+K');await page.waitForSelector('.md-code-block .cm-content');assert.ok((await text()).includes('example'))
   await page.evaluate(()=>window.doc('source','md','source'));await page.waitForSelector('.cm-content');await page.evaluate(()=>window.s.manager.activeEditorView.focus());await page.keyboard.press('Control+Shift+K');assert.ok((await text()).includes('\x60\x60\x60'))
   const hints=await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,table:'Mod+Alt+T'});return [s.commandRegistry.get('format-table').shortcut,s.commandRegistry.get('table').shortcut,s.commandRegistry.get('close-pane').id]});assert.deepEqual(hints,['Mod+Alt+T','Mod+Alt+T','close-pane'])
 })
 await test('native redo alias follows default, conflicts when reassigned, and stops after clear',async()=>{
   await closeSettings();await page.evaluate(()=>{window.s.updateKeymap({preset:'markumo',bindings:window.f.getPresetBindings('markumo')});return window.doc('before')});await page.evaluate(()=>window.s.manager.activeEditorView.focus());await page.keyboard.press('End');await page.keyboard.type('!');await page.keyboard.press('Control+Z');assert.equal(await text(),'before');await page.keyboard.press('Control+Shift+Z');assert.equal(await text(),'before!');await page.keyboard.press('Control+Z');await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,redo:''})});await page.keyboard.press('Control+Shift+Z');assert.equal(await text(),'before')
   const result=await page.evaluate(()=>{const f=window.f,b=f.getPresetBindings('markumo');return [f.checkBindingConflict('table','Mod+Shift+Z',b)?.commandId,f.reassignBinding(b,'table','Mod+Shift+Z').redo,f.eventToKeybinding(new KeyboardEvent('keydown',{key:'¨',code:'KeyU',metaKey:true,altKey:true}),'MacIntel')]});assert.deepEqual(result,['redo','','Mod+Alt+U'])
 })
 await test('large documents repeat line actions without repeating pane creation; merge alias executes',async()=>{
   await page.evaluate(()=>{window.s.updateKeymap({preset:'markumo',bindings:window.f.getPresetBindings('markumo')});return window.doc(Array.from({length:5000},(_,index)=>'line '+index).join('\n'))});await page.evaluate(()=>{const s=window.s;s.updateShortcuts({...s.shortcuts,'copy-line-down':'Mod+Alt+D'});const view=s.manager.activeEditorView;view.focus();for(let index=0;index<10;index++)view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD',ctrlKey:true,altKey:true,repeat:true,bubbles:true,cancelable:true}));view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'\\',code:'Backslash',ctrlKey:true,repeat:true,bubbles:true,cancelable:true}))});assert.equal(await page.evaluate(()=>window.s.manager.getState(window.s.manager.activeId).doc.lines),5010);assert.equal(await page.evaluate(()=>window.s.manager.isSplit),false);await page.keyboard.press('Control+\\');assert.equal(await page.evaluate(()=>window.s.manager.isSplit),true);await page.keyboard.press('Control+Shift+M');assert.equal(await page.evaluate(()=>window.s.manager.isSplit),false)
 })
 await test('smooth container navigation, wheel interruption, dynamic Markdown height and last section',async()=>{
   await page.emulateMedia({reducedMotion:'no-preference'});await openSettings('appearance');await page.getByRole('button',{name:'导入与导出',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.settings-nav button[aria-current]')?.getAttribute('aria-controls')==='settings-conversion');assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-conversion')
   await content.hover();await page.mouse.wheel(0,-700);await page.waitForTimeout(200);const current=await content.evaluate(el=>el.scrollTop);await page.waitForTimeout(250);assert.equal(await content.evaluate(el=>el.scrollTop),current)
   await page.emulateMedia({reducedMotion:'reduce'});await openSettings('markdown');await page.locator('#image-location').selectOption('custom');await page.locator('#image-directory').waitFor();await page.waitForTimeout(60);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-markdown');await content.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(60);assert.equal(await page.locator('.settings-nav button[aria-current]').getAttribute('aria-controls'),'settings-shortcuts')
 })
 await test('restore entire active preset and changed/unbound filters reflect the committed config',async()=>{
   await page.getByRole('textbox',{name:'搜索快捷键',exact:true}).fill('');await page.getByRole('radiogroup',{name:'筛选快捷键'}).getByRole('radio',{name:'已修改',exact:true}).click();assert.ok(await page.locator('.shortcut-item-row').count()>0);await page.getByRole('button',{name:'恢复默认',exact:true}).first().click();await page.getByRole('button',{name:'确认应用',exact:true}).click();await page.waitForTimeout(60);assert.equal(await page.locator('.shortcut-item-row').count(),0);await page.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}');return Object.entries(window.s.shortcuts).every(([id,binding])=>saved.shortcuts?.[id]===binding)});await closeSettings();await page.reload();await page.waitForFunction(()=>window.s?.shortcuts?.table==='Mod+T');assert.deepEqual(await page.evaluate(()=>window.s.shortcuts),await page.evaluate(()=>window.f.getPresetBindings(window.s.keymapPreset)))
 })
 assert.deepEqual(errors,[]);console.log(`PASS ${results.length} settings/keybinding regressions`)
}finally{fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close();await server.close()}
