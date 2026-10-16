import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium,browserOptions} from './helpers/markdown-browser.mjs'
const output='test-results/typora-observed-2026-10-16',markdown=await readFile('tests/fixtures/typora-parity.md','utf8')
await mkdir(output,{recursive:true})
const module=`visual-fixture-${Date.now()}.ts`
await writeFile(`${output}/lightedit.html`,`<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column;padding-top:16px"></div><script type="module" src="./${module}"></script></body></html>`)
await writeFile(`${output}/${module}`,`
import {createApp,h,ref} from 'vue';import {DocumentManager} from '/src/editor/core/DocumentManager.ts';import EditorContainer from '/src/components/layout/EditorContainer.vue';import '/src/styles/reset.css';import '/src/styles/variables.css';
const m=new DocumentManager([{id:'md',name:'typora-parity.md',path:'typora-parity.md',text:${JSON.stringify(markdown)}}]);m.open('md',false);const rev=ref(0);m.subscribe(()=>rev.value++);document.body.classList.add('light');window.fixture={manager:m,live:()=>m.liveViews.get('main')?.editor};createApp({render(){rev.value;return h(EditorContainer,{doc:m.activeDocument,manager:m,showOutline:false,desktop:false})}}).mount('#app');`)
const browser=await chromium.launch(browserOptions),page=await browser.newPage({viewport:{width:786,height:694},deviceScaleFactor:1}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const observations={viewport:{width:786,height:694},zoom:1,theme:'Markumo light / Typora Github',strictVisualParity:'UNVERIFIED',reason:'Both use 16px, 1.6, 860px page limit and actual-size zoom; Typora bundles Open Sans while LightEdit uses system fonts. Header origin is aligned with a documented 16px fixture spacer. Theme/font equality is not established.',elements:{}}
try{
 await page.goto(`${process.env.LIGHTEDIT_TEST_URL}/${output}/lightedit.html`);await page.locator('.md-prose').waitFor();await page.locator('.md-diagram svg').waitFor();await page.evaluate(()=>document.fonts.ready)
 await page.screenshot({path:`${output}/lightedit-page-top.png`})
 for(const [name,selector] of Object.entries({heading:'.md-prose h1',paragraph:'.md-prose > p',list:'.md-task',table:'.md-prose table',code:'.md-code-block',image:'.md-live-image',link:'.md-prose a',math:'.md-math-output',mermaid:'.md-diagram svg'})){
  const el=page.locator(selector).first();await el.scrollIntoViewIfNeeded();observations.elements[name]=await el.evaluate(el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {width:r.width,height:r.height,fontSize:c.fontSize,fontFamily:c.fontFamily,lineHeight:c.lineHeight,contentWidth:el.closest('.md-prose').getBoundingClientRect().width}});await page.screenshot({path:`${output}/lightedit-${name}.png`})
 }
 assert.equal(await page.evaluate(()=>window.fixture.manager.getText('md')),markdown.replace(/\r\n/g,'\n'));assert.deepEqual(errors,[])
 await writeFile(`${output}/visual-comparison.json`,JSON.stringify({...observations,errors},null,2))
 console.log('PASS visual evidence: real 786x694 screenshots for nine regions, no source mutation; strict theme/font parity UNVERIFIED')
}finally{await browser.close()}
