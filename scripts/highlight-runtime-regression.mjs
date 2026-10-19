// Exercise the actual app and UI, including concurrent Vite dependency caches.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'

const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const output='test-results/highlight-runtime'
fs.mkdirSync(output,{recursive:true})
let first,second,browser
const errors=[],results=[]
try {
  first=await createServer({server:{host:'127.0.0.1',port:1451,strictPort:true,hmr:false,watch:null}})
  await first.listen()
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  async function app(port){
    const page=await browser.newPage({viewport:{width:1200,height:850}})
    page.on('pageerror',error=>errors.push(error.message))
    await page.addInitScript(()=>localStorage.setItem('markumo.settings.v1',JSON.stringify({syntaxStyle:'fleet',bracketMode:'rainbow',settingsVersion:5})))
    await page.goto(`http://127.0.0.1:${port}`)
    await page.keyboard.press('Control+n')
    await page.waitForSelector('.cm-content')
    assert.equal(await page.evaluate(()=>document.body.dataset.syntaxStyle),'soft')
    return page
  }
  async function code(page,language,source){
    await page.locator('.cm-content').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText(source)
    await page.getByRole('combobox',{name:'语言模式',exact:true}).selectOption(language)
    await page.waitForFunction(()=>document.querySelectorAll('.cm-content [class*=mk-syntax-]').length>=3)
    await page.waitForFunction(()=>document.querySelectorAll('.cm-content [class*=mk-bracket-]').length>=2)
    assert.equal(await page.locator('.language-message').count(),0,language)
    const colors=await page.locator('.cm-content [class*=mk-syntax-]').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).color))])
    assert.ok(colors.length>=3,language+' has no visible syntax colors')
    results.push({language,colors})
  }
  const desktop=await app(1451)
  await code(desktop,'JavaScript','const items = [call({name: "Markumo", count: 42})];')
  second=await createServer({optimizeDeps:{include:['@codemirror/legacy-modes/mode/pug']},server:{host:'127.0.0.1',port:1452,strictPort:true,hmr:false,watch:null}})
  await second.listen()
  assert.notEqual(path.resolve(first.config.cacheDir),path.resolve(second.config.cacheDir),'Vite servers share an optimized dependency cache')
  const regression=await app(1452)
  await code(regression,'Python','def greet(name):\n    return {"name": name, "items": [42]}')
  await code(desktop,'Java','class Reader { int size() { return call(new int[]{1, 2}); } }')
  await code(desktop,'TypeScript','interface Theme { items: number[] }\nconst theme: Theme = {items: [1, 2]};')
  await code(desktop,'SQL',"SELECT COALESCE((age + 1), 2) FROM users WHERE name = 'Markumo';")
  await desktop.screenshot({path:`${output}/after-concurrent-server.png`})
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:true,caches:[first.config.cacheDir,second.config.cacheDir],results,errors},null,2))
  console.log('PASS actual app syntax colors, legacy preference migration and language switching across concurrent Vite servers with isolated caches')
}finally{
  await browser?.close()
  await second?.close()
  await first?.close()
}
