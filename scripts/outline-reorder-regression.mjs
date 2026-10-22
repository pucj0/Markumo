// Outline Section Reorder Regression Suite
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import fs from 'node:fs'
import { chromium } from 'playwright'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1445, strictPort: true, hmr: false, watch: null }
})

const { planOutlineMove, getSectionRange, applyOutlineMove } = await server.ssrLoadModule('./src/editor/outline/outlineReorder.ts')

console.log('--- Running Outline Reorder Unit & Algorithm Tests ---')

// Fixture document
const markdownDoc = [
  '# 第一章 概述',
  '这是第一章的正文内容 A。',
  '',
  '## 1.1 架构原理',
  '架构详细说明 B。',
  '',
  '### 1.1.1 底层实现',
  '底层细节 C。',
  '',
  '# 第二章 实践指南',
  '第二章正文 D。',
  '',
  '## 2.1 快速上手',
  '上手指南 E。',
  '',
  '# 第三章 总结与展望',
  '总结内容 F。',
  ''
].join('\n')

// Positions from the actual Markumo Markdown parser, never handwritten offsets.
const { parseMarkdown } = await server.ssrLoadModule('./src/editor/markdown/wysiwyg/MarkdownParser.ts')
const items = parseMarkdown(markdownDoc).blocks.filter(block => block.node.type.name === 'heading').map((block, index) => ({
  id: 'h-' + (index + 1), name: block.node.textContent, level: block.node.attrs.level,
  from: block.from, lineNumber: markdownDoc.slice(0, block.from).split('\n').length,
}))
// Test 1: getSectionRange extracts entire section including all descendants
{
  const range = getSectionRange(items, items[0], markdownDoc.length)
  assert.ok(range)
  assert.equal(range.from, 0)
  assert.equal(range.to, items[3].from) // up to the start of "第二章"
  assert.equal(range.descendantCount, 2) // contains 1.1 and 1.1.1
  console.log('PASS 1. getSectionRange correctly includes heading, body and all descendants')
}

// Test 2: Moving Chapter 1 after Chapter 2 moves entire Chapter 1 section
{
  const plan = planOutlineMove(markdownDoc, items, 'h-1', 'h-4', 'after')
  assert.ok(plan.valid)
  // Verify Chapter 2 is now before Chapter 1
  const posCh2 = applyOutlineMove(markdownDoc, plan).indexOf('# 第二章 实践指南')
  const posCh1 = applyOutlineMove(markdownDoc, plan).indexOf('# 第一章 概述')
  assert.ok(posCh2 !== -1 && posCh1 !== -1)
  assert.ok(posCh2 < posCh1, 'Chapter 2 must precede Chapter 1 after move')

  // Verify Chapter 1 still contains its subheadings
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('### 1.1.1 底层实现'))
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('底层细节 C。'))
  console.log('PASS 2. Moving section downwards moves entire block with all subheadings')
}

// Test 3: Moving Chapter 3 before Chapter 2 (moving upwards)
{
  const plan = planOutlineMove(markdownDoc, items, 'h-6', 'h-4', 'before')
  assert.ok(plan.valid)
  const posCh3 = applyOutlineMove(markdownDoc, plan).indexOf('# 第三章 总结与展望')
  const posCh2 = applyOutlineMove(markdownDoc, plan).indexOf('# 第二章 实践指南')
  assert.ok(posCh3 < posCh2, 'Chapter 3 must precede Chapter 2 after moving before')
  console.log('PASS 3. Moving section upwards places section right before target')
}

// Test 4: Dragging section into itself or its own descendants is strictly forbidden
{
  const selfPlan = planOutlineMove(markdownDoc, items, 'h-1', 'h-1', 'after')
  assert.equal(selfPlan.valid, false)

  const childPlan = planOutlineMove(markdownDoc, items, 'h-1', 'h-2', 'after')
  assert.equal(childPlan.valid, false)
  assert.ok(childPlan.error?.includes('子章节'))
  console.log('PASS 4. Dragging into itself or descendants rejected with safe error')
}

// Test 5: Reordering preserves Markdown source fidelity
{
  const plan = planOutlineMove(markdownDoc, items, 'h-1', 'h-4', 'after')
  assert.ok(plan.valid)
  // Verify all sections and texts are completely preserved
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('这是第一章的正文内容 A。'))
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('架构详细说明 B。'))
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('底层细节 C。'))
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('第二章正文 D。'))
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('上手指南 E。'))
  assert.ok(applyOutlineMove(markdownDoc, plan).includes('总结内容 F。'))
  console.log('PASS 5. Reordering preserves exact source fidelity without modifying untouched content')
}

console.log('========================================')
console.log('All Outline Reorder tests passed successfully!')
console.log('========================================')
await server.listen()
const output = 'test-results/outline-move'
fs.mkdirSync(output, {recursive:true})
fs.writeFileSync(`${output}/index.html`, `<!doctype html><div id="app" style="height:650px;display:flex"></div><div id="outline"></div><script type="module">
import '/scripts/fixtures/markdown-live-controller.js';
import {createApp,h,ref,onUnmounted} from 'vue';
import OutlineView from '/src/components/layout/OutlineView.vue';
import {extractOutline} from '/src/editor/outline/outlineService.ts';
window.outlineTools={createApp,h,ref,onUnmounted,OutlineView,extractOutline};</script>`)
let browser
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:1445/${output}/index.html`)
  await page.waitForFunction(() => window.f?.ready()&&window.outlineTools)
  await page.evaluate(async () => {
    const {createApp,h,ref,onUnmounted,OutlineView,extractOutline} = window.outlineTools
    let app
    window.mountOutline = () => {
      app?.unmount()
      const f=window.f, revision=ref(0)
      app=createApp({setup(){const unsubscribe=f.manager.subscribe(()=>revision.value++);onUnmounted(unsubscribe);return()=>{
        revision.value
        return h(OutlineView,{items:extractOutline(f.manager.metadata(f.id),f.manager.getState(f.id)),isMarkdown:true,manager:f.manager,documentId:f.id})
      }}})
      app.mount('#outline')
    }
    window.unmountOutline=()=>app?.unmount()
  })
  for (const mode of ['live','source','split']) for (const final of ['', '\n']) {
    const before='# A\n正文A\n\n# B\n正文B'+final, after='# B\n正文B\n\n# A\n正文A'+final
    await page.evaluate(({before,mode})=>{window.unmountOutline();window.f.reset(before,true);window.f.manager.setMarkdownMode(window.f.id,mode,'main');window.f.split();window.mountOutline()},{before,mode})
    await page.waitForFunction(()=>window.f.ready()&&document.querySelectorAll('.outline-item').length===2)
    const transfer=await page.evaluateHandle(()=>new DataTransfer())
    const rows=page.locator('.outline-item'), rect=await rows.first().boundingBox()
    await rows.nth(1).dispatchEvent('dragstart',{dataTransfer:transfer})
    await rows.first().dispatchEvent('dragover',{dataTransfer:transfer,clientY:rect.y+1})
    await rows.first().dispatchEvent('drop',{dataTransfer:transfer,clientY:rect.y+1})
    await page.waitForFunction(text=>window.f.ready()&&window.f.source()===text,after)
    assert.equal(await page.evaluate(()=>window.f.source()),after)
    assert.equal(await page.evaluate(()=>window.f.history().undo),1)
    await page.evaluate(()=>window.f.undo())
    await page.waitForFunction(text=>window.f.ready()&&window.f.source()===text,before)
    await page.evaluate(()=>window.f.redo())
    await page.waitForFunction(text=>window.f.ready()&&window.f.source()===text,after)
    console.log(`PASS actual OutlineView drag, two panes, ${mode}, EOF=${JSON.stringify(final)}, single Undo/Redo`)
    await transfer.dispose()
  }
  await page.evaluate(()=>{window.unmountOutline();window.f.dispose()})
} finally {await browser?.close();await server.close()}
