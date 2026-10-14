import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output='test-results/settings';await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:process.env.LIGHTEDIT_TEST_BROWSER || 'msedge'})
const page=await browser.newPage({viewport:{width:1200,height:780}}),errors=[],results=[]
page.on('pageerror',error=>errors.push(error.message))
try {
  await page.goto(process.env.LIGHTEDIT_TEST_URL || 'http://localhost:1422');await page.locator('.cm-content').waitFor()
  assert.equal(await page.locator('.kernel-notice,.sidefoot,.hero').count(),0)
  await page.getByTitle('设置',{exact:true}).click()
  assert.equal(await page.getByLabel('编辑器字号',{exact:true}).getAttribute('type'),'number')
  await page.getByLabel('编辑器字号',{exact:true}).fill('17');await page.getByLabel('编辑器字号',{exact:true}).blur()
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='17px')
  await page.getByLabel('编辑器字号',{exact:true}).fill('99');await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--editor-size')),'17px')
  await page.getByLabel('编辑器字号',{exact:true}).blur();assert.equal(await page.getByLabel('编辑器字号',{exact:true}).inputValue(),'17')
  await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'保存',exact:true}).click()
  assert.equal(await page.getByLabel('自动保存',{exact:true}).isChecked(),true)
  await page.screenshot({path:`${output}/auto-save-default.png`})
  await page.getByLabel('自动保存延迟',{exact:true}).selectOption('3000');await page.getByLabel('自动保存',{exact:true}).uncheck()
  assert.equal(await page.getByLabel('自动保存延迟',{exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'完成',exact:true}).click()
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lightedit.settings.v1')||'{}').autoSave===false)
  await page.reload();await page.locator('.cm-content').waitFor();await page.getByTitle('设置',{exact:true}).click()
  assert.equal(await page.getByLabel('自动保存',{exact:true}).isChecked(),false)
  assert.equal(await page.getByLabel('自动保存延迟',{exact:true}).inputValue(),'3000')
  assert.equal(await page.getByLabel('编辑器字号',{exact:true}).inputValue(),'17')
  results.push({name:'字号手动输入/范围校验、自动保存默认/关闭/延迟与重载持久化、编辑区无说明条',result:'PASS'})
  for(const theme of ['light','dark']) {
    await page.getByLabel('颜色主题',{exact:true}).selectOption(theme)
    for(const width of [1200,680,460]) {
      await page.setViewportSize({width,height:580})
      await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'外观',exact:true}).click()
      const rect=await page.getByRole('dialog',{name:'首选项设置'}).boundingBox()
      assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=580)
      assert.equal(await page.locator('.settings-content').evaluate(el=>el.scrollWidth>el.clientWidth),false)
      await page.screenshot({path:`${output}/${theme}-${width}.png`})
    }
  }
  await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'快捷键',exact:true}).click()
  await page.getByLabel('快捷键 保存文件',{exact:true}).fill('Mod+N');await page.getByRole('button',{name:'应用快捷键',exact:true}).click();await page.getByRole('alert').waitFor()
  await page.keyboard.press('Escape');await page.locator('.settingsoverlay').waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);results.push({name:'分类/明暗/窄窗布局、中文快捷键冲突、Esc关闭',result:'PASS'})
  console.log(`PASS ${results.length} settings UI groups; page errors: 0`)
} catch(error){results.push({result:'FAIL',error:String(error)});await page.screenshot({path:`${output}/failure.png`});throw error}
finally {await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
