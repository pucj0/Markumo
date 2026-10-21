// pnpm exec node scripts/media-regression.mjs
// Uses Playwright from MARKUMO_PLAYWRIGHT_MODULE or an installed playwright package.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const root=path.resolve('.markumo-media-test/fixtures')
const mime={png:'image/png',apng:'image/png',jpg:'image/jpeg',jfif:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',cur:'image/x-icon',avif:'image/avif',svg:'image/svg+xml',pdf:'application/pdf',txt:'image/png'}
if (!fs.existsSync(path.join(root, 'bookmark.pdf'))) {
  await import('./generate-bookmark-pdf.mjs')
}
if (!fs.existsSync(path.join(root, 'links.pdf'))) {
  await import('./generate-link-pdf.mjs')
}
const server=await createServer({server:{port:1421,strictPort:true},plugins:[{name:'test-fixtures',configureServer(server){server.middlewares.use('/test-media/',async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname.slice(1))
    if(path.basename(name)!==name)throw Error('Invalid fixture')
    const file=path.join(root,name),stat=fs.statSync(file),ext=name.split('.').pop()
    if(url.searchParams.has('meta')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{byteLength:stat.size,mime:mime[ext],format:ext.toUpperCase()},'fixture']));return}
    const offset=Number(url.searchParams.get('offset')),length=Number(url.searchParams.get('length'))
    if(length<1||length>256*1024||offset<0||offset+length>stat.size)throw Error('Invalid range')
    const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(length);try{fs.readSync(fd,bytes,0,length,offset)}finally{fs.closeSync(fd)}res.end(bytes)
  }catch(e){res.statusCode=400;res.end(String(e))}
})}}]})
await server.listen()
let browser, page
try{
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  page=await browser.newPage({viewport:{width:1200,height:820}});const errors=[]
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  async function heap(){await cdp.send('HeapProfiler.collectGarbage');return (await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value}
  page.on('worker',w=>console.log('Worker',w.url()))
  page.on('dialog',dialog=>{errors.push(`Unexpected dialog: ${dialog.message()}`);void dialog.dismiss()})
  page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url())})
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.stack)});page.on('console',m=>{if(m.type()==='error')console.error(m.text())})
  await page.goto('http://localhost:1421/scripts/media-harness.html');await page.waitForFunction(()=>window.mediaTest)
  await page.evaluate(()=>window.mediaTest.text())
  assert.equal(await page.evaluate(()=>window.mediaTest.workers.size),0)
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name))
  assert(!resources.some(x=>/pdfjs-dist|PdfViewer|ImageViewer/.test(x)),'Text-only host loaded a media module')
  const textId=await page.evaluate(()=>window.mediaTest.manager.activeId)
  const textHeap=await heap()
  const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const readingPoint=(x=.5,y=.5)=>page.locator('.pdf-viewport').evaluate((host,{x,y})=>{
    const box=host.getBoundingClientRect(),px=box.left+host.clientWidth*x,py=box.top+host.clientHeight*y
    const page=Array.from(host.querySelectorAll('.pdf-page')).find(el=>{const r=el.getBoundingClientRect();return py>=r.top&&py<=r.bottom})
    if(!page)return {page:1,x:0,y:0}
    const rect=page.getBoundingClientRect()
    return {page:Number(page.getAttribute('aria-label').match(/\d+/)[0]),x:(px-rect.left)/rect.width,y:(py-rect.top)/rect.height}
  },{x,y})
  for(const name of ['transparent.png','sample.jpg','sample.bmp','sample.webp','animated.gif','safe.svg','wrong-extension.txt','sample.ico','sample.cur','sample.avif','sample.jfif','animated.apng']){
    console.log('Image',name)
    const id=await page.evaluate(name=>window.mediaTest.open(name),name)
    await page.waitForFunction(()=>document.querySelector('.image-stage img')?.naturalWidth>0)
    assert.equal(await page.evaluate(id=>window.mediaTest.manager.getState(id),id),undefined,'Media created EditorState')
    assert.equal(await page.evaluate(id=>window.mediaTest.manager.saveSnapshot(id),id),null)
    if(name==='transparent.png'){
      // Transparent images use a solid background, including at high zoom.
      const layout=await page.locator('.image-viewport').evaluate(el=>{
        const image=el.querySelector('.image-stage').getBoundingClientRect(),bounds=el.getBoundingClientRect()
        return {background:getComputedStyle(el).backgroundImage,centerX:Math.abs(image.left+image.width/2-bounds.left-bounds.width/2),centerY:Math.abs(image.top+image.height/2-bounds.top-bounds.height/2)}
      })
      assert.equal(layout.background,'none');assert(layout.centerX<2 && layout.centerY<2)
      await page.screenshot({path:'.markumo-media-test/image-viewer-dark.png'})
      await page.evaluate(()=>document.body.classList.add('light'));await page.screenshot({path:'.markumo-media-test/image-viewer-light.png'})
      await page.getByRole('combobox',{name:'图片缩放比例'}).selectOption('4')
      assert.equal(await page.locator('.image-surface').evaluate(el=>getComputedStyle(el).backgroundImage),'none')
      await page.getByRole('button',{name:'旋转 90°',exact:true}).click()
      await page.getByRole('button',{name:'重置图片视图',exact:true}).click()
      await page.evaluate(()=>document.body.classList.remove('light'))
    }
    if(name==='sample.ico')await page.screenshot({path:'.markumo-media-test/image-viewer-ico.png'})
    await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.blobs.size===0)
  }
  console.log('PDF single');await page.evaluate(()=>window.mediaTest.open('single.pdf'))
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-page .textLayer span').length>0,{timeout:30000})
  assert.equal(await page.evaluate(()=>window.mediaTest.workers.size),1)
  assert.equal(await page.getByRole('combobox',{name:'PDF 缩放比例'}).inputValue(),'page')
  assert.equal(await page.getByRole('button',{name:'连续滚动',exact:true}).getAttribute('aria-pressed'),'true')
  await page.screenshot({path:'.markumo-media-test/pdf-reader-edge.png'})
  // 5. Test empty outline on single.pdf (navigation is open by default)
  assert.equal(await page.getByRole('button',{name:'显示/隐藏 PDF 导航'}).getAttribute('aria-pressed'),'true')
  await page.getByRole('tab',{name:'文档大纲'}).click();await flush()
  assert.equal(await page.locator('.pdf-outline-empty').innerText(),'此 PDF 不包含文档目录')
  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)

  // 1-8. Test bookmark.pdf: thumbnails, outlines, destination jump, collapse/expand, resizer
  console.log('PDF bookmark & navigation')
  await page.evaluate(()=>window.mediaTest.open('bookmark.pdf'))
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-page .textLayer span').length>0,{timeout:30000})
  const navBtn=page.getByRole('button',{name:'显示/隐藏 PDF 导航'})
  assert.equal(await navBtn.getAttribute('aria-pressed'),'true')
  assert.equal(await page.locator('.pdf-navigation').isVisible(),true)
  assert.equal(await page.getByRole('tab',{name:'页面缩略图'}).getAttribute('aria-selected'),'true')

  // Thumbnails generation & click to jump
  await page.waitForFunction(()=>document.querySelector('.pdf-thumbnail-item[data-page-number="1"] img'))
  assert.equal(await page.locator('.pdf-thumbnail-item').count(),4)
  assert.equal(await page.locator('.pdf-thumbnail-item.active').getAttribute('data-page-number'),'1')

  const pageBox=page.getByRole('textbox',{name:'页码',exact:true})
  // Click thumbnail 3 to jump
  await page.locator('.pdf-thumbnail-item[data-page-number="3"]').click();await flush()
  assert.equal(await pageBox.inputValue(),'3')
  assert.equal(await page.locator('.pdf-thumbnail-item.active').getAttribute('data-page-number'),'3')

  // Outline / bookmarks navigation
  await page.getByRole('tab',{name:'文档大纲'}).click();await flush()
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-outline-node').length>=2)
  const outlineTitles=await page.locator('.pdf-outline-title').allInnerTexts()
  assert.ok(outlineTitles.includes('Chapter 1'))
  assert.ok(outlineTitles.includes('Section 1.1'))
  assert.ok(outlineTitles.includes('Chapter 2'))

  // Click Section 1.1 (dest points to page 2)
  await page.locator('.pdf-outline-title:has-text("Section 1.1")').click();await flush()
  assert.equal(await pageBox.inputValue(),'2')

  // Click Chapter 2 (dest points to page 3)
  await page.locator('.pdf-outline-title:has-text("Chapter 2")').click();await flush()
  assert.equal(await pageBox.inputValue(),'3')

  // Multi-level bookmark expand/collapse
  const twisty=page.locator('.pdf-outline-node:has-text("Chapter 1") .pdf-outline-twisty').first()
  await twisty.click();await flush()
  assert.equal(await page.locator('.pdf-outline-title:has-text("Section 1.1")').count(),0)
  await twisty.click();await flush()
  assert.equal(await page.locator('.pdf-outline-title:has-text("Section 1.1")').count(),1)

  // Toggle sidebar preserves reading anchor
  const beforeNavClose=await readingPoint()
  await navBtn.click();await flush()
  assert.equal(await page.locator('.pdf-navigation').count(),0)
  const afterNavClose=await readingPoint()
  assert.equal(afterNavClose.page,beforeNavClose.page)
  assert(Math.abs(afterNavClose.y-beforeNavClose.y)<.01)
  await navBtn.click();await flush()
  assert.equal(await page.locator('.pdf-navigation').isVisible(),true)
  assert.equal((await readingPoint()).page,beforeNavClose.page)

  // Resizer & theme screenshot
  const resizer=page.locator('.pdf-nav-resizer')
  const initialWidth=await page.locator('.pdf-navigation').evaluate(el=>el.getBoundingClientRect().width)
  assert.ok(initialWidth>=140&&initialWidth<=320)
  const resizerBox=await resizer.boundingBox()
  await page.mouse.move(resizerBox.x+resizerBox.width/2,resizerBox.y+100)
  await page.mouse.down()
  await page.mouse.move(resizerBox.x+50,resizerBox.y+100)
  await page.mouse.up();await flush()
  const resizedWidth=await page.locator('.pdf-navigation').evaluate(el=>el.getBoundingClientRect().width)
  assert.ok(resizedWidth>initialWidth)

  // Screenshots of outline in dark and light
  await page.screenshot({path:'.markumo-media-test/pdf-outline-dark.png'})
  await page.evaluate(()=>document.body.classList.add('light'))
  await page.screenshot({path:'.markumo-media-test/pdf-outline-light.png'})
  await page.evaluate(()=>document.body.classList.remove('light'))

  // Screenshots of thumbnails in dark and light
  await page.getByRole('tab',{name:'页面缩略图'}).click();await flush()
  await page.waitForFunction(()=>document.querySelector('.pdf-thumbnail-item[data-page-number="1"] img'))
  await page.screenshot({path:'.markumo-media-test/pdf-thumbnails-dark.png'})
  await page.evaluate(()=>document.body.classList.add('light'))
  await page.screenshot({path:'.markumo-media-test/pdf-thumbnails-light.png'})
  await page.evaluate(()=>document.body.classList.remove('light'))

  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)

  // 1-11. Test links.pdf: safe annotation link layer, internal navigation, coordinate jump, external URL, blocking unsafe schemes
  console.log('PDF links & safe annotation layer')
  await page.evaluate(() => window.mediaTest.open('links.pdf'))
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page .textLayer span').length > 0, { timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page .annotation-host a.pdf-link-annotation').length >= 5)

  // 1. Verify link elements and coordinates
  const linksCount = await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').count()
  assert.equal(linksCount, 8, `Expected 8 link annotations on page 1, got ${linksCount}`)

  // Verify bounding box of first link (Page 3 jump)
  const link1Box = await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().boundingBox()
  assert.ok(link1Box && link1Box.width > 50 && link1Box.height > 10, 'Link bounding box must be valid')

  // 2. Click Link 1: Jump to Page 3
  await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().click()
  await flush()
  assert.equal(await pageBox.inputValue(), '3', 'Clicking link 1 must jump to Page 3')

  // 3. Jump back to Page 1 and click Link 2 (Coordinate jump to Page 2 at Y=500)
  await pageBox.fill('1')
  await pageBox.press('Enter')
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 1 页"] .annotation-host'))
  const link2 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(1)
  await link2.click()
  await flush()
  assert.equal(await pageBox.inputValue(), '2', 'Clicking link 2 must navigate to Page 2')

  // 4. Jump back to Page 1 and click Link 3 (Named destination 'named-chapter' -> Page 3)
  await pageBox.fill('1')
  await pageBox.press('Enter')
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 1 页"] .annotation-host'))
  const link3 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(2)
  await link3.click()
  await flush()
  assert.equal(await pageBox.inputValue(), '3', 'Clicking named dest link must jump to Page 3')

  // 5. External HTTPS link (Link 4)
  await pageBox.fill('1')
  await pageBox.press('Enter')
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 1 页"] .annotation-host'))
  await page.evaluate(() => { window.openedUrls = [] })
  const link4 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(3)
  await link4.click()
  await flush()
  const openedUrls = await page.evaluate(() => window.openedUrls)
  assert.ok(openedUrls.some(u => u.includes('https://example.com/test-page')), `Expected external URL opened, got: ${JSON.stringify(openedUrls)}`)
  assert.equal(await pageBox.inputValue(), '1', 'Opening external link must not change current reading page')

  // 6. JavaScript action and unsafe protocol link (Links 5 and 6)
  await page.evaluate(() => { window.openedUrls = []; window.notices = [] })
  const link5 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(4)
  await link5.click()
  const link6 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(5)
  await link6.click()
  await flush()
  const unsafeOpened = await page.evaluate(() => window.openedUrls)
  assert.equal(unsafeOpened.length, 0, 'Unsafe javascript actions/urls must NOT be opened or executed')
  const notices = await page.evaluate(() => window.notices)
  assert.ok(notices.length > 0, 'Security notice must be emitted for blocked actions')

  // 7. Invalid destination (Link 7)
  const link7 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(6)
  await link7.click()
  await flush()
  assert.equal(await pageBox.inputValue(), '1', 'Invalid destination must fail safely without crash')

  // 8. NextPage named action (Link 8)
  const link8 = page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').nth(7)
  await link8.click()
  await flush()
  assert.equal(await pageBox.inputValue(), '2', 'NextPage action must jump to Page 2')

  // 9. Zoom and rotation link layer alignment
  await pageBox.fill('1')
  await pageBox.press('Enter')
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 1 页"] .annotation-host'))
  const boxBeforeZoom = await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().boundingBox()
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await flush()
  const boxAfterZoom = await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().boundingBox()
  assert.ok(boxAfterZoom && boxBeforeZoom && boxAfterZoom.width > boxBeforeZoom.width, 'Link rect must scale on zoom')

  // Rotate 90 deg
  await page.getByRole('button', { name: '旋转 PDF', exact: true }).click()
  await flush()
  const boxAfterRot = await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().boundingBox()
  assert.ok(boxAfterRot && boxAfterRot.width > 0 && boxAfterRot.height > 0, 'Link rect must stay valid after rotation')

  // 10. Single page mode navigation
  await page.getByRole('button', { name: '连续滚动', exact: true }).click() // Switch to single page
  await flush()
  assert.equal(await page.locator('.pdf-page').count(), 1)
  await pageBox.fill('1')
  await pageBox.press('Enter')
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 1 页"] .annotation-host'))
  await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().click()
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 3 页"]'))
  assert.equal(await pageBox.inputValue(), '3', 'Single page mode must jump to Page 3')

  // Switch back to continuous
  await page.getByRole('button', { name: '连续滚动', exact: true }).click()
  await flush()

  // Reset rotation
  for (let r = 0; r < 3; r++) await page.getByRole('button', { name: '旋转 PDF', exact: true }).click()
  await flush()

  // 11. Text selection on page with links is intact
  await pageBox.fill('1')
  await pageBox.press('Enter')
  await flush()
  await page.waitForFunction(() => document.querySelector('.pdf-page[aria-label="第 1 页"] .textLayer span'))
  const textSpans = await page.locator('.pdf-page[aria-label="第 1 页"] .textLayer span').count()
  assert.ok(textSpans > 0, 'TextLayer spans must be present and selectable')

  await page.locator('.pdf-page[aria-label="第 1 页"] .annotation-host a.pdf-link-annotation').first().hover()
  await page.screenshot({ path: '.markumo-media-test/pdf-links-hover.png' })
  await page.screenshot({ path: '.markumo-media-test/pdf-links-test.png' })
  await page.evaluate(() => window.mediaTest.close())
  await page.waitForFunction(() => window.mediaTest.workers.size === 0)

  await page.evaluate(()=>window.mediaTest.open('long.pdf'))
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-page .textLayer span').length>0)
  await page.getByRole('button',{name:'末页',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="第 550 页"] .textLayer span'))
  assert(await page.locator('.pdf-page').count()<=3)
  const pixels=await page.locator('canvas').evaluateAll(cs=>cs.reduce((sum,c)=>sum+c.width*c.height*4,0))
  assert(pixels<=64*1024*1024)
  // Rapid page changes and zoom must cancel stale canvas/text renderers.
  const pageNumber=page.getByRole('textbox',{name:'页码',exact:true})
  for(const n of [1,400,3,549,200]){await pageNumber.fill(String(n));await pageNumber.press('Enter');await pageNumber.blur()}
  await page.waitForFunction(()=>document.querySelector('[aria-label="第 200 页"] .textLayer span'))
  await page.locator('.pdf-viewport').evaluate(host=>{
    const paper=host.querySelector('[aria-label="第 200 页"]');host.scrollTop=paper.offsetTop+paper.offsetHeight*.4-host.clientHeight/2
  });await flush()
  const beforeZoom=await readingPoint()
  const retainedPreview=await page.locator('.pdf-viewport').evaluate(async host=>{
    const canvas=host.querySelector('[aria-label="第 200 页"] canvas'),select=document.querySelector('[aria-label="PDF 缩放比例"]')
    select.value='1.25';select.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve()
    return canvas.isConnected&&canvas.width>0
  })
  assert(retainedPreview,'Zoom discarded the displayed bitmap before the replacement was ready');await flush()
  const afterZoom=await readingPoint()
  assert.equal(afterZoom.page,beforeZoom.page);assert(Math.abs(afterZoom.y-beforeZoom.y)<.005);assert(Math.abs(afterZoom.x-beforeZoom.x)<.005)
  // Cursor-centered horizontal zoom applies once the page overflows the viewport;
  // smaller pages stay centered, as in browser PDF readers.
  await page.getByRole('combobox',{name:'PDF 缩放比例'}).selectOption('2');await flush()
  const beforeWheel=await readingPoint(.4,.35)
  await page.locator('.pdf-viewport').evaluate(host=>{const box=host.getBoundingClientRect();host.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-90,clientX:box.left+host.clientWidth*.4,clientY:box.top+host.clientHeight*.35,bubbles:true,cancelable:true}))})
  await flush();const afterWheel=await readingPoint(.4,.35)
  assert.equal(afterWheel.page,beforeWheel.page);assert(Math.abs(afterWheel.y-beforeWheel.y)<.005);assert(Math.abs(afterWheel.x-beforeWheel.x)<.005)
  const pdfId=await page.evaluate(()=>window.mediaTest.manager.activeId),beforeSwitch=await readingPoint()
  await page.evaluate(()=>window.mediaTest.open('transparent.png'));await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  await page.evaluate(id=>window.mediaTest.manager.select(id),pdfId)
  await page.waitForFunction(()=>document.querySelector('[aria-label="第 200 页"] .textLayer span'));await flush()
  const afterSwitch=await readingPoint()
  assert.equal(afterSwitch.page,beforeSwitch.page);assert(Math.abs(afterSwitch.y-beforeSwitch.y)<.01)
  await pageNumber.fill('invalid');await pageNumber.press('Escape');assert.equal(await pageNumber.inputValue(),'200')
  for(let n=0;n<4;n++)await page.getByRole('button',{name:'放大',exact:true}).click()
  for(let n=0;n<4;n++)await page.getByRole('button',{name:'缩小',exact:true}).click()
  await page.getByRole('button',{name:'适应页面',exact:true}).click()
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pdf-page')).some(p=>p.querySelector('.textLayer span')))
  await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('textbox',{name:'搜索 PDF 文本'}).fill('needle')
  await page.waitForFunction(()=>document.querySelector('mark.selected'),{timeout:60000})
  assert(await page.locator('.search-progress').count()>0,'Search waited for the whole long document before locating a result')
  await page.screenshot({path:'.markumo-media-test/pdf-reader-search.png'})
  await page.getByRole('button',{name:'下一个',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="第 201 页"] mark.selected'))
  await flush();const beforeSearchClose=await readingPoint()
  await page.getByRole('textbox',{name:'搜索 PDF 文本'}).press('Escape');await flush()
  assert.equal(await page.locator('.pdf-search').count(),0)
  const afterSearchClose=await readingPoint()
  assert.equal(afterSearchClose.page,beforeSearchClose.page);assert(Math.abs(afterSearchClose.y-beforeSearchClose.y)<.005)
  await page.locator('.pdf-viewport').press('Control+g');assert.equal(await pageNumber.evaluate(el=>el===document.activeElement),true)
  await pageNumber.fill('2');await pageNumber.press('Enter');await flush()
  const beforePageDown=await page.locator('.pdf-viewport').evaluate(host=>host.scrollTop)
  await page.locator('.pdf-viewport').press('PageDown');await flush()
  assert(await page.locator('.pdf-viewport').evaluate(host=>host.scrollTop)>beforePageDown)

  // 11-12. Test 550 pages lazy thumbnail loading and LRU cache (navigation is open by default)
  assert.equal(await page.getByRole('button',{name:'显示/隐藏 PDF 导航'}).getAttribute('aria-pressed'),'true')
  assert.equal(await page.locator('.pdf-thumbnail-item').count(),550)
  await page.waitForTimeout(200)
  const renderedThumbs=await page.locator('.pdf-thumbnail-img').count()
  assert.ok(renderedThumbs<=15,'Thumbnail lazy loading should render only visible items, rendered: '+renderedThumbs)
  // Scroll thumbnail container down
  await page.locator('.pdf-thumbnails-container').evaluate(el=>{el.scrollTop=4000});await flush()
  await page.waitForTimeout(300)
  const scrolledThumbs=await page.locator('.pdf-thumbnail-img').count()
  assert.ok(scrolledThumbs<=48,'Thumbnail LRU cache must be strictly bounded <= 48, count: '+scrolledThumbs)
  await page.getByRole('button',{name:'显示/隐藏 PDF 导航'}).click();await flush()

  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  await page.evaluate(()=>window.mediaTest.open('mixed.pdf'));await page.waitForFunction(()=>document.querySelector('.pdf-page .textLayer span'))
  await page.getByRole('combobox',{name:'PDF 缩放比例'}).selectOption('width')
  await pageNumber.fill('2');await pageNumber.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="第 2 页"] .textLayer span'));await flush()
  await page.getByRole('button',{name:'旋转 PDF',exact:true}).click();await flush()
  const rotation=await page.evaluate(()=>window.mediaTest.manager.mediaViewState(window.mediaTest.manager.activeId,'main').rotation)
  assert.equal(rotation,90)
  const fitError=await page.locator('.pdf-viewport').evaluate(host=>Math.abs(host.querySelector('[aria-label="第 2 页"]').getBoundingClientRect().width-(host.clientWidth-48)))
  assert(fitError<3)
  await page.getByRole('button',{name:'抓手工具',exact:true}).click()
  await page.getByRole('button',{name:'连续滚动',exact:true}).click();await flush()
  assert.equal(await page.locator('.pdf-page').count(),1)
  await page.locator('.pdf-viewport').press('PageDown');await flush()
  assert.equal(await pageNumber.inputValue(),'3')
  await page.getByRole('button',{name:'连续滚动',exact:true}).click();await flush()
  assert.equal(await page.getByRole('button',{name:'抓手工具',exact:true}).getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'抓手工具',exact:true}).click()
  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  // A closing tab may still be awaiting its first IPC block or native decoder.
  for(let n=0;n<5;n++){
    await page.evaluate(async()=>{await window.mediaTest.open('large.pdf');window.mediaTest.close();await window.mediaTest.open('transparent.png');window.mediaTest.close()})
  }
  await page.waitForFunction(()=>window.mediaTest.workers.size===0&&window.mediaTest.blobs.size===0)
  await page.evaluate(()=>window.mediaTest.open('large.pdf'));await page.waitForFunction(()=>document.querySelector('.pdf-page .textLayer span'),{timeout:30000})
  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  await page.evaluate(()=>window.mediaTest.open('encrypted.pdf'));await page.getByLabel('PDF 密码').fill('bad');await page.getByRole('button',{name:'打开',exact:true}).click()
  await page.getByText('密码不正确，请重试').waitFor();await page.getByLabel('PDF 密码').fill('markumo-test');await page.getByRole('button',{name:'打开',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.pdf-page .textLayer span'))
  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  const heapSamples=[{cycle:0,bytes:await heap()}]
  for(let n=0;n<20;n++){
    await page.evaluate(()=>window.mediaTest.open('single.pdf'));await page.waitForFunction(()=>document.querySelector('.pdf-page .textLayer span'))
    await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0&&document.querySelectorAll('canvas').length===0)
    await page.evaluate(n=>window.mediaTest.open(n%2?'sample.jpg':'transparent.png'),n);await page.waitForFunction(()=>document.querySelector('.image-stage img')?.naturalWidth>0)
    await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.blobs.size===0)
    if(n===9||n===19)heapSamples.push({cycle:n+1,bytes:await heap()})
  }
  // Document identity, preview replacement, pane ownership and unchanged text undo path.
  const result=await page.evaluate(async(textId)=>{
    const t=window.mediaTest,m=t.manager
    const temporary=await t.open('transparent.png',true);await t.open('sample.ico',true)
    const replaced=!m.metadata(temporary)&&!m.openedDocuments.some(d=>d.id===temporary)
    t.close()
    const first=await t.open('single.pdf',true),again=await t.open('single.pdf',false)
    const noState=m.getState(first)===undefined,one=m.openedDocuments.filter(d=>d.id===first).length
    const original=m.metadata(first),releaseBefore=t.released.length
    t.controller.accept({...original,token:'duplicate-grant',version:original.lastDiskVersion,media:original.media,text:'',encoding:'Binary',bom:false,eol:'LF',readOnly:true})
    const deduplicated=m.activeId===first&&t.released.slice(releaseBefore).includes('duplicate-grant')
    m.splitPane('right','main',first);m.close(first,true,'main');const survives=!!m.metadata(first)
    m.close(first,true,m.activePane);const closed=!m.metadata(first)
    m.focusPane('main',false);m.open(textId,false);m.dispatch(textId,{changes:{from:0,insert:'preserved'}})
    const text=m.getText(textId);m.command('undo');const undone=m.getText(textId)
    return {same:first===again,noState,one,survives,closed,text,undone,replaced,deduplicated}
  },textId)
  assert.deepEqual(result,{same:true,noState:true,one:1,survives:true,closed:true,text:'preserved',undone:'',replaced:true,deduplicated:true})
  await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  assert.deepEqual(errors,[])
  const report={passed:true,cycles:20,canvasBytes:pixels,textHeap,heapSamples,maxChunk:await page.evaluate(()=>Math.max(...window.mediaTest.requests.map(r=>r.length)))}
  await page.goto('http://localhost:1421/scripts/media-harness.html?layout=1');await page.waitForFunction(()=>window.mediaTest)
  await page.evaluate(async()=>{
    const m=window.mediaTest.manager,id=m.createUntitled('md')
    m.setMarkdownMode(id,'source');m.dispatch(id,{changes:{from:0,insert:'# Split regression\n\nMarkdown remains editable.'}})
    m.splitPane('right');await window.mediaTest.open('single.pdf')
  })
  await page.waitForFunction(()=>document.querySelectorAll('.pane[data-pane-id]').length===2&&document.querySelector('.pdf-page .textLayer span'))
  assert.match(await page.locator('[data-pane-id="main"] .cm-content').innerText(),/Markdown remains editable/)
  await page.screenshot({path:'.markumo-media-test/markdown-pdf-split.png'})
  await page.getByLabel('更多 PDF 操作').click()
  await page.getByRole('button',{name:'使用系统默认程序打开',exact:true}).waitFor({state:'visible'})
  await page.getByRole('button',{name:'顺时针旋转 90°',exact:true}).waitFor({state:'visible'})
  await page.getByLabel('更多 PDF 操作').press('Escape')
  await page.evaluate(()=>window.mediaTest.open('sample.ico'))
  await page.waitForFunction(()=>document.querySelector('.image-stage img')?.naturalWidth>0&&window.mediaTest.workers.size===0)
  await page.screenshot({path:'.markumo-media-test/markdown-image-split.png'})
  await page.evaluate(()=>{const m=window.mediaTest.manager;m.focusPane('main',false);m.setMarkdownMode(m.activeId,'live')})
  await page.waitForFunction(()=>document.querySelector('[data-pane-id="main"] .markdown-live'))
  assert.equal(await page.locator('[data-pane-id="main"] .md-live-toolbar .md-mode-switcher').count(),1)
  assert.equal(await page.locator('.image-viewer .cm-editor,.image-viewer .md-live-toolbar').count(),0)

  // 15. Verify multi-pane independent navigation state between two PDF panes
  const { leftPane, rightPane } = await page.evaluate(async()=>{
    const m=window.mediaTest.manager
    m.close(m.activeId,true)
    const p1=m.activePane
    await window.mediaTest.open('bookmark.pdf')
    const p2=m.splitPane('right')
    await window.mediaTest.open('single.pdf')
    return { leftPane:p1, rightPane:p2 }
  })
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-viewport').length===2&&document.querySelectorAll('.pdf-page .textLayer span').length>=2)
  // All text spans can belong to the left PDF while the right one is still
  // loading. Wait for each pane's real navigation before asserting its state.
  await page.locator(`[data-pane-id="${leftPane}"] .pdf-navigation`).waitFor({state:'visible'})
  await page.locator(`[data-pane-id="${rightPane}"] .pdf-navigation`).waitFor({state:'visible'})
  // Both panes default to navigation open
  assert.equal(await page.locator(`[data-pane-id="${leftPane}"] .pdf-navigation`).isVisible(),true)
  assert.equal(await page.locator(`[data-pane-id="${rightPane}"] .pdf-navigation`).isVisible(),true)
  // Close navigation in right pane while left pane stays open
  await page.locator(`[data-pane-id="${rightPane}"] [aria-label="显示/隐藏 PDF 导航"]`).click();await flush()
  assert.equal(await page.locator(`[data-pane-id="${leftPane}"] .pdf-navigation`).isVisible(),true)
  assert.equal(await page.locator(`[data-pane-id="${rightPane}"] .pdf-navigation`).count(),0)
  const paneStates=await page.evaluate(({ leftPane, rightPane })=>{
    const m=window.mediaTest.manager
    const id1=m.layout.getPane(leftPane).group.activeId
    const id2=m.layout.getPane(rightPane).group.activeId
    return {
      mainOpen: m.mediaViewState(id1, leftPane).pdfNavigationOpen,
      rightOpen: m.mediaViewState(id2, rightPane).pdfNavigationOpen,
    }
  }, { leftPane, rightPane })
  assert.equal(paneStates.mainOpen,true)
  assert.equal(paneStates.rightOpen,false)

  assert.deepEqual(errors,[])
  report.splitLayout=true
  fs.writeFileSync('.markumo-media-test/browser-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error);console.error(await page?.locator('body').innerText());throw error}finally{await browser?.close();await server.close()}
