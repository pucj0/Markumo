// Uses the same optional Playwright/Chrome environment variables as media-regression.mjs.
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'

const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const server=await createServer({server:{port:1422,strictPort:true}})
await server.listen()
let browser
try{
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://localhost:1422/scripts/media-harness.html?layout=1')
  await page.waitForFunction(()=>window.mediaTest)
  await page.evaluate(()=>{
    window.markdownNotices=[]
    window.addEventListener('editor-notice',event=>window.markdownNotices.push(event.detail))
    window.mediaTest.manager.createUntitled('md')
  })
  const editor=page.locator('.markdown-live .ProseMirror')
  await editor.waitFor();await editor.click()
  await page.keyboard.insertText('新建 Markdown')
  assert.deepEqual(await page.evaluate(()=>window.markdownNotices),[])
  assert.equal(await page.evaluate(()=>window.mediaTest.manager.getText(window.mediaTest.manager.activeId)),'新建 Markdown')
  await editor.press('Control+z')
  await page.waitForFunction(()=>window.mediaTest.manager.getText(window.mediaTest.manager.activeId)==='')
  await page.keyboard.insertText('Retype after undo')
  assert.equal(await page.evaluate(()=>window.mediaTest.manager.getText(window.mediaTest.manager.activeId)),'Retype after undo')
  await editor.press('Control+a');await editor.press('Backspace')
  await page.waitForFunction(()=>window.mediaTest.manager.getText(window.mediaTest.manager.activeId)==='')
  await page.keyboard.insertText('First paragraph');await editor.press('Enter');await page.keyboard.insertText('Second paragraph')
  assert.equal(await page.evaluate(()=>window.mediaTest.manager.getText(window.mediaTest.manager.activeId)),'First paragraph\n\nSecond paragraph')
  await page.evaluate(()=>{const m=window.mediaTest.manager;m.setMarkdownMode(m.activeId,'source')})
  await page.locator('.cm-content').waitFor()
  assert.match(await page.locator('.cm-content').innerText(),/First paragraph\s+Second paragraph/)
  await page.evaluate(()=>{const m=window.mediaTest.manager;m.setMarkdownMode(m.activeId,'live')})
  await editor.waitFor();assert.match(await editor.innerText(),/First paragraph\s+Second paragraph/)

  // Cover first-block insertion both without a source block and with existing whitespace.
  const bridgeCases=await page.evaluate(async()=>{
    const {MarkdownSourceBridge}=await import('/src/editor/markdown/wysiwyg/MarkdownSourceBridge.ts')
    const {markdownSchema:s}=await import('/src/editor/markdown/wysiwyg/MarkdownSchema.ts')
    const paragraph=text=>s.nodes.paragraph.create(null,text?s.text(text):undefined)
    const empty=new MarkdownSourceBridge(''),blank=empty.prepare(empty.doc)
    blank.commit()
    const heading=empty.prepare(s.nodes.doc.create(null,s.nodes.heading.create({level:1},s.text('Title'))))
    heading.commit()
    const existing=new MarkdownSourceBridge('\n\nExisting\n'),old=existing.doc.firstChild
    const edited=existing.prepare(s.nodes.doc.create(null,old.type.create(old.attrs,s.text('Edited'),old.marks)))
    const inserted=existing.prepare(s.nodes.doc.create(null,[paragraph('Inserted'),old]))
    return {blank:blank.source,heading:heading.source,edited:edited.source,inserted:inserted.source}
  })
  assert.deepEqual(bridgeCases,{blank:'',heading:'# Title',edited:'\n\nEdited\n',inserted:'Inserted\n\nExisting\n'})
  assert.deepEqual(await page.evaluate(()=>window.markdownNotices),[])
  assert.deepEqual(errors,[])
  console.log('PASS: empty Markdown typing, undo/retype, clear/retype, paragraphs, mode switching and source whitespace')
}finally{
  await browser?.close();await server.close()
}
