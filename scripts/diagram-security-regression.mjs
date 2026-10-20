// Actual app renderer, bounded independent browser for public DoS regression.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const out = 'test-results/phase07/diagram-security'
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(`${out}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="diagram"></div><script type="module">import {renderDiagram} from "/src/editor/markdown/wysiwyg/renderers.ts";import {renderMarkdownForExport} from "/src/features/document-conversion/ExportRenderer.ts";window.diagram=renderDiagram;window.exportDiagram=renderMarkdownForExport;</script>')
const server = await createServer({ server: { host: '127.0.0.1', port: 1493, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser, timer
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME,
    args: ['--js-flags=--max-old-space-size=128'] })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:1493/${out}/index.html`)
  await page.waitForFunction(() => !!window.diagram)
  const render = source => page.evaluate(async source => {
    const host = document.querySelector('#diagram'), start = performance.now()
    try { await window.diagram(host, source); return { elapsed: performance.now() - start, svg: !!host.querySelector('svg'), error: null } }
    catch (error) { return { elapsed: performance.now() - start, svg: false, error: String(error) } }
  }, source)
  const bounded = async (source, limit) => {
    try { return await Promise.race([render(source), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Diagram blocked the real renderer beyond its watchdog')), limit) })]) }
    finally { clearTimeout(timer) }
  }
  // Warm dynamic loading with a well-spaced numeric domain. All warm-ups are
  // bounded too: old engines can loop on narrow ranges as well as equal ends.
  for (const source of ['flowchart LR\n A[Hello] --> B[World]', 'xychart\n x-axis 0 --> 100\n line [1, 2]', 'radar-beta\n axis a, b\n curve c {1, 1}\n ticks 5']) {
    const result = await bounded(source, 15000); assert(result.svg && !result.error, JSON.stringify(result))
  }
  const source = 'xychart\n x-axis 1 --> 1\n line [1, 2]'
  const result = await bounded(source, 1500)
  assert(result.elapsed < 500, `Invalid range must settle promptly, observed ${result.elapsed}ms`)
  const radar = await bounded('radar-beta\n axis a, b\n curve c {1, 1}\n ticks 1000000000', 1500)
  assert(radar.elapsed < 500, `Radar tick input must settle promptly, observed ${radar.elapsed}ms`)
  assert.equal(await page.evaluate(() => 2 + 2), 4, 'Browser remains responsive')
  const exported = await Promise.race([page.evaluate(async source => {
    const result = await window.exportDiagram('# Diagram export\n\n```mermaid\n' + source + '\n```\n')
    return { title: result.title, svg: result.bodyHtml.includes('<svg') }
  }, source), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Actual export renderer blocked on XY input')), 1500) })])
  clearTimeout(timer)
  assert.equal(exported.title, 'Diagram export'); assert(exported.svg)
  const blocked = await render('flowchart LR\n A --> B\n classDef default fill:red')
  assert(blocked.error, 'Application CSS/directive guard remains enabled')
  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: true, result, radar, exported, blocked, packageVersion: JSON.parse(fs.readFileSync('node_modules/mermaid/package.json', 'utf8')).version }, null, 2))
  console.log('PASS actual Mermaid renderer: normal flow/XY, invalid XY range settles, CSS guard preserved')
} finally { clearTimeout(timer); await browser?.close(); await server.close() }
