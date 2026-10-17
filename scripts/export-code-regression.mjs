import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const server=await createServer({server:{port:1424,strictPort:true}});await server.listen()
let browser
try{
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage()
  console.log('Loading the export renderer')
  await page.goto('http://localhost:1424/scripts/media-harness.html')
  const html=await page.evaluate(async()=>{
    const {renderMarkdownForExport}=await import('/src/features/document-conversion/ExportRenderer.ts')
    const {buildCompleteHtml}=await import('/src/features/document-conversion/ExportStyles.ts')
    const {exportAppearance}=await import('/src/features/document-conversion/ExportAppearance.ts')
    const code=Array.from({length:1005},(_,i)=>i===114?'优先选择真实的工程配置 / 构建 / 启动问题。'.repeat(8):`code line ${i+1}`).join('\n')
    const rendered=await renderMarkdownForExport('```text\n'+code+'\n```',undefined,false,true)
    const appearance=exportAppearance();Object.assign(appearance.colors,{ink:'#333',editor:'#fff',muted:'#777','md-code-bg':'#f8f8f8',line:'#dfe2e5'})
    return buildCompleteHtml('Code line-number regression',rendered.bodyHtml,true,{paperSize:'A4',orientation:'portrait',margins:'default',printBackground:true,codeWrap:true},appearance)
  })
  console.log('Measuring 1005 code lines')
  await page.setContent(html);await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready)
  const metrics=await page.evaluate(()=>{
    const measure=document.createElement('canvas').getContext('2d'),rows=[1,12,99,100,115,999,1000,1005].map(n=>{
      const number=document.querySelector(`[data-line="${n}"]`),style=getComputedStyle(number),text=number.nextElementSibling
      measure.font=`${style.fontSize} ${style.fontFamily}`
      return {number:n,available:number.getBoundingClientRect().width-parseFloat(style.paddingRight)-parseFloat(style.paddingLeft),needed:measure.measureText(String(n)).width,whiteSpace:style.whiteSpace,wordBreak:style.wordBreak,left:text.getBoundingClientRect().left}
    })
    return {rows,lines:document.querySelectorAll('.markumo-code-line').length,codeText:document.querySelector('pre code').textContent}
  })
  fs.mkdirSync('.markumo-media-test',{recursive:true})
  const output=path.resolve('.markumo-media-test',process.argv[2]||'export-code-after.pdf')
  // Print an excerpt around digit boundaries, keeping the real block's gutter
  // sizing. Full 1005-line DOM metrics above cover every line-number width.
  await page.locator('.markumo-code-line').evaluateAll(rows=>rows.forEach((row,i)=>{if(![0,1,11,98,99,113,114,115,998,999,1000,1004].includes(i))row.remove()}))
  console.log('Printing the code excerpt')
  await page.pdf({path:output,printBackground:true,preferCSSPageSize:true})
  await page.locator('[data-line="115"]').evaluate(el=>el.scrollIntoView({block:'center'}))
  await page.screenshot({path:output.replace(/\.pdf$/,'.png')})
  assert.equal(metrics.lines,1005)
  for(const row of metrics.rows){assert(row.available+.5>=row.needed,`Line ${row.number}: ${row.available.toFixed(2)}px available, ${row.needed.toFixed(2)}px needed`);assert.equal(row.whiteSpace,'nowrap');assert.equal(row.wordBreak,'normal')}
  assert(metrics.rows.every(row=>Math.abs(row.left-metrics.rows[0].left)<.5),'Code columns shift when line numbers gain digits')
  assert.match(metrics.codeText,/code line 1005/)
  console.log('PASS: four-digit gutter widths, unbroken numbers, aligned code columns and long-line PDF export')
  console.log(output)
}finally{await browser?.close();await server.close()}
