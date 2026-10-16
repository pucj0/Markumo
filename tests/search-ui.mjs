import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, browserOptions } from './helpers/markdown-browser.mjs'
import { searchFiles, searchSample, runSearchChecks, openSearchFile, assertSearchGeometry, activeText } from './helpers/search-checks.mjs'

const output='test-results/search-ui';await mkdir(output,{recursive:true})
const browser=await chromium.launch(browserOptions),page=await browser.newPage({viewport:{width:1360,height:900}})
const results=[],errors=[],evidence={};let failure
page.on('pageerror',error=>errors.push(error.message))
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function installDocuments(target=page){
  await target.evaluate(({names,text})=>{
    const a=document.querySelector('#app').__vue_app__._instance.setupState
    for(const name of names)a.manager.openFile({token:`fixture-${name}`,path:`C:/search-fixture/${name}`,name,text,encoding:'UTF-8',eol:'LF',bom:false,readOnly:false,version:'fixture'})
  },{names:searchFiles,text:searchSample})
}
const app=()=>page.evaluate(()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;return {ui:a.uiFontSize,editor:a.fontSize,markdown:a.markdownTypography.fontSize}})
try {
  await page.goto(process.env.LIGHTEDIT_TEST_URL)
  await page.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?._instance.setupState.startupLoading===false)
  await test('new user UI defaults to 14; v4 migration preserves editor/Markdown/auto-save',async()=>{
    assert.deepEqual(await app(),{ui:14,editor:14,markdown:16})
    await page.evaluate(()=>localStorage.setItem('lightedit.settings.v1',JSON.stringify({settingsVersion:4,theme:'dark',fontSize:17,autoSave:false,markdownTypography:{fontSize:19}})))
    await page.reload();await page.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?._instance.setupState.fontSize===17)
    assert.deepEqual(await app(),{ui:14,editor:17,markdown:19})
  })
  await installDocuments()
  await runSearchChecks(page,{test,output})
  await test('both adapters share SVG/Grid geometry, visible regex state, composition-safe inputs and both themes',async()=>{
    for(const [name,mode] of [['search.txt'],['live.md','live']]) {
      await openSearchFile(page,name,mode)
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('replace'))
      const bar=page.locator('.fleet-search:visible').first()
      await bar.locator('input[name=search]').fill('(import)(\\d+)');await bar.locator('input[name=re]').check()
      await bar.locator('input[name=replace]').fill('$1-$2')
      await page.waitForTimeout(120)
      for(const theme of ['dark','light']) {
        await page.evaluate(theme=>document.querySelector('#app').__vue_app__._instance.setupState.theme=theme,theme)
        evidence[`${name}-${theme}`]=await assertSearchGeometry(bar)
        const selected=await bar.locator('input[name=re] + span').evaluate(el=>getComputedStyle(el).backgroundColor)
        assert.notEqual(selected,'rgba(0, 0, 0, 0)')
        await page.screenshot({path:`${output}/${name}-${theme}-search.png`})
        await bar.screenshot({path:`${output}/${name}-${theme}-searchbar.png`})
      }
      const input=bar.locator('input[name=search]')
      await input.dispatchEvent('compositionstart');await input.fill('中文');await input.press('Enter')
      assert.equal(await bar.isVisible(),true)
      await input.dispatchEvent('compositionend');await page.waitForTimeout(120)
      assert.match(await bar.locator('.search-count').textContent(),/2/)
      assert.equal(await activeText(page),searchSample)
      await input.press('Escape')
    }
  })
  await test('14/16/20 px UI updates real menus/tree/tabs/search/dialogs; document fonts remain independent',async()=>{
    // Explicit browser layout data. The native driver below reads a real workspace.
    await page.evaluate(()=>{
      const a=document.querySelector('#app').__vue_app__._instance.setupState,w=a.workspace
      const entries=Array.from({length:1000},(_,i)=>({id:`f${i}`,name:`中文很长的文件名-${i}.txt`,path:`C:/search-fixture/f${i}.txt`,relativePath:`f${i}.txt`,isDirectory:false,isSymlink:false,isReadOnly:false,size:0,mtime:null,hasChildren:false}))
      w.roots=[{rootPath:'C:/search-fixture',name:'中文工作区',entries}];w.rootPath='C:/search-fixture';w.entries=entries;a.sidebarVisible=true
    })
    for(const size of [14,16,20]) {
      await page.getByTitle('设置',{exact:true}).click()
      await page.getByLabel('界面字号',{exact:true}).fill(String(size));await page.getByLabel('界面字号',{exact:true}).blur()
      assert.deepEqual(await app(),{ui:size,editor:17,markdown:19})
      await page.getByLabel('界面字号',{exact:true}).fill('99');await page.getByRole('alert').waitFor()
      assert.equal((await app()).ui,size);await page.getByLabel('界面字号',{exact:true}).blur()
      const settings=await page.locator('.settingrow').first().evaluate(el=>({font:getComputedStyle(el).fontSize,height:el.getBoundingClientRect().height}))
      assert.equal(settings.font,`${size}px`);assert.ok(settings.height>=size+18)
      await page.screenshot({path:`${output}/settings-${size}.png`})
      await page.locator('.settings').screenshot({path:`${output}/settings-dialog-${size}.png`})
      await page.getByRole('button',{name:'完成',exact:true}).click()
      await openSearchFile(page,'search.txt')
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('replace'))
      const bar=page.locator('.fleet-search:visible').first()
      const geometry=await assertSearchGeometry(bar);assert.equal(geometry.find.font,`${size}px`)
      const fonts=await page.evaluate(()=>Object.fromEntries(['.menu-categories button','.treenode','.tab','.status','.editor-host > .cm-editor .cm-content'].map(selector=>[selector,getComputedStyle(document.querySelector(selector)).fontSize])))
      for(const key of ['.menu-categories button','.treenode','.tab','.status'])assert.equal(fonts[key],`${size}px`,key)
      assert.equal(fonts['.editor-host > .cm-editor .cm-content'],'17px')
      const tree=await page.locator('.workspace-tree-container').evaluate(el=>{el.scrollTop=15000;return true});assert.ok(tree)
      await page.waitForTimeout(50)
      const treeRows=await page.locator('.workspace-tree-container .treenode').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {y:b.y,height:b.height}}))
      for(let i=1;i<treeRows.length;i++){assert.equal(treeRows[i].height,size+14);assert.ok(Math.abs(treeRows[i].y-treeRows[i-1].y-treeRows[i].height)<1)}
      evidence[`font-${size}`]={settings,geometry,fonts,treeRows:treeRows.length}
      await page.screenshot({path:`${output}/ui-${size}.png`})
      await bar.locator('input[name=search]').press('Escape')
      await page.locator('.menu-categories button').first().click()
      assert.equal(await page.locator('.app-menu-popup').first().evaluate(el=>getComputedStyle(el).fontSize),`${size}px`)
      await page.screenshot({path:`${output}/menu-${size}.png`});await page.keyboard.press('Escape')
      await openSearchFile(page,'live.md','live')
      assert.equal(await page.locator('.md-document').evaluate(el=>getComputedStyle(el).fontSize),'19px')
    }
    await page.getByTitle('设置',{exact:true}).click();await page.getByRole('button',{name:'恢复默认界面字号'}).click()
    assert.equal((await app()).ui,14);await page.getByLabel('界面字号',{exact:true}).fill('16');await page.getByLabel('界面字号',{exact:true}).blur()
    await page.getByRole('button',{name:'完成',exact:true}).click()
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lightedit.settings.v1')||'{}').uiFontSize===16)
    await page.reload();await page.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?._instance.setupState.uiFontSize===16)
    assert.deepEqual(await app(),{ui:16,editor:17,markdown:19})
    await installDocuments()
  })
  await test('narrow/multiple panes retain equal input columns without overflow; keyboard controls work',async()=>{
    await openSearchFile(page,'search.txt')
    await page.evaluate(()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;a.sidebarVisible=false;const m=a.manager;m.splitPane('right','main');m.splitPane('right','main')})
    await page.waitForFunction(()=>document.querySelectorAll('.pane').length===3)
    for(const width of [1360,900,680]) {
      await page.setViewportSize({width,height:820})
      await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;for(const id of m.layout.getAllLeafIds()){m.focusPane(id);m.command('replace')}})
      await page.waitForTimeout(80)
      const bars=page.locator('.fleet-search:visible');assert.equal(await bars.count(),3)
      for(let i=0;i<3;i++)await assertSearchGeometry(bars.nth(i))
      await page.screenshot({path:`${output}/three-panes-${width}.png`})
    }
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.mergeAllPanes())
    await page.setViewportSize({width:1360,height:900})
  })
  await test('browser DPR 1 / 1.25 / 1.5 and narrow settings use computed geometry and screenshots',async()=>{
    for(const scale of [1,1.25,1.5]) {
      const context=await browser.newContext({deviceScaleFactor:scale,viewport:{width:Math.floor(1200/scale),height:Math.floor(900/scale)}})
      const target=await context.newPage()
      await target.goto(process.env.LIGHTEDIT_TEST_URL)
      await target.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?._instance.setupState.startupLoading===false)
      await installDocuments(target);await openSearchFile(target,'live.md','live')
      await target.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('replace'))
      await assertSearchGeometry(target.locator('.fleet-search:visible'))
      await target.screenshot({path:`${output}/browser-dpr-${scale}.png`})
      await target.getByTitle('设置',{exact:true}).click();await target.getByLabel('界面字号',{exact:true}).fill('20');await target.getByLabel('界面字号',{exact:true}).blur()
      const fits=await target.locator('.settings-content').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight}))
      assert.ok(fits.scroll<=fits.width);assert.ok(fits.scrollHeight>fits.height)
      await target.screenshot({path:`${output}/browser-dpr-${scale}-settings.png`})
      evidence[`browser-dpr-${scale}`]={dpr:await target.evaluate(()=>devicePixelRatio),fits}
      await context.close()
    }
  })
  assert.deepEqual(errors,[])
}catch(error){failure=String(error);console.error(error);await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});process.exitCode=1}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors,evidence,failure},null,2));await browser.close()}
