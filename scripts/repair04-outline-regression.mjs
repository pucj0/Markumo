// Repair 04: outline move source fidelity.
//
// Compares the moved section's own source and every untouched byte rather than
// checking a few keywords.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1468, strictPort: true, hmr: false, watch: null }
})
const { planOutlineMove, applyOutlineMove, getSectionRange } = await server.ssrLoadModule('./src/editor/outline/outlineReorder.ts')
const { parseMarkdown } = await server.ssrLoadModule('./src/editor/markdown/wysiwyg/MarkdownParser.ts')

const results = []
const test = async (name, run) => {
  await run()
  results.push(name)
  console.log('PASS ' + name)
}

/** Use the production outline's Markdown parser and its line maps. */
function outlineOf(source) {
  return parseMarkdown(source).blocks.filter(block => block.node.type.name === 'heading').map(block => ({
    id: `h-${block.from}`, name: block.node.textContent, level: block.node.attrs.level, from: block.from,
    lineNumber: source.slice(0, block.from).split('\n').length,
  }))
}

const document = [
  '# 第一章',
  '正文 A。',
  '',
  '## 1.1',
  '正文 B。',
  '',
  '### 1.1.1',
  '```js',
  '# 这不是标题',
  '```',
  '',
  '# 第二章',
  '正文 C。',
  '',
  '## 2.1',
  '正文 D。',
  '',
  '# 第三章',
  '正文 E。',
].join('\n')

await test('0. EOF section moves preserve complete LF/CRLF source, paragraph boundaries and final-newline state', async () => {
  for (const eol of ['\n', '\r\n']) for (const final of ['', eol]) {
    const source = ['# A', '正文A', '', '# B', '正文B'].join(eol) + final
    const expected = ['# B', '正文B', '', '# A', '正文A'].join(eol) + final
    const items = outlineOf(source)
    for (const [from, to, side] of [[1, 0, 'before'], [0, 1, 'after']]) {
      const plan = planOutlineMove(source, items, items[from].id, items[to].id, side)
      assert.equal(plan.valid, true)
      assert.equal(applyOutlineMove(source, plan), expected)
      assert.equal(plan.changes.length, 2)
      assert.deepEqual(outlineOf(expected).map(item => item.name), ['B', 'A'])
    }
  }
})

await test('1. moving a section carries its body and all descendants byte for byte', async () => {
  const items = outlineOf(document)
  const plan = planOutlineMove(document, items, items[0].id, items[3].id, 'after')
  assert.equal(plan.valid, true, plan.error)
  const moved = applyOutlineMove(document, plan)
  const range = getSectionRange(items, items[0], document.length)
  const section = document.slice(range.from, range.to)

  // 1. The section reappears verbatim (body, descendants and fenced code).
  assert.ok(moved.includes(section), 'the whole first chapter moved verbatim')
  assert.ok(section.includes('### 1.1.1') && section.includes('```js\n# 这不是标题\n```'))
  // 2. Order changed: chapter two now comes first.
  assert.ok(moved.indexOf('# 第二章') < moved.indexOf('# 第一章'))
  // 3. Nothing was lost or duplicated: same length, same multiset of lines.
  assert.equal(moved.length, document.length)
  assert.deepEqual(moved.split('\n').sort(), document.split('\n').sort())
  // 4. Unrelated sections keep their exact text and relative order.
  const unrelated = document.slice(document.indexOf('# 第二章'))
  for (const piece of ['# 第二章\n正文 C。', '## 2.1\n正文 D。', '# 第三章\n正文 E。']) {
    assert.ok(unrelated.includes(piece))
    assert.ok(moved.includes(piece), `untouched section text kept: ${piece.split('\n')[0]}`)
  }
  assert.ok(moved.endsWith('# 第三章\n正文 E。'), 'the document still ends where it did')
})

await test('2. only a minimal delete/insert pair is produced', async () => {
  const items = outlineOf(document)
  const plan = planOutlineMove(document, items, items[0].id, items[3].id, 'after')
  assert.equal(plan.changes.length, 2)
  for (const change of plan.changes) {
    assert.ok(change.from >= 0 && change.to >= change.from)
    // No change may rewrite the whole document.
    assert.ok(change.to - change.from < document.length, 'a change must be a slice, not a rewrite')
  }
})

await test('3. a file without a trailing newline keeps that property', async () => {
  const source = '# A\nbody a\n\n# B\nbody b'
  const items = outlineOf(source)
  const plan = planOutlineMove(source, items, items[0].id, items[1].id, 'after')
  const moved = applyOutlineMove(source, plan)
  assert.equal(moved.endsWith('\n'), false, 'no newline is invented')
  assert.equal(moved, '# B\nbody b\n\n# A\nbody a')
})

await test('4. a file that ends with a newline keeps exactly one', async () => {
  const source = '# A\nbody a\n\n# B\nbody b\n'
  const items = outlineOf(source)
  const moved = applyOutlineMove(source, planOutlineMove(source, items, items[0].id, items[1].id, 'after'))
  assert.equal(moved, '# B\nbody b\n\n# A\nbody a\n')
  assert.ok(!moved.endsWith('\n\n'), 'no extra blank line is added')
})

await test('5. CRLF files stay CRLF and are not normalised', async () => {
  const source = '# A\r\nbody a\r\n\r\n# B\r\nbody b\r\n'
  const items = outlineOf(source)
  const moved = applyOutlineMove(source, planOutlineMove(source, items, items[0].id, items[1].id, 'after'))
  assert.equal(moved, '# B\r\nbody b\r\n\r\n# A\r\nbody a\r\n')
  assert.ok(!/[^\r]\n/.test(moved), 'no lone LF appears')
})

await test('6. a code fence containing # is never treated as a heading', async () => {
  const items = outlineOf(document)
  const ids = items.map(item => item.name)
  assert.ok(!ids.includes('这不是标题'), 'the fenced line is not a heading')
  const plan = planOutlineMove(document, items, items[0].id, items[3].id, 'after')
  const moved = applyOutlineMove(document, plan)
  assert.ok(moved.includes('```js\n# 这不是标题\n```'), 'the fence travels with its section')
})

await test('7. front matter and other untouched source are preserved exactly', async () => {
  const source = '---\ntitle: 保留\n---\n\n# A\ntext a\n\n# B\ntext b\n'
  const items = outlineOf(source)
  const moved = applyOutlineMove(source, planOutlineMove(source, items, items[0].id, items[1].id, 'after'))
  assert.ok(moved.startsWith('---\ntitle: 保留\n---\n\n'), 'front matter stays at the top')
  assert.equal(moved, '---\ntitle: 保留\n---\n\n# B\ntext b\n\n# A\ntext a\n')
})

await test('8. moving into itself or a child section is refused', async () => {
  const items = outlineOf(document)
  assert.equal(planOutlineMove(document, items, items[0].id, items[0].id, 'after').valid, false)
  const intoChild = planOutlineMove(document, items, items[0].id, items[2].id, 'after')
  assert.equal(intoChild.valid, false)
  assert.ok(intoChild.error.includes('子章节'))
})

await test('9. duplicate heading names still move the right section', async () => {
  const source = '# Same\nfirst\n\n# Other\nsecond\n\n# Same\nthird\n'
  const items = outlineOf(source)
  assert.equal(items.length, 3)
  const second = applyOutlineMove(source, planOutlineMove(source, items, items[2].id, items[1].id, 'before'))
  assert.equal(second, '# Same\nfirst\n\n# Same\nthird\n\n# Other\nsecond\n')
})

await test('10. section ranges come from parsed positions and cover descendants', async () => {
  const items = outlineOf(document)
  const range = getSectionRange(items, items[0], document.length)
  assert.ok(range)
  assert.equal(range.descendantCount, 2)
  assert.equal(document.slice(range.from, range.to), document.slice(0, document.indexOf('# 第二章')))
})

await test('11. items without parsed positions are rejected instead of guessed', async () => {
  const items = [{ id: 'a', name: 'A', level: 1, lineNumber: 1 }, { id: 'b', name: 'B', level: 1, lineNumber: 2 }]
  const plan = planOutlineMove('# A\n# B\n', items, 'a', 'b', 'after')
  assert.equal(plan.valid, false)
})

await server.close()
console.log('========================================')
console.log(`All ${results.length} outline fidelity checks passed!`)
console.log('========================================')
