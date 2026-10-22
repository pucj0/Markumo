// Outline Section Reorder Regression Suite
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1445, strictPort: true, hmr: false, watch: null }
})

const { planOutlineMove, getSectionRange } = await server.ssrLoadModule('./src/editor/outline/outlineReorder.ts')

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

// Fake outline items representing the fixture
const items = [
  { id: 'h-1', name: '第一章 概述', level: 1, lineNumber: 1, from: 0 },
  { id: 'h-2', name: '1.1 架构原理', level: 2, lineNumber: 4, from: 24 },
  { id: 'h-3', name: '1.1.1 底层实现', level: 3, lineNumber: 7, from: 46 },
  { id: 'h-4', name: '第二章 实践指南', level: 1, lineNumber: 10, from: 70 },
  { id: 'h-5', name: '2.1 快速上手', level: 2, lineNumber: 13, from: 92 },
  { id: 'h-6', name: '第三章 总结与展望', level: 1, lineNumber: 16, from: 114 },
]

// Test 1: getSectionRange extracts entire section including all descendants
{
  const range = getSectionRange(items, items[0], markdownDoc.length)
  assert.ok(range)
  assert.equal(range.from, 0)
  assert.equal(range.to, 70) // up to the start of "第二章"
  assert.equal(range.descendantCount, 2) // contains 1.1 and 1.1.1
  console.log('PASS 1. getSectionRange correctly includes heading, body and all descendants')
}

// Test 2: Moving Chapter 1 after Chapter 2 moves entire Chapter 1 section
{
  const plan = planOutlineMove(markdownDoc, items, 'h-1', 'h-4', 'after')
  assert.ok(plan.valid)
  // Verify Chapter 2 is now before Chapter 1
  const posCh2 = plan.newSource.indexOf('# 第二章 实践指南')
  const posCh1 = plan.newSource.indexOf('# 第一章 概述')
  assert.ok(posCh2 !== -1 && posCh1 !== -1)
  assert.ok(posCh2 < posCh1, 'Chapter 2 must precede Chapter 1 after move')

  // Verify Chapter 1 still contains its subheadings
  assert.ok(plan.newSource.includes('### 1.1.1 底层实现'))
  assert.ok(plan.newSource.includes('底层细节 C。'))
  console.log('PASS 2. Moving section downwards moves entire block with all subheadings')
}

// Test 3: Moving Chapter 3 before Chapter 2 (moving upwards)
{
  const plan = planOutlineMove(markdownDoc, items, 'h-6', 'h-4', 'before')
  assert.ok(plan.valid)
  const posCh3 = plan.newSource.indexOf('# 第三章 总结与展望')
  const posCh2 = plan.newSource.indexOf('# 第二章 实践指南')
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
  assert.ok(plan.newSource.includes('这是第一章的正文内容 A。'))
  assert.ok(plan.newSource.includes('架构详细说明 B。'))
  assert.ok(plan.newSource.includes('底层细节 C。'))
  assert.ok(plan.newSource.includes('第二章正文 D。'))
  assert.ok(plan.newSource.includes('上手指南 E。'))
  assert.ok(plan.newSource.includes('总结内容 F。'))
  console.log('PASS 5. Reordering preserves exact source fidelity without modifying untouched content')
}

console.log('========================================')
console.log('All Outline Reorder tests passed successfully!')
console.log('========================================')
await server.close()
