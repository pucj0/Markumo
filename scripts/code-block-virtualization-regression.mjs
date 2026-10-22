import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/code-block-virtualization'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><div id="app" style="display:flex;height:720px"></div><script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>')
const server = await createServer({ server: { host: '127.0.0.1', port: 1497, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:1497/${output}/index.html`)
  await page.waitForFunction(() => window.f)
  await page.evaluate(async () => {
    const { CodeBlockView } = await import('/src/editor/markdown/wysiwyg/CodeBlockView.ts')
    const ensure = CodeBlockView.prototype.ensureEditor
    window.allocations = { total: 0, live: 0, peak: 0 }
    CodeBlockView.prototype.ensureEditor = function() {
      const existed = this.existingEditor
      const editor = ensure.call(this)
      if (!existed) {
        const stats = window.allocations
        stats.total++; stats.live++; stats.peak = Math.max(stats.peak, stats.live)
        const destroy = editor.destroy.bind(editor)
        editor.destroy = () => { stats.live--; destroy() }
      }
      return editor
    }
  })
  const source = 'Ordinary paragraph.\n\n' + Array.from({ length: 200 }, (_, i) => `\`\`\`js\nconst value${i} = ${i};\nsecond line\n\`\`\`\n\n`).join('')
  await page.evaluate(source => window.f.reset(source, true), source)
  await page.waitForFunction(() => window.f.ready())
  await page.waitForTimeout(500)
  const initial = await page.evaluate(() => ({ ...window.allocations, roots: [...window.f.live().codeViews].every(code => code.observer.root === window.f.live().dom) }))
  assert.ok(initial.total < 20, `Initial allocations must be viewport bounded: ${JSON.stringify(initial)}`)
  assert.ok(initial.peak < 20)
  assert.equal(initial.roots, true, 'Each observer must use its Live Pane scroller')
  assert.equal(await page.evaluate(()=>[...window.f.live().codeViews].filter(code=>!code.existingEditor).every(code=>code.placeholder.querySelectorAll('*').length===1)),true,'Cold non-wrapping placeholders keep one code element; no eager token/line-number DOM')
  const result = await page.evaluate(async () => {
    const f = window.f, live = f.live(), codes = [...live.codeViews]
    let created = 0
    for (const code of codes) {
      const ensure = code.ensureEditor.bind(code)
      code.ensureEditor = () => { if (!code.existingEditor) created++; return ensure() }
    }
    const before = f.snapshot().cm, history = f.history()
    for (let i = 0; i < 1000; i++) {
      void f.manager.isComposing
      live.toolbarState()
      live.searchController.updateCount()
      for (const code of codes) { void code.isComposing; void code.hasFocus; void code.existingEditor }
    }
    // Updating search decorations and settings is also a state-only operation.
    for (const code of codes) code.setSearchHighlights([{ from: 0, to: 5, current: false }])
    live.bracketMode('matching'); live.caretAnimation('off')
    await Promise.resolve()
    return { created, before, after: f.snapshot().cm, history, afterHistory: f.history(), count: codes.length }
  })
  assert.equal(result.count, 200)
  assert.equal(result.created, 0, '1000 state queries and search highlights must not instantiate CM')
  assert.equal(result.after, result.before)
  assert.deepEqual(result.afterHistory, result.history)
  assert.equal(await page.evaluate(() => window.f.source()), source)
  await page.locator('.md-prose > p').first().click()
  await page.keyboard.press('End')
  await page.evaluate(()=>{
    const live=window.f.live();window.inputDurations=[];let start=0
    live.view.dom.addEventListener('beforeinput',()=>{start=performance.now()},{capture:true})
    live.view.dom.addEventListener('input',()=>queueMicrotask(()=>window.inputDurations.push(performance.now()-start)))
    window.beforeTypingAllocations=window.allocations.total
  })
  await page.keyboard.type('x'.repeat(1000))
  await page.waitForFunction(() => window.f.source().includes('x'.repeat(1000)))
  const input=await page.evaluate(()=>({samples:window.inputDurations,created:window.allocations.total-window.beforeTypingAllocations}))
  assert.equal(input.created,0,'1000 ordinary paragraph keystrokes must not instantiate code editors')
  await page.evaluate(() => window.f.undo())
  await page.waitForFunction(source => window.f.source() === source, source)
  // Scroll to distant blocks and back: near blocks mount, old blocks release.
  for (const ordinal of [190, 50, 120, 0]) {
    await page.locator('.md-code-block').nth(ordinal).scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    assert.ok(await page.locator('.md-code-block').nth(ordinal).locator('.cm-content').count())
    const active = await page.locator('.md-code-block .cm-editor').count()
    const bound = await page.evaluate(() => {
      const codes = [...window.f.live().codeViews]
      const smallest = Math.min(...codes.map(code => code.dom.offsetHeight))
      return Math.ceil((window.f.live().dom.clientHeight + 1200) / smallest) + 2
    })
    assert.ok(active <= bound, `After scrolling to ${ordinal}: ${active} active CMViews exceeds viewport bound ${bound}`)
  }
  // Freeze only this target's visibility observer to exercise a genuinely cold
  // placeholder click. All editing still uses the production pointer handlers.
  await page.evaluate(() => {
    const code=[...window.f.live().codeViews][100]
    code.observer.disconnect()
  })
  const cold=page.locator('.md-code-block').nth(100)
  await cold.scrollIntoViewIfNeeded()
  await cold.locator('.md-code-placeholder code').waitFor()
  const point=await cold.locator('.md-code-placeholder code').evaluate(el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text,remaining=el.textContent.indexOf('\n')+1+7
    while((text=walker.nextNode())&&text.length<remaining) remaining-=text.length
    const range=document.createRange();range.setStart(text,remaining);range.collapse(true)
    const r=range.getBoundingClientRect();return {x:r.x+1,y:(r.top+r.bottom)/2,left:el.getBoundingClientRect().left,font:getComputedStyle(el).font,padding:getComputedStyle(el).padding}
  })
  await page.mouse.click(point.x,point.y)
  const clicked=await page.evaluate(()=>{
    const code=[...window.f.live().codeViews][100], cm=code.existingEditor
    return {head:cm?.state.selection.main.head,expected:code.node.textContent.indexOf('\n')+1+7,focus:code.hasFocus}
  })
  assert.equal(clicked.focus,true,'One cold placeholder click focuses embedded CM')
  assert.equal(clicked.head,clicked.expected,'First click preserves requested source coordinate '+JSON.stringify(clicked))
  await page.keyboard.type('COLD')
  await page.waitForFunction(()=>window.f.source().includes('second COLDline'))
  await page.keyboard.press('Control+z')
  await page.waitForFunction(source=>window.f.source()===source,source)
  await page.keyboard.press('Control+y')
  await page.waitForFunction(()=>window.f.source().includes('second COLDline'))
  await page.keyboard.press('Control+z')
  await page.waitForFunction(source=>window.f.source()===source,source)
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2})
  assert.equal(await page.evaluate(()=>window.f.manager.isComposing),true)
  await page.evaluate(()=>{window.f.live().dom.scrollTop=0})
  assert.equal(await page.evaluate(()=>[...window.f.live().codeViews][100].hasFocus),true)
  await cdp.send('Input.insertText',{text:'中文'})
  await page.waitForFunction(()=>window.f.source().includes('second 中文line'))
  // Retain reverse cross-line selections, including during a native pointer drag.
  await page.evaluate(()=>{
    const code=[...window.f.live().codeViews][100]
    code.existingEditor.dispatch({selection:{anchor:code.node.textContent.length,head:2}})
    code.inViewport=false;code.detachEditor()
  })
  assert.equal(await page.evaluate(()=>[...window.f.live().codeViews][100].existingEditor.state.selection.main.empty),false)
  // Start a real drag on a cold placeholder, then continue on the mounted CM.
  await page.evaluate(()=>[...window.f.live().codeViews][110].observer.disconnect())
  const dragBlock=page.locator('.md-code-block').nth(110)
  await dragBlock.scrollIntoViewIfNeeded()
  const dragStart=await dragBlock.locator('.md-code-text').first().evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.left+16,y:r.top+8}})
  await page.mouse.move(dragStart.x,dragStart.y);await page.mouse.down()
  await page.waitForTimeout(80)
  const dragEnd=await page.evaluate(()=>{
    const code=[...window.f.live().codeViews][110],pos=code.node.textContent.indexOf('\n')+1+6,r=code.existingEditor.coordsAtPos(pos)
    return{x:r.left+1,y:(r.top+r.bottom)/2}
  })
  await page.mouse.move(dragEnd.x,dragEnd.y,{steps:8});await page.mouse.up()
  assert.equal(await page.evaluate(()=>{
    const code=[...window.f.live().codeViews][110],range=code.existingEditor.state.selection.main
    return !range.empty&&code.node.textContent.slice(range.from,range.to).includes('\n')
  }),true,'Dragging from the first cold gesture creates a cross-line text selection')
  console.log('PASS cold first-click coordinate, typing, undo/redo, browser IME and cross-line selection')

  await page.evaluate(source=>window.f.reset(source,true),source)
  await page.waitForFunction(()=>window.f.ready())
  await page.evaluate(()=>window.f.live().find(true))
  await page.getByRole('textbox',{name:'查找',exact:true}).fill('value190')
  await page.getByRole('textbox',{name:'替换',exact:true}).fill('renamed190')
  await page.waitForFunction(()=>document.querySelector('.md-live-search .search-count')?.textContent==='1 / 1')
  await page.waitForSelector('.cm-searchMatch-selected')
  await page.getByRole('button',{name:'替换当前匹配',exact:true}).click()
  await page.waitForFunction(()=>window.f.source().includes('const renamed190 = 190;'))
  await page.getByRole('button',{name:'关闭查找 (Esc)',exact:true}).click()
  await page.evaluate(()=>window.f.undo())
  await page.waitForFunction(source=>window.f.source()===source,source)
  assert.ok(await page.locator('.md-code-block .cm-editor').count()<35,'Search navigation activates only nearby/current code blocks')

  // Geometry is derived by normal layout; changing width/wrap/numbers must not
  // leave a stale min-height from the previous live view.
  const geometry=[]
  await page.evaluate(()=>document.body.classList.add('light'))
  for(const width of [1280,600]) {
    await page.setViewportSize({width,height:850})
    const text='Visual paragraph.\n\n```js\n'+Array.from({length:8},(_,i)=>`const longLine${i} = "${'word '.repeat(30)}";`).join('\n')+'\n```\n'
    await page.evaluate(text=>window.f.reset(text,true),text)
    await page.waitForFunction(()=>window.f.ready())
    await page.waitForTimeout(150)
    for(const wrap of [false,true]) for(const numbers of [false,true]) {
      const sizes=await page.evaluate(async({wrap,numbers})=>{
        const live=window.f.live(),code=[...live.codeViews][0]
        code.observer.disconnect();code.inViewport=false
        live.typography({...live.settings,codeWrap:wrap,codeLineNumbers:numbers})
        code.detachEditor()
        const before=code.cmContainer.getBoundingClientRect().height
        code.ensureEditor()
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
        const after=code.cmContainer.getBoundingClientRect().height
        return {before,after}
      },{wrap,numbers})
      geometry.push({width,wrap,numbers,...sizes})
      assert.ok(Math.abs(sizes.before-sizes.after)<=2,`Placeholder/live height parity: ${JSON.stringify(geometry.at(-1))}`)
    }
    await page.evaluate(()=>{const c=[...window.f.live().codeViews][0];c.inViewport=false;c.detachEditor()})
    await page.screenshot({path:`${output}/${width===600?'narrow':'wide'}-static.png`})
    await page.evaluate(()=>[...window.f.live().codeViews][0].ensureEditor())
    await page.screenshot({path:`${output}/${width===600?'narrow':'wide'}.png`})
  }
  const resizedTypography=await page.evaluate(async()=>{
    const live=window.f.live(),code=[...live.codeViews][0]
    live.typography({...live.settings,fontSize:20,lineHeight:1.9,codeWrap:true,codeLineNumbers:true})
    code.inViewport=false;code.detachEditor()
    const before=code.cmContainer.offsetHeight;code.ensureEditor()
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    return{before,after:code.cmContainer.offsetHeight}
  })
  assert.ok(Math.abs(resizedTypography.before-resizedTypography.after)<=2,'Font and line-height updates keep placeholder geometry current')
  await page.setViewportSize({width:1280,height:850})
  await page.evaluate(()=>window.f.split())
  await page.waitForFunction(()=>window.f.panes.length===2&&window.f.ready())
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(()=>window.f.panes.every(p=>[...window.f.live(p).codeViews].every(code=>code.observer.root===window.f.live(p).dom))),true)
  await page.screenshot({path:`${output}/multi-pane.png`})
  await page.evaluate(()=>window.f.manager.setTypewriterMode(true))
  await page.screenshot({path:`${output}/typewriter.png`})
  await page.evaluate(()=>document.body.classList.remove('light'))
  await page.screenshot({path:`${output}/dark.png`})
  const disposed = await page.evaluate(() => window.f.dispose())
  assert.equal(disposed.remaining, 0)
  assert.equal(await page.evaluate(() => window.allocations.live), 0)
  // Missing IO safely mounts editors; read-only CM also refuses actual input.
  await page.evaluate(()=>{window.IntersectionObserver=undefined;window.f.reset('Paragraph.\n\n```js\nread only\n```',true,true)})
  await page.waitForSelector('.md-code-block .cm-content')
  await page.locator('.md-code-block .cm-content').click()
  await page.keyboard.type('SHOULD_NOT_WRITE')
  assert.equal(await page.evaluate(()=>window.f.source()),'Paragraph.\n\n```js\nread only\n```')
  await page.evaluate(()=>window.f.dispose())
  assert.deepEqual(errors, [])
  fs.writeFileSync(`${output}/state-queries.json`, JSON.stringify({ initial, ...result,clicked,geometry,input }, null, 2))
  console.log('PASS 200 code blocks: 1000 state queries, search decorations, ordinary typing and canonical undo')
} finally { await browser?.close(); await server.close() }
