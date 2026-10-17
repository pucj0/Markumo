import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const server=await createServer({server:{port:1425,strictPort:true}});await server.listen()
let browser
try{
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage({viewport:{width:1200,height:700}}),errors=[],requests=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://example.invalid/**',route=>{requests.push(route.request().url());return route.abort()})
  await page.goto('http://localhost:1425/scripts/outline-harness.html')
  await page.waitForFunction(()=>document.querySelectorAll('.outline-label strong').length===2,null,{timeout:15000}).catch(async error=>{console.error(errors,await page.locator('body').innerText());throw error})
  const left=page.locator('.test-sidebar'),right=page.locator('.outline-sidebar')
  assert.equal(await right.locator('.outline-head span').innerText(),'大纲')
  assert.equal(await page.locator('.heading-prefix').count(),0)
  assert.equal(await page.locator('.outline-label a,.outline-label img,.outline-label script').count(),0)
  assert.equal(await left.locator('.outline-label code').innerText(),'code')
  assert.equal(await left.locator('.outline-label strong').innerText(),'一级标题')
  assert.equal(await left.locator('.outline-label').nth(2).innerText(),'链接')
  await left.getByLabel('折叠标题').first().click();assert.equal(await left.locator('.outline-item').count(),3)
  assert.equal(await right.locator('.outline-item').count(),5)
  await left.getByLabel('展开标题').first().click();assert.equal(await left.locator('.outline-item').count(),5)
  await right.locator('.outline-label').nth(1).click()
  assert.equal(await page.evaluate(()=>window.outlineTest.manager.activeDocument.line),3)
  assert.equal(await page.evaluate(()=>!!window.outlineXss),false)
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[])
  await page.evaluate(()=>document.body.classList.add('light'))
  fs.mkdirSync('.markumo-media-test',{recursive:true});await page.screenshot({path:'.markumo-media-test/outline-rendered.png'})
  console.log('PASS: shared sidebar/right outline rendering, Chinese title, inline formatting, folding, navigation and blocked active content')
}finally{await browser?.close();await server.close()}
