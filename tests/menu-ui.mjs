import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const output='test-results/main-menu';await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:process.env.LIGHTEDIT_TEST_BROWSER||'msedge'})
const page=await browser.newPage({viewport:{width:1200,height:780}}),errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
const editor=()=>page.locator('.main-pane .cm-content').first()
const item=(name,role='menuitem')=>page.locator('[data-menu-popup]').getByRole(role,{name,exact:true})
const category=name=>page.getByRole('menubar').getByRole('menuitem',{name,exact:true})
const raw=()=>page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.getText(m.activeId)})
async function menu(name){await category(name).click();await page.locator('[data-menu-popup]').first().waitFor()}
async function command(group,name,role='menuitem'){await menu(group);await item(name,role).click();await page.locator('[data-menu-popup]').waitFor({state:'hidden'})}
async function mode(name){await menu('视图');await item('Markdown 编辑模式').click();await item(name,'menuitemradio').click()}
async function theme(name){await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('颜色主题',{exact:true}).selectOption(name);await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.settingsoverlay').waitFor({state:'hidden'})}
async function contextTab(name,action){await page.getByRole('tab',{name,exact:true}).click({button:'right'});if(['向右拆分','向下拆分','向左拆分','向上拆分'].includes(action))await item('拆分分栏').click();await item(action).click()}
async function source(text){await page.evaluate(text=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.dispatch(m.activeId,{changes:{from:0,to:m.getState(m.activeId).doc.length,insert:text},selection:{anchor:0,head:Math.min(4,text.length)}})},text)}
const activeName=()=>page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.name)
const pass=name=>results.push({name,result:'PASS'})
try{
 await page.goto(process.env.LIGHTEDIT_TEST_URL||'http://localhost:1422');await category('文件').waitFor()
 if(!await editor().count())await command('文件','新建文件')
 await editor().waitFor()
 assert.deepEqual(await page.getByRole('menubar').getByRole('menuitem').allTextContents(),['文件','编辑','格式','视图'])
 assert.equal(await page.locator('.sidebar-wrapper').count(),0);assert.equal(await page.locator('.toolrow').count(),0)
 await editor().focus();await page.keyboard.insertText('plain');const focus=await page.evaluate(()=>document.activeElement?.className)
 for(const name of ['文件','编辑','格式','视图']){await category(name).hover();assert.equal(await page.locator('[data-menu-popup]').count(),0);assert.equal(await category(name).getAttribute('aria-expanded'),'false')}
 assert.equal(await page.evaluate(()=>document.activeElement?.className),focus)
 await menu('文件');await category('编辑').hover();await item('撤销').waitFor();assert.equal(await category('文件').getAttribute('aria-expanded'),'false');assert.equal(await category('编辑').getAttribute('aria-expanded'),'true')
 await category('视图').hover();await item('自动换行','menuitemcheckbox').waitFor();await category('格式').hover();await item('加粗').waitFor()
 assert.equal(await item('加粗').isDisabled(),true);assert.equal(await item('标题').isDisabled(),true)
 await page.keyboard.press('Escape');await category('编辑').hover();assert.equal(await page.locator('[data-menu-popup]').count(),0)
 await editor().focus();await page.keyboard.press('Space');await page.keyboard.insertText('text');assert.equal(await raw(),'plain text')
 await menu('文件');await editor().click();assert.equal(await page.locator('[data-menu-popup]').count(),0);await category('格式').hover();assert.equal(await page.locator('[data-menu-popup]').count(),0)
 await menu('文件');assert.equal(await item('打开文件…').isDisabled(),true);assert.equal(await item('最近打开').isDisabled(),true)
 assert.equal(await page.locator('[data-menu-popup]').getByRole('menuitem',{name:/已打开：|UTF-16|转为大写/}).count(),0);await page.keyboard.press('Escape')
 pass('关闭时悬停不展开、点击后跨菜单悬停切换、Esc/外部点击关闭后恢复、非MD禁用与历史折叠')
 await page.evaluate(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;s.recentFiles.push({path:'C:/甲/同名.md',name:'同名.md'},{path:'C:/乙/同名.md',name:'同名.md'});s.workspace.recentWorkspaces=['C:/中文项目 A','C:/项目 B']})
 await menu('文件');assert.equal(await item('同名.md — 甲').count(),0);await item('最近打开').hover();await item('同名.md — 甲').waitFor();assert.equal(await item('同名.md — 甲').getAttribute('title'),'C:/甲/同名.md')
 const child=await item('同名.md — 甲').boundingBox(),parent=await item('最近打开').boundingBox()
 await page.mouse.move(parent.x+parent.width-4,parent.y+parent.height/2);await page.mouse.move(child.x+child.width/2,child.y+child.height/2,{steps:12});assert.equal(await page.locator('[data-menu-popup]').count(),2)
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-menu-popup]').count(),1)
 await item('工作区').click();await item('最近工作区').click();assert.equal(await page.locator('[data-menu-popup]').count(),3)
 for(const count of [2,1,0]){await page.keyboard.press('Escape');assert.equal(await page.locator('[data-menu-popup]').count(),count)}
 pass('三级工作区/最近文件、完整路径、鼠标父子通道、Escape逐级关闭')
 await command('文件','新建 Markdown');await source('word word WORD\n中文菜单');await editor().focus();await page.keyboard.press('Control+b');assert.equal(await raw(),'**word** word WORD\n中文菜单')
 await editor().press('Control+z');await command('格式','斜体');assert.equal(await raw(),'*word* word WORD\n中文菜单');await editor().press('Control+z')
 await menu('格式');await item('标题').click();await item('H6 · 六级标题').click();assert.equal(await raw(),'###### word word WORD\n中文菜单');await editor().press('Control+z')
 await command('格式','插入表格');assert.match(await raw(),/\| 列 1 \| 列 2 \|/);await editor().press('Control+z');assert.equal(await raw(),'word word WORD\n中文菜单')
 for(const name of ['源码编辑','双栏预览','实时排版']){const text=await raw();await mode(name);assert.equal(await raw(),text);await menu('视图');await item('Markdown 编辑模式').click();assert.equal(await item(name,'menuitemradio').getAttribute('aria-checked'),'true');assert.equal(await page.locator('[role=menuitemradio][aria-checked=true]').count(),1);await page.keyboard.press('Escape');await page.keyboard.press('Escape')}
 pass('Markdown格式、快捷键、H6/表格插入与撤销、三模式单选/源文不变')
 // Controlled clipboard provider: these browser checks never alter the system clipboard.
 await page.evaluate(()=>{globalThis.__testClipboard={text:'',reject:false};Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(__testClipboard.reject)throw Error('clipboard permission denied');__testClipboard.text=text},readText:async()=>{if(__testClipboard.reject)throw Error('clipboard permission denied');return __testClipboard.text}},configurable:true})})
 await source('word word WORD\n中文菜单');await editor().focus();await command('编辑','复制');assert.equal(await page.evaluate(()=>__testClipboard.text),'word')
 await command('编辑','剪切');assert.equal(await raw(),' word WORD\n中文菜单');await editor().press('Control+z')
 await page.evaluate(()=>{__testClipboard.text='粘贴'});await command('编辑','粘贴');assert.equal(await raw(),'粘贴 word WORD\n中文菜单');await editor().press('Control+z')
 await page.evaluate(()=>{__testClipboard.reject=true});const before=await raw();await command('编辑','剪切');assert.equal(await raw(),before);await page.getByText(/clipboard permission denied/).waitFor();await page.evaluate(()=>{__testClipboard.reject=false})
 await command('编辑','全选');assert.equal(await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.activeEditorView.state.selection.main.to-m.activeEditorView.state.selection.main.from}),(await raw()).length)
 pass('菜单剪贴板实际CM事务/撤销、全选和权限失败保留源文（控制提供者）')
 await mode('源码编辑');await editor().focus();await page.keyboard.press('Control+f');assert.equal(await page.locator('.fleet-search input[name=replace]').isVisible(),false)
 await page.locator('.fleet-search input[name=search]').press('Escape');await editor().focus();await page.keyboard.press('Control+r');await page.locator('.fleet-search input[name=replace]').waitFor()
 await page.locator('.fleet-search input[name=search]').fill('(w)(ord)');await page.locator('.fleet-search input[name=replace]').fill('$2$1');await page.locator('.fleet-search input[name=re]').check()
 await page.waitForFunction(()=>document.querySelector('.search-count').textContent.includes('3'));await page.locator('.fleet-search button[name=replaceAll]').click();assert.equal(await raw(),'ordw ordw ORDW\n中文菜单')
 await page.locator('.fleet-search input[name=search]').press('Escape');await editor().press('Control+z');assert.equal(await raw(),'word word WORD\n中文菜单')
 await command('视图','自动换行','menuitemcheckbox');await menu('视图');assert.equal(await item('自动换行','menuitemcheckbox').getAttribute('aria-checked'),'true');await page.keyboard.press('Escape')
 await command('视图','显示侧边栏','menuitemcheckbox');await page.locator('.sidebar-wrapper').waitFor();await command('视图','显示侧边栏','menuitemcheckbox');await page.locator('.sidebar-wrapper').waitFor({state:'hidden'})
 pass('Ctrl+F/Ctrl+R不刷新、分组替换与撤销、复选状态和单文件侧边栏')
  await contextTab(await activeName(),'向右拆分');assert.equal(await page.locator('.secondary-pane').count(),1)
  await page.locator('.secondary-pane [role=tab]').first().click({button:'right'});await item('移动到另一分栏').click();assert.equal(await page.locator('.secondary-pane [role=tab]').count(),0)
  // The emptied pane is reclaimed automatically; the document must stay in the main pane.
  assert.equal(await page.locator('.secondary-pane').count(),0);assert.equal(await page.locator('.main-pane [role=tab]').count()>=1,true)
 const keep=await activeName(),keptText=await raw(),count=await page.getByRole('tab').count();await contextTab(keep,'关闭其他标签');await page.getByRole('dialog',{name:'未保存修改确认'}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await page.getByRole('tab').count(),count)
 await contextTab(keep,'关闭其他标签');for(let i=0;i<count-1;i++){await page.getByRole('button',{name:'放弃修改并关闭',exact:true}).click();if(i<count-2)await page.getByRole('dialog',{name:'未保存修改确认'}).waitFor()}
 assert.equal(await page.getByRole('tab').count(),1);assert.equal(await raw(),keptText);await editor().press('Control+w');await page.getByRole('dialog',{name:'未保存修改确认'}).waitFor();await page.keyboard.press('Escape');assert.equal(await raw(),keptText)
 pass('标签右键打开/移动/关闭分栏、关闭其他逐个脏确认/取消和Ctrl+W保护')
 await page.evaluate(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;s.appMode='workspace';s.sidebarVisible=true;s.sidebarPanel='files';const node={id:'a',name:'长中文 folder 文件.md',path:'C:/fixture/长中文 folder 文件.md',relativePath:'长中文 folder 文件.md',isDirectory:false,isSymlink:false,isReadOnly:false,size:0,mtime:null,hasChildren:false};s.workspace.rootPath='C:/fixture';s.workspace.rootName='Fixture';s.workspace.roots=[{rootPath:'C:/fixture',name:'Fixture',entries:[node]}];s.workspace.entries=[node]})
 await page.locator('.tree-node-wrapper .treenode').first().click({button:'right'});await item('重命名…').waitFor();assert.equal(await page.locator('.workspace-operation-dialog').count(),0);assert.equal(await item('在文件管理器中显示').isDisabled(),true)
 await item('复制文件路径').click();assert.equal(await page.evaluate(()=>__testClipboard.text),'C:/fixture/长中文 folder 文件.md')
 await page.locator('.tree-node-wrapper .treenode').first().click({button:'right'});await item('重命名…').click();await page.locator('.workspace-operation-dialog').waitFor();await page.getByRole('button',{name:'取消',exact:true}).click()
 await page.locator('.root-toggle').click({button:'right'});await item('移除工作区根目录').waitFor();await page.keyboard.press('Escape');pass('树右键不直接重命名、复制/重命名入口、工作区根菜单（内存树fixture）')
 await editor().focus();await category('文件').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'关闭文件')
 await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'新建文件');const tabs=await page.getByRole('tab').count();await page.keyboard.press('Enter');assert.equal(await page.getByRole('tab').count(),tabs+1)
 await category('视图').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');assert.equal(await item('新建文件').count(),1);await page.keyboard.press('Escape')
 for(const color of ['light','dark']){await theme(color);for(const size of [{width:1200,height:780},{width:680,height:300},{width:460,height:420}]){await page.setViewportSize(size);await menu('文件');await item('工作区').click();await item('最近工作区').click();for(const rect of await page.locator('[data-menu-popup]').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:el.scrollWidth,client:el.clientWidth}}))){assert.ok(rect.left>=0&&rect.right<=size.width+1&&rect.top>=0&&rect.bottom<=size.height+1);assert.ok(rect.scroll<=rect.client)}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('.topbar').scrollWidth>document.querySelector('.topbar').clientWidth),false);await page.screenshot({path:`${output}/${color}-${size.width}x${size.height}.png`});for(let i=0;i<3;i++)await page.keyboard.press('Escape')}}
 await page.setViewportSize({width:1200,height:780});await page.getByTitle('设置',{exact:true}).click();await page.getByRole('button',{name:'快捷键',exact:true}).click();await page.getByLabel('快捷键 Markdown 加粗').fill('Mod+Alt+B');await page.getByRole('button',{name:'应用快捷键',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/重复/);await page.keyboard.press('Escape')
 assert.deepEqual(errors,[]);pass('方向/Home/End/Enter导航、明暗/窄窗/三级边界展开、快捷键冲突提示')
 console.log(`PASS ${results.length} main-menu UI groups; console/page errors: 0`)
}catch(error){await page.screenshot({path:`${output}/failure.png`});results.push({result:'FAIL',error:String(error)});throw error}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
