import assert from 'node:assert/strict'

export const importSample = "import123\nimport2Something\nimport 123\nimport Vue from 'vue'\nimport Foo from './foo'\n中文123 汉字456"
export const searchSample = `${importSample}\n\n\`\`\`javascript\n${importSample}\n\`\`\`\n`
export const searchFiles = ['search.txt','search.js','Search.java','source.md','live.md','split.md']
export async function openSearchFile(page, name, mode) {
  await page.evaluate(({name,mode}) => {
    const m=document.querySelector('#app').__vue_app__._instance.setupState.manager
    const doc=m.openedDocuments.find(d=>d.name===name)
    if(!doc)throw Error(`Missing test document ${name}`)
    m.open(doc.id,false)
    if(mode)m.setMarkdownMode(doc.id,mode)
  },{name,mode})
  await page.locator(mode==='live'?'.md-prose':'.editor-host > .cm-editor .cm-content').first().waitFor()
}
export async function activeText(page) {
  return page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.saveSnapshot(m.activeId)?.text})
}
export async function assertSearchGeometry(panel) {
  const geometry=await panel.evaluate(el=>{
    const r=n=>{const e=el.querySelector(n),b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height,font:getComputedStyle(e).fontSize}}
    const boxes=[...el.querySelectorAll('.search-input,button,.search-option,.search-count')].filter(e=>e.offsetParent).map(e=>({name:e.getAttribute('name')||e.className,box:e.getBoundingClientRect()}))
    const overlaps=[]
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i].box,b=boxes[j].box;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([boxes[i].name,boxes[j].name])}
    return {find:r('input[name=search]'),replace:r('input[name=replace]'),width:el.clientWidth,scroll:el.scrollWidth,overlaps,icons:[...el.querySelectorAll('svg')].map(s=>s.getBoundingClientRect().width),buttons:[...el.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height}})}
  })
  assert.ok(Math.abs(geometry.find.x-geometry.replace.x)<1,JSON.stringify(geometry))
  assert.ok(Math.abs(geometry.find.right-geometry.replace.right)<1,JSON.stringify(geometry))
  assert.equal(geometry.find.height,geometry.replace.height)
  assert.ok(geometry.find.height>=30)
  assert.ok(geometry.find.width>=40)
  assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry))
  assert.deepEqual(geometry.overlaps,[],`search controls must not overlap: ${JSON.stringify(geometry)}`)
  assert.ok(geometry.icons.every(size=>size>=16&&size<=18))
  assert.ok(geometry.buttons.every(b=>b.width>=30&&b.height>=30))
  return geometry
}
export async function runSearchChecks(page,{test,output}) {
  for(const [name,mode] of [['search.txt'],['search.js'],['Search.java'],['source.md','source'],['live.md','live'],['split.md','split']]) {
    await test(`${name}: literal/regex/options/errors/captures/Undo/Redo/keyboard`,async()=>{
      await openSearchFile(page,name,mode)
      const before=await activeText(page)
      const editor=page.locator(mode==='live'?'.md-prose':'.editor-host > .cm-editor .cm-content').first()
      await editor.focus();await page.keyboard.press('Control+f')
      const bar=page.locator('.fleet-search:visible').first(),input=bar.locator('input[name=search]'),re=bar.locator('input[name=re]')
      await input.fill('(import)(\\d+)');await re.setChecked(false)
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.includes('/ 0')))
      assert.equal(await input.getAttribute('aria-invalid'),'false')
      await re.check()
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.endsWith('/ 4')))
      await input.press('Enter');await page.waitForTimeout(90);const current=await bar.locator('.search-count').textContent()
      await input.press('F3');await page.waitForTimeout(90);assert.notEqual(await bar.locator('.search-count').textContent(),current)
      await input.press('Shift+F3');await page.waitForTimeout(90);assert.equal(await bar.locator('.search-count').textContent(),current)
      await input.fill('import\\s+(\\w+)')
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.endsWith('/ 6')))
      await input.fill('[');await bar.locator('.search-error').waitFor()
      assert.equal(await input.getAttribute('aria-invalid'),'true')
      assert.match(await bar.locator('.search-error').textContent(),/正则表达式无效.+/)
      assert.equal(await bar.locator('button[name=next]').isDisabled(),true)
      await re.uncheck();assert.equal(await input.getAttribute('aria-invalid'),'false')
      await input.fill('IMPORT');await bar.locator('input[name=case]').check()
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.endsWith('/ 0')))
      await bar.locator('input[name=case]').uncheck();await input.fill('import');await bar.locator('input[name=word]').check()
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.endsWith('/ 6')))
      await bar.locator('input[name=word]').uncheck();await input.fill('\\p{L}+\\d+');await re.check()
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.endsWith('/ 8')))
      await input.fill('(import)(\\d+)')
      await input.press('Control+r');await bar.locator('input[name=replace]').waitFor()
      assert.equal(await input.inputValue(),'(import)(\\d+)')
      await bar.locator('input[name=replace]').fill('$1-$2/$&/$$')
      await page.waitForTimeout(100)
      await assertSearchGeometry(bar)
      if(mode==='live') {
        assert.equal(await page.locator('.md-code-block .cm-searchMatch').count(),2)
        assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.mode),'live')
      }
      await bar.locator('button[name=replaceAll]').click()
      assert.equal(await activeText(page),before.replace(/(import)(\d+)/gu,'$1-$2/$&/$$'))
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
      assert.equal(await activeText(page),before)
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('redo'))
      assert.equal(await activeText(page),before.replace(/(import)(\d+)/gu,'$1-$2/$&/$$'))
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
      assert.equal(await activeText(page),before)
      await input.focus();await input.press('Escape');assert.equal(await bar.count(),0)
      if(mode==='live') {
        await page.locator('.md-code-block .cm-content').first().focus();await page.keyboard.press('Control+f')
        await page.locator('.md-live-search').waitFor();await page.keyboard.press('F3');await page.keyboard.press('Shift+F3');await page.keyboard.press('Escape')
      }
      await editor.focus();await page.keyboard.press('Control+r');await input.fill('(import)(\\d+)');await re.check()
      await bar.locator('input[name=replace]').fill('$1-$2')
      await input.press('Enter');await page.waitForTimeout(100)
      const beforeOne=await activeText(page)
      await bar.locator('button[name=replace]').click()
      assert.equal((await activeText(page)).length,beforeOne.length+1)
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
      assert.equal(await activeText(page),before)
      await input.fill('(?=import)');await re.check();await bar.locator('input[name=replace]').fill('X')
      await page.waitForFunction(()=>[...document.querySelectorAll('.fleet-search')].some(el=>el.offsetParent&&el.querySelector('.search-count').textContent.endsWith('/ 10')))
      if(mode==='live')assert.equal(await page.locator('.md-code-block .md-search-zero').count(),5)
      await bar.locator('button[name=replaceAll]').click()
      assert.equal(await activeText(page),before.replace(/(?=import)/gu,'X'))
      await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
      assert.equal(await activeText(page),before)
      await input.focus();await input.press('Escape')
      await page.screenshot({path:`${output}/${name}-complete.png`})
    })
  }
}
