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
  for(const name of ['transparent.png','sample.jpg','sample.bmp','sample.webp','animated.gif','safe.svg','wrong-extension.txt','sample.ico','sample.cur','sample.avif','sample.jfif','animated.apng']){
    console.log('Image',name)
    const id=await page.evaluate(name=>window.mediaTest.open(name),name)
    await page.waitForFunction(()=>document.querySelector('.image-stage img')?.naturalWidth>0)
    assert.equal(await page.evaluate(id=>window.mediaTest.manager.getState(id),id),undefined,'Media created EditorState')
    assert.equal(await page.evaluate(id=>window.mediaTest.manager.saveSnapshot(id),id),null)
    if(name==='transparent.png'){
      // The transparency pattern belongs to the image, not the entire editing surface.
      const layout=await page.locator('.image-viewport').evaluate(el=>{
        const image=el.querySelector('.image-stage').getBoundingClientRect(),bounds=el.getBoundingClientRect()
        return {background:getComputedStyle(el).backgroundImage,centerX:Math.abs(image.left+image.width/2-bounds.left-bounds.width/2),centerY:Math.abs(image.top+image.height/2-bounds.top-bounds.height/2)}
      })
      assert.equal(layout.background,'none');assert(layout.centerX<2 && layout.centerY<2)
      await page.screenshot({path:'.markumo-media-test/image-viewer-dark.png'})
      await page.evaluate(()=>document.body.classList.add('light'));await page.screenshot({path:'.markumo-media-test/image-viewer-light.png'})
      await page.getByRole('button',{name:'透明背景',exact:true}).click();assert.equal(await page.locator('.image-surface.checker').count(),0)
      await page.getByRole('button',{name:'透明背景',exact:true}).click()
      await page.getByRole('combobox',{name:'图片缩放比例'}).selectOption('4')
      await page.getByRole('button',{name:'像素网格',exact:true}).click();assert.equal(await page.locator('.pixel-grid').count(),1)
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
  await page.evaluate(()=>window.mediaTest.close());await page.waitForFunction(()=>window.mediaTest.workers.size===0)
  await page.evaluate(()=>window.mediaTest.open('long.pdf'))
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-page .textLayer span').length>0)
  await page.getByRole('button',{name:'末页',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="第 550 页"] .textLayer span'))
  assert(await page.locator('.pdf-page').count()<=3)
  const pixels=await page.locator('canvas').evaluateAll(cs=>cs.reduce((sum,c)=>sum+c.width*c.height*4,0))
  assert(pixels<=64*1024*1024)
  // Rapid page changes and zoom must cancel stale canvas/text renderers.
  const pageNumber=page.getByRole('spinbutton',{name:'页码'})
  for(const n of [1,400,3,549,200]){await pageNumber.fill(String(n));await pageNumber.press('Enter');await pageNumber.blur()}
  for(let n=0;n<4;n++)await page.getByRole('button',{name:'放大',exact:true}).click()
  for(let n=0;n<4;n++)await page.getByRole('button',{name:'缩小',exact:true}).click()
  await page.getByRole('button',{name:'适应页面',exact:true}).click()
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pdf-page')).some(p=>p.querySelector('.textLayer span')))
  await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('textbox',{name:'搜索 PDF 文本'}).fill('needle')
  await page.waitForFunction(()=>document.querySelector('mark.selected'),{timeout:60000})
  await page.getByRole('button',{name:'下一个',exact:true}).click()
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
  await page.evaluate(()=>window.mediaTest.open('sample.ico'))
  await page.waitForFunction(()=>document.querySelector('.image-stage img')?.naturalWidth>0&&window.mediaTest.workers.size===0)
  await page.screenshot({path:'.markumo-media-test/markdown-image-split.png'})
  await page.evaluate(()=>{const m=window.mediaTest.manager;m.focusPane('main',false);m.setMarkdownMode(m.activeId,'live')})
  await page.waitForFunction(()=>document.querySelector('[data-pane-id="main"] .markdown-live'))
  assert.equal(await page.locator('[data-pane-id="main"] .pane-mode-control').count(),1)
  assert.equal(await page.locator('.image-viewer .cm-editor,.image-viewer .pane-mode-control').count(),0)
  assert.deepEqual(errors,[])
  report.splitLayout=true
  fs.writeFileSync('.markumo-media-test/browser-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error);console.error(await page?.locator('body').innerText());throw error}finally{await browser?.close();await server.close()}
