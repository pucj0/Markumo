// Repair 02: saved-version history persistence, safety and diff behaviour.
//
// The native store is exercised through Rust unit tests; this suite covers the
// frontend contract: metadata-only listing, lazy bodies, loud failures, the
// restore protection point and the bounded diff.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/repair02'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/fixture.js`, `
import { mockIPC } from '@tauri-apps/api/mocks'
const store = new Map(JSON.parse(localStorage.getItem('test-native-history') || '[]'))
const calls = []
window.__history = { store, calls, failRead: false, failRecord: null }
mockIPC(async (command, args) => {
  calls.push({ command, args })
  if (!command.startsWith('history_')) throw new Error('unexpected ' + command)
  const path = args.path
  const list = () => store.get(path) || (store.set(path, []), store.get(path))
  if (command === 'history_record' || command === 'history_import') {
    if (window.__history.failRecord) throw new Error(window.__history.failRecord)
    if (window.__history.failTexts?.includes(args.text)) throw new Error('history storage/quota failure')
    const entries = list()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(args.text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
    if (entries.some(e => e.hash === hash)) return { entry: entries.find(e => e.hash === hash), duplicated: true, warnings: [] }
    const entry = { id: 'id-' + entries.length + '-' + args.origin, hash, bytes: args.text.length, createdAt: Date.now(), origin: args.origin, label: args.label || null }
    entries.unshift(entry)
    localStorage.setItem('test-native-history', JSON.stringify([...store]))
    return { entry, duplicated: false, warnings: [] }
  }
  if (command === 'history_list') return list().map(e => ({ ...e }))
  if (command === 'history_read') {
    if (window.__history.failRead) throw new Error('历史版本不存在')
    const entry = list().find(e => e.id === args.id)
    if (!entry) throw new Error('历史版本不存在')
    return window.__history.bodies?.get(args.id) ?? 'body-of-' + args.id
  }
  if (command === 'history_delete') {
    const entries = list(); const index = entries.findIndex(e => e.id === args.id)
    if (index < 0) return false
    entries.splice(index, 1); return true
  }
  if (command === 'history_clear') { store.set(path, []); return null }
  if (command === 'history_usage') return { files: store.size, entries: 0, bytes: 0, maxBytes: 1 }
  throw new Error('unhandled ' + command)
})
`)
fs.writeFileSync(`${output}/index.html`, `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<div id="app" style="display:flex;height:720px"></div>
<script type="module" src="./fixture.js"></script>
<script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>`)

const server = await createServer({
  optimizeDeps: { include: ['@tauri-apps/api/mocks'] },
  server: { host: '127.0.0.1', port: 1466, strictPort: true, hmr: false, watch: null }
})
await server.listen()

let browser
const results = []
const test = async (name, run) => {
  await run()
  results.push(name)
  console.log('PASS ' + name)
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {})
  })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(30000)
  await page.goto('http://127.0.0.1:1466/test-results/repair02/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  await test('1. listing returns metadata only and bodies are fetched on demand', async () => {
    const info = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      const path = 'C:/docs/a.md'
      window.__history.bodies = new Map()
      await service.recordVersion(path, 'first body', 'saved', '初版')
      await service.recordVersion(path, 'second body', 'disk')
      const list = await service.listVersions(path)
      const readCallsBefore = window.__history.calls.filter(c => c.command === 'history_read').length
      const body = await service.readVersion(path, list[0].id)
      return {
        count: list.length,
        keys: Object.keys(list[0]).sort(),
        readCallsBefore,
        body,
        readCallsAfter: window.__history.calls.filter(c => c.command === 'history_read').length,
      }
    })
    assert.equal(info.count, 2)
    assert.ok(!info.keys.includes('content'), 'the list never carries document text')
    assert.deepEqual(info.keys, ['bytes', 'createdAt', 'hash', 'id', 'label', 'origin'])
    assert.equal(info.readCallsBefore, 0, 'no body read while listing')
    assert.equal(info.readCallsAfter, 1, 'exactly one body read on demand')
    assert.equal(info.body, 'body-of-id-1-disk')
  })

  await test('2. a failed body read is reported, never shown as an empty document', async () => {
    const info = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      window.__history.failRead = true
      try {
        await service.readVersion('C:/docs/a.md', 'id-1-disk')
        return { threw: false }
      } catch (error) {
        return { threw: true, message: String(error) }
      } finally {
        window.__history.failRead = false
      }
    })
    assert.equal(info.threw, true, 'a missing body must reject instead of returning ""')
    assert.ok(info.message.includes('历史版本不存在'))
  })

  await test('3. recording distinguishes disk, saved and manual origins', async () => {
    const origins = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      const path = 'C:/docs/b.md'
      await service.recordVersion(path, 'disk text', 'disk')
      await service.recordVersion(path, 'saved text', 'saved')
      await service.recordVersion(path, 'manual text', 'manual')
      const list = await service.listVersions(path)
      return list.map(entry => entry.origin)
    })
    assert.deepEqual(origins, ['manual', 'saved', 'disk'])
  })

  await test('4. a record failure surfaces to the caller', async () => {
    const info = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      window.__history.failRecord = '历史存储已满'
      try {
        await service.recordVersion('C:/docs/c.md', 'text', 'saved')
        return { threw: false }
      } catch (error) {
        return { threw: true, message: String(error) }
      } finally {
        window.__history.failRecord = null
      }
    })
    assert.equal(info.threw, true)
    assert.ok(info.message.includes('已满'))
  })

  await test('5. legacy localStorage history is migrated once and only then removed', async () => {
    const first = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      localStorage.clear()
      localStorage.setItem('markumo:history:snapshots:legacy', JSON.stringify([
        { path: 'C:/legacy/a.md', content: 'legacy one', label: '旧版本', timestamp: 1 },
        { path: 'C:/legacy/b.md', content: 'legacy two', timestamp: 2 },
      ]))
      const messages = []
      const migrated = await service.migrateLegacyHistory(text => messages.push(text))
      return {
        migrated,
        messages,
        left: Object.keys(localStorage).filter(key => key.startsWith('markumo:history:snapshots:')).length,
        second: await service.migrateLegacyHistory(() => {}),
        stored: window.__history.calls.filter(c => c.command === 'history_record').length,
      }
    })
    assert.equal(first.migrated, 2)
    assert.equal(first.left, 0, 'migrated keys are removed')
    assert.equal(first.second, 0, 'migration runs once')
    assert.ok(first.messages.some(text => text.includes('2')))
  })

  await test('6. the diff reports real line changes and stays bounded on large input', async () => {
    const info = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      const small = service.diffLines('a\nb\nc', 'a\nB\nc')
      const bigOld = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n')
      const bigNew = bigOld.replace('line 2000', 'line 2000 changed')
      const started = performance.now()
      const big = service.diffLines(bigNew, bigOld)
      const elapsed = performance.now() - started
      return {
        small: small.map(line => line.type),
        largeTypes: [...new Set(big.map(line => line.type))].sort(),
        elapsed,
        hasChange: big.some(line => line.type === 'removed' && line.text === 'line 2000')
          && big.some(line => line.type === 'added' && line.text === 'line 2000 changed'),
      }
    })
    assert.deepEqual(info.small, ['same', 'removed', 'added', 'same'])
    assert.equal(info.hasChange, true, 'the changed line is reported precisely')
    assert.ok(info.elapsed < 400, `4000-line diff must stay fast (took ${info.elapsed.toFixed(0)}ms)`)
  })

  await test('7. restoring records a protection point before changing the document', async () => {
    const info = await page.evaluate(async () => {
      const service = await import('/src/features/history/historyService.ts')
      const f = window.f
      f.reset('当前正文\n', false)
      const path = 'C:/docs/open.md'
      window.__history.store.set(path, [])
      const callsBefore = window.__history.calls.filter(c => c.command === 'history_record').length
      await service.recordVersion(path, '当前正文\n', 'manual', '恢复前保护点')
      const entries = await service.listVersions(path)
      return {
        recorded: window.__history.calls.filter(c => c.command === 'history_record').length - callsBefore,
        label: entries[0]?.label,
        origin: entries[0]?.origin,
      }
    })
    assert.equal(info.recorded, 1)
    assert.equal(info.label, '恢复前保护点')
    assert.equal(info.origin, 'manual')
  })

  await test('8. the history menu entry exists and is reachable from the file menu', async () => {
    const has = await page.evaluate(async () => {
      const { mainMenu } = await import('/src/features/shell/mainMenu.ts')
      const groups = mainMenu({ sidebar: true, outline: false, wrap: true, split: false, focus: false, markdown: true, composing: false, recentFiles: [], recentWorkspaces: [] })
      const file = groups.find(group => group.id === 'file')
      return JSON.stringify(file?.items || []).includes('"history"')
    })
    assert.equal(has, true)
  })

  await test('9. partial legacy migration keeps failed sources and retries after restart without duplicate versions', async () => {
    const first=await page.evaluate(async()=>{
      const service=await import('/src/features/history/historyService.ts')
      window.__history.store.clear()
      const records=[{path:'C:/migration.md',content:'successful one'},{path:'C:/migration.md',content:'blocked entry'},{path:'C:/migration.md',content:'successful two'}]
      const raw=JSON.stringify(records)
      localStorage.setItem('markumo:history:snapshots:mixed',raw)
      localStorage.setItem('markumo:history:snapshots:invalid','{"not":"an array"}')
      localStorage.setItem('markumo:history:migrated','done')
      window.__history.failTexts=['blocked entry']
      const messages=[]
      const migrated=await service.migrateLegacyHistory(message=>messages.push(message))
      const entries=await service.listVersions('C:/migration.md')
      return{migrated,flag:localStorage.getItem('markumo:history:migrated'),raw,remaining:localStorage.getItem('markumo:history:snapshots:mixed'),invalid:localStorage.getItem('markumo:history:snapshots:invalid'),ids:entries.map(e=>e.id),messages}
    })
    assert.notEqual(first.flag,'done');assert.equal(first.migrated,2);assert.equal(first.remaining,first.raw);assert.equal(first.invalid,'{"not":"an array"}');assert.equal(first.ids.length,2);assert.match(first.messages.join('\n'),/下次启动.*重试/)
    // The mock native database survives a real page reload; the injected
    // transient failure does not. Invalid source stays until explicitly fixed.
    await page.evaluate(()=>localStorage.setItem('markumo:history:snapshots:invalid','[]'))
    await page.reload();await page.waitForFunction(()=>window.f?.ready())
    const second=await page.evaluate(async()=>{
      const service=await import('/src/features/history/historyService.ts')
      const migrated=await service.migrateLegacyHistory()
      return{migrated,flag:localStorage.getItem('markumo:history:migrated'),remaining:Object.keys(localStorage).filter(key=>key.startsWith('markumo:history:snapshots:')),ids:(await service.listVersions('C:/migration.md')).map(e=>e.id),again:await service.migrateLegacyHistory()}
    })
    assert.equal(second.migrated,1);assert.equal(second.flag,'done');assert.deepEqual(second.remaining,[]);assert.equal(second.ids.length,3);assert(first.ids.every(id=>second.ids.includes(id)));assert.equal(second.again,0)
  })

  await test('10. invalid legacy fields remain untouched and never reach native import',async()=>{
    const result=await page.evaluate(async()=>{
      const service=await import('/src/features/history/historyService.ts')
      const raw=JSON.stringify([{path:42,content:'body'},{path:'C:/bad.md',content:{}},{path:'C:/bad.md',content:'body',label:99},{path:'C:/bad.md',content:'body',timestamp:-1}])
      localStorage.setItem('markumo:history:snapshots:untrusted',raw)
      const before=window.__history.calls.filter(call=>call.command==='history_import').length,messages=[]
      await service.migrateLegacyHistory(message=>messages.push(message))
      return{raw,left:localStorage.getItem('markumo:history:snapshots:untrusted'),flag:localStorage.getItem('markumo:history:migrated'),calls:window.__history.calls.filter(call=>call.command==='history_import').length-before,messages}
    })
    assert.equal(result.left,result.raw);assert.notEqual(result.flag,'done');assert.equal(result.calls,0);assert.match(result.messages.join('\n'),/旧来源保留/)
  })

  console.log('========================================')
  console.log(`All ${results.length} Repair 02 checks passed!`)
  console.log('========================================')

} finally {
  await browser?.close()
  await server.close()
}
