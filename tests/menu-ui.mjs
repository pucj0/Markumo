import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = 'test-results/menu'; await mkdir(output,{recursive:true})
const browser = await chromium.launch({headless:true,channel:process.env.LIGHTEDIT_TEST_BROWSER || 'msedge'})
const page=await browser.newPage({viewport:{width:1200,height:780}}),errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
const editor=()=>page.locator('.main-pane .cm-content')
const raw=()=>page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.getText(m.activeId)})
async function menu(group) {await page.locator('[role=menubar]').getByRole('menuitem',{name:'文件',exact:true}).click();await page.locator('.menu-categories').getByRole('menuitem',{name:group,exact:true}).click()}
async function selectTheme(theme) {await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('颜色主题',{exact:true}).selectOption(theme);await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.settingsoverlay').waitFor({state:'hidden'})}
async function wheel(delta, ctrl = false) {
  const delivered = page.evaluate(() => new Promise(resolve => window.addEventListener('wheel', () => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))), { once: true })))
  if(ctrl) await page.keyboard.down('Control')
  await page.mouse.wheel(0,delta)
  if(ctrl) await page.keyboard.up('Control')
  await delivered
}
try {
  await page.goto(process.env.LIGHTEDIT_TEST_URL || 'http://localhost:1422');await editor().waitFor()
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='14px')
  assert.equal(await page.locator('.sidebar-wrapper').count(),0)
  assert.equal(await page.locator('.toolrow .crumb').count(),0)
  assert.equal(await page.locator('.status .file-path').innerText(),'Untitled-1.txt')
  const menubar=page.getByRole('menubar',{name:'应用菜单',exact:true})
  for(const name of ['文件','编辑','格式','视图','工作区','帮助']) assert.equal(await menubar.getByRole('menuitem',{name,exact:true}).isVisible(),true)
  assert.equal(await page.locator('.app-menu-popup').count(),0)
  await page.screenshot({path:`${output}/menubar.png`})
  const initialTabs=await page.getByRole('tab').count()
  await menubar.getByRole('menuitem',{name:'帮助',exact:true}).hover()
  await page.getByRole('menuitem',{name:'快捷键设置',exact:true}).waitFor()
  await page.keyboard.press('Control+n')
  assert.equal(await page.getByRole('tab').count(),initialTabs+1)
  assert.equal(await page.locator('.app-menu-popup').count(),0)
  await menu('文件');assert.equal(await page.getByRole('menuitem',{name:'打开文件',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('menuitem',{name:'已打开：Untitled-1.txt',exact:true}).count(),1)
  await page.locator('.menu-categories').getByRole('menuitem',{name:'格式',exact:true}).click()
  assert.equal(await page.getByRole('menuitem',{name:'加粗',exact:true}).isDisabled(),true)
  await page.keyboard.press('Escape');assert.equal(await page.locator('[role=menubar]').getByRole('menuitem',{name:'格式',exact:true}).evaluate(el=>el===document.activeElement),true)
  await menu('文件');await page.getByRole('menuitem',{name:'新建 Markdown 文档',exact:true}).click()
  await editor().focus();await page.keyboard.insertText('word word WORD\n中文菜单')
  await editor().press('Control+Home');for(let i=0;i<4;i++)await editor().press('Shift+ArrowRight')
  await menu('格式');await page.getByRole('menuitem',{name:'加粗',exact:true}).click()
  assert.equal(await raw(),'**word** word WORD\n中文菜单')
  await editor().press('Control+z');assert.equal(await raw(),'word word WORD\n中文菜单')
  await editor().press('Control+y');assert.equal(await raw(),'**word** word WORD\n中文菜单')
  await editor().press('Control+z')
  results.push({name:'圆角菜单、单文件无侧栏、文件列表转菜单、Markdown 格式事务/撤销',result:'PASS'})

  await page.getByRole('button',{name:'源码',exact:true}).click()
  const box=await editor().boundingBox();await page.mouse.move(box.x+70,box.y+30)
  const width=await page.evaluate(()=>innerWidth)
  await wheel(-120,true)
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='15px')
  assert.equal(await page.evaluate(()=>innerWidth),width)
  await wheel(120);assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--editor-size')),'15px')
  await page.bringToFront();await page.mouse.click(box.x+70,box.y+30);await editor().press('Control+0')
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='14px')
  results.push({name:'真实 Ctrl+滚轮缩放、普通滚轮不缩放、Ctrl+0 重置14px',result:'PASS'})

  await editor().press('Control+h');const panel=page.locator('.fleet-search');await panel.waitFor()
  await panel.locator('input[name=search]').fill('(w)(ord)');await panel.locator('input[name=replace]').fill('$2$1');await panel.locator('input[name=re]').check()
  await page.waitForFunction(()=>document.querySelector('.search-count').textContent.includes('3'))
  await panel.locator('button[name=replaceAll]').click();assert.equal(await raw(),'ordw ordw ORDW\n中文菜单')
  await panel.locator('button[name=toggleReplace]').click();assert.equal(await panel.locator('input[name=replace]').isVisible(),false)
  await editor().focus();await editor().press('Control+h');assert.equal(await panel.locator('input[name=replace]').isVisible(),true)
  await panel.locator('input[name=search]').fill('[')
  await page.waitForFunction(()=>document.querySelector('.search-count').textContent==='无效正则')
  await panel.locator('input[name=search]').press('Escape');await panel.waitFor({state:'hidden'})
  await editor().focus();await editor().press('Control+z');assert.equal(await raw(),'word word WORD\n中文菜单')
  results.push({name:'Fleet 查找替换、真实正则/分组替换、计数、无效正则、收起重开、Esc与撤销',result:'PASS'})

  await page.getByTitle('设置',{exact:true}).click();await page.getByText('快捷键配置',{exact:true}).click()
  assert.equal(await page.getByLabel('快捷键 转到行',{exact:true}).count(),1)
  assert.equal(await page.locator('.shortcut-row label').filter({hasText:/^(goto-line|find|save|new)$/}).count(),0)
  await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.settingsoverlay').waitFor({state:'hidden'})
  for(const theme of ['light','dark']) {
    await selectTheme(theme);await editor().focus();await editor().press('Control+h')
    for(const width of [1200,680]) {
      await page.setViewportSize({width,height:780})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('.topbar').scrollWidth>document.querySelector('.topbar').clientWidth),false)
      const p=await panel.boundingBox();assert.ok(p.x>=0&&p.x+p.width<=width)
      await page.screenshot({path:`${output}/${theme}-${width}-search.png`})
    }
    await panel.locator('button[name=close]').click();await menu('文件');await page.screenshot({path:`${output}/${theme}-menu.png`});await page.keyboard.press('Escape')
  }
  await menu('文件');await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('menuitem',{name:'撤销',exact:true}).count(),1)
  const tabs=await page.getByRole('tab').count();await page.keyboard.press('Control+n')
  assert.equal(await page.locator('.app-menu-popup').count(),0);assert.equal(await page.getByRole('tab').count(),tabs+1)
  await menu('帮助');await page.getByRole('menuitem',{name:'快捷键设置',exact:true}).click()
  await page.getByLabel('快捷键 转到行',{exact:true}).waitFor();assert.equal(await page.locator('#settings-shortcuts details').evaluate(el=>el.open),true)
  await page.keyboard.press('Escape');await page.locator('.settingsoverlay').waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);results.push({name:'中文快捷键、明暗/680px 布局、菜单键盘切换与快捷键',result:'PASS'})
  console.log(`PASS ${results.length} menu/editor UX groups; console/page errors: 0`)
} catch(error) {await page.screenshot({path:`${output}/failure.png`});results.push({result:'FAIL',error:String(error)});throw error}
finally {await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
