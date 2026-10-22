import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
await import('./generate-link-pdf.mjs')
const output='test-results/pdf-destination'
fs.mkdirSync(output,{recursive:true})
const root=path.resolve('.markumo-media-test/fixtures')
const server=await createServer({server:{port:1466,strictPort:true},plugins:[{name:'pdf-fixture',configureServer(server){
  server.middlewares.use('/test-media/',(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname.slice(1))
      assert.equal(name,'links.pdf')
      const bytes=fs.readFileSync(path.join(root,name))
      if(url.searchParams.has('meta')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{byteLength:bytes.length,mime:'application/pdf',format:'PDF'},'fixture']));return}
      const start=Number(url.searchParams.get('offset')),length=Number(url.searchParams.get('length'))
      res.end(bytes.subarray(start,start+length))
    } catch(error){res.statusCode=400;res.end(String(error))}
  })
}}]})
await server.listen()
let browser
const results=[],errors=[]
try {
  browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars'],executablePath:process.env.MARKUMO_CHROME})
  const page=await browser.newPage({viewport:{width:1000,height:820}})
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://localhost:1466/scripts/media-harness.html')
  await page.waitForFunction(()=>window.mediaTest)
  const open=async()=>{
    await page.evaluate(()=>window.mediaTest.open('links.pdf'))
    await page.waitForFunction(()=>document.querySelector('.pdf-page .textLayer span'))
    await page.evaluate(()=>{window.v=document.querySelector('.pdf-viewer').__vueParentComponent.setupState})
    await page.waitForTimeout(200)
  }
  const flush=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForTimeout(100)}
  const snapshot=()=>page.evaluate(()=>{const host=document.querySelector('.pdf-viewport');return {top:host.scrollTop,left:host.scrollLeft,scale:window.v.scale,page:window.v.page,rotation:window.v.view.rotation}})
  const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
  await open()

  // Expected destination geometry is independent of the production resolver.
  const assertTarget=async(number,scale,point)=>{
    const actual=await page.evaluate(({number,point})=>{
      const host=document.querySelector('.pdf-viewport'),sheet=host.querySelector(`[aria-label="第 ${number} 页"]`)
      const top=parseFloat(sheet.style.top)+point[1],left=parseFloat(sheet.style.left)+point[0]
      return {scale:window.v.scale,top:host.scrollTop,left:host.scrollLeft,
        expectedTop:Math.max(0,Math.min(host.scrollHeight-host.clientHeight,Math.round(top))),
        expectedLeft:Math.max(0,Math.min(host.scrollWidth-host.clientWidth,Math.round(left)))}
    },{number,point})
    assert.ok(Math.abs(actual.scale-scale)<0.0001,JSON.stringify({actual,expectedScale:scale}))
    assert.ok(Math.abs(actual.top-actual.expectedTop)<=2,JSON.stringify(actual))
    assert.ok(Math.abs(actual.left-actual.expectedLeft)<=2,JSON.stringify(actual))
  }
  for(const continuous of [true,false]){
    for(const rotation of [0,90]){
      await test(`FitR rectangle scale and real XY; continuous=${continuous}, rotation=${rotation}`,async()=>{
        await page.evaluate(({continuous,rotation})=>{window.v.view.continuous=continuous;window.v.view.rotation=rotation}, {continuous,rotation})
        // Go through a real rendered annotation link for the initial FitR request.
        await page.evaluate(()=>window.v.jump(1));await flush()
        await page.locator('.pdf-page[aria-label="第 1 页"] .pdf-link-annotation').nth(8).click()
        await flush()
        const size=await page.locator('.pdf-viewport').evaluate(el=>({width:el.clientWidth-48,height:el.clientHeight-48}))
        const scale=Math.max(.05,Math.min(5,rotation===0?Math.min(size.width/328,size.height/200):Math.min(size.width/200,size.height/328)))
        await assertTarget(2,scale,rotation===0?[72*scale,112*scale]:[300*scale,72*scale])
      })
      await test(`FitV height scale and real XY; continuous=${continuous}, rotation=${rotation}`,async()=>{
        await page.evaluate(()=>window.v.handleNavigateDest([1,{name:'FitV'},72]));await flush()
        const size=await page.locator('.pdf-viewport').evaluate(el=>({height:el.clientHeight-48}))
        const scale=Math.max(.05,Math.min(5,size.height/(rotation===0?612:792)))
        await assertTarget(2,scale,rotation===0?[72*scale,0]:[612*scale,0])
        assert.equal(await page.getByRole('combobox',{name:'PDF 缩放比例'}).inputValue(),String((await snapshot()).scale),'FitV displays the actual scale')
      })
    }
  }
  await test('same-page XYZ waits for new zoom bounds and clamps both limits',async()=>{
    await page.evaluate(()=>{window.v.view.rotation=0;window.v.view.continuous=false})
    for(const zoom of [2.3,9999,.0001]){
      const scale=Math.max(.05,Math.min(5,zoom))
      await page.evaluate(zoom=>window.v.handleNavigateDest([1,{name:'XYZ'},300,350,zoom]),zoom);await flush()
      await assertTarget(2,scale,[300*scale,262*scale])
    }
  })
  await test('CropBox origin and intrinsic page rotation use actual target coordinates',async()=>{
    await page.evaluate(()=>window.v.handleNavigateDest([3,{name:'XYZ'},100,800,2]));await flush()
    await assertTarget(4,2,[100,184])
    await page.evaluate(()=>window.v.handleNavigateDest([2,{name:'XYZ'},72,710,2]));await flush()
    await assertTarget(3,2,[1420,144])
  })

  for(const stage of ['destination','page']){
    for(const action of ['jump','rotate','reload','close']){
      await test(`pending ${stage} invalidated by ${action}; no late scroll or zoom`,async()=>{
        await page.evaluate(()=>{window.v.view.rotation=0;window.v.view.continuous=true;window.v.view.fit='manual';window.v.changeScale(1);window.v.jump(1)})
        await flush()
        await page.evaluate(stage=>{
          const v=window.v,doc=v.pdf
          if(stage==='destination'){
            const original=doc.getDestination.bind(doc)
            doc.getDestination=()=>new Promise(resolve=>{window.release=()=>{doc.getDestination=original;resolve([2,{name:'XYZ'},72,710,4])}})
            window.pending=v.handleNavigateDest('delayed')
          }else{
            const original=doc.getPage.bind(doc)
            let held=false
            doc.getPage=number=>{
              if(number!==3||held)return original(number)
              held=true
              return new Promise(resolve=>{original(number).then(real=>{window.release=()=>{doc.getPage=original;resolve(real)}})})
            }
            window.pending=v.handleNavigateDest([2,{name:'XYZ'},72,710,4])
          }
        },stage)
        await page.waitForFunction(()=>window.release)
        if(action==='jump')await page.evaluate(()=>window.v.jump(2))
        if(action==='rotate')await page.evaluate(()=>window.v.rotate())
        if(action==='reload')await page.evaluate(()=>window.v.load())
        if(action==='close')await page.evaluate(()=>window.mediaTest.close())
        await flush()
        const before=action==='close'?null:await snapshot()
        await page.evaluate(async()=>{await window.release();await window.pending;delete window.release})
        await flush()
        if(action==='close'){
          assert.equal(await page.locator('.pdf-viewer').count(),0)
          await open()
        }else assert.deepEqual(await snapshot(),before)
      })
    }
  }
  assert.deepEqual(errors,[])
} finally {
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,errors},null,2))
  await browser?.close();await server.close()
}
