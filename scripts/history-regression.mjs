// Document Version History Regression Suite
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1447, strictPort: true, hmr: false, watch: null }
})

const { HistoryService } = await server.ssrLoadModule('./src/features/history/historyService.ts')

console.log('--- Running Document Version History Regression Suite ---')

const history = new HistoryService()
const filePath = 'C:/test/sample.md'

// Clean state
await history.clearSnapshots(filePath)

// Test 1: Record first snapshot
{
  const snap1 = await history.recordSnapshot(filePath, '# 第一版内容\n初稿。', '初始保存')
  assert.ok(snap1)
  assert.equal(snap1.path, filePath)
  assert.equal(snap1.label, '初始保存')
  const list = await history.getSnapshots(filePath)
  assert.equal(list.length, 1)
  assert.equal(list[0].content, '# 第一版内容\n初稿。')
  console.log('PASS 1. Record snapshot creates valid history entry')
}

// Test 2: Identical content deduplication: no duplicate snapshot created
{
  const duplicate = await history.recordSnapshot(filePath, '# 第一版内容\n初稿。', '重复保存')
  assert.equal(duplicate, null, 'Identical content must be deduplicated')
  const list = await history.getSnapshots(filePath)
  assert.equal(list.length, 1)
  console.log('PASS 2. Content deduplication prevents redundant snapshots')
}

// Test 3: Multiple saves create sequential history chain
{
  const snap2 = await history.recordSnapshot(filePath, '# 第二版内容\n新增章节。', '第二版')
  const snap3 = await history.recordSnapshot(filePath, '# 第三版内容\n最终定稿。', '第三版')
  assert.ok(snap2 && snap3)

  const list = await history.getSnapshots(filePath)
  assert.equal(list.length, 3)
  assert.equal(list[0].label, '第三版')
  assert.equal(list[1].label, '第二版')
  assert.equal(list[2].label, '初始保存')
  console.log('PASS 3. Multiple sequential saves recorded in reverse chronological order')
}

// Test 4: Diff calculation between current and historical content
{
  const current = '# 第三版内容\n新增一行文字。\n最终定稿。'
  const old = '# 第一版内容\n初稿。'
  const diff = history.computeDiff(current, old)
  assert.ok(diff.length > 0)
  assert.ok(diff.some(d => d.type === 'removed'))
  assert.ok(diff.some(d => d.type === 'added'))
  console.log('PASS 4. Line-level diff computation accurately detects additions and removals')
}

// Test 5: Delete specific snapshot
{
  const listBefore = await history.getSnapshots(filePath)
  const targetId = listBefore[1].id
  const deleted = await history.deleteSnapshot(filePath, targetId)
  assert.equal(deleted, true)

  const listAfter = await history.getSnapshots(filePath)
  assert.equal(listAfter.length, 2)
  assert.ok(!listAfter.some(s => s.id === targetId))
  console.log('PASS 5. Delete specific snapshot removes targeted record')
}

// Test 6: Clear all snapshots
{
  await history.clearSnapshots(filePath)
  const emptyList = await history.getSnapshots(filePath)
  assert.equal(emptyList.length, 0)
  console.log('PASS 6. Clear snapshots empties history records cleanly')
}

console.log('========================================')
console.log('All Version History tests passed successfully!')
console.log('========================================')
await server.close()
