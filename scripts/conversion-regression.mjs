import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/conversion'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import { ExportController } from '/src/features/document-conversion/ExportController.ts';
import { ImportController } from '/src/features/document-conversion/ImportController.ts';
import { loadLastExport } from '/src/features/document-conversion/conversionSettings.ts';
window.isTauri = true;
mockWindows('main');
const calls = [], notifications = [];
let sequence = 0, cancelSave = false, cancelOpen = false, failSave = false;
mockIPC((command, args) => {
  calls.push({ command, args });
  if (command === 'detect_pandoc') return { available: true, version: 'fake-ui-contract' };
  if (command === 'export_save_dialog') return cancelSave ? null : { token: 'write-' + (++sequence), path: 'E:/exports/' + args.defaultName };
  if (command === 'import_open_dialog') return cancelOpen ? null : { token: 'read-' + (++sequence), path: 'E:/imports/source.' + args.format };
  if (command === 'release_conversion_lease') return;
  if (command === 'read_conversion_html') return '<html><head><title>Imported HTML</title></head><body><h1>Selected HTML</h1><p>body</p></body></html>';
  if (command === 'pandoc_import_docx') return '# Imported Word\\n\\n![image](source.assets/import-id/media/pixel.png)';
  if (['save_binary_file', 'print_to_pdf', 'pandoc_export_docx'].includes(command)) {
    if (failSave) throw new Error('injected native write failure');
    return;
  }
  throw new Error('Unexpected IPC: ' + command);
});
const manager = new DocumentManager([]);
manager.openFile({ kind: 'text', token: 'document-capability', path: 'E:/documents/notes.md', name: 'notes.md', text: '# Title\\n\\ntext\\n\\n|a|b|\\n|-|-|\\n|one|two|', version: 'v1', encoding: 'UTF-8', bom: false, eol: 'LF', readOnly: false });
const exporter = new ExportController(manager, message => notifications.push(message));
const importer = new ImportController(manager, message => notifications.push(message));
window.f = { calls, notifications, manager, exporter, importer, loadLastExport,
  reset() { calls.length = 0; notifications.length = 0; cancelSave = cancelOpen = failSave = false; },
  configure(options) { cancelSave = !!options.cancelSave; cancelOpen = !!options.cancelOpen; failSave = !!options.failSave; }
};
`)
const port = Number(process.env.MARKUMO_TEST_PORT || 1458)
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}), args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(() => window.f)
  for (const format of ['html', 'html-plain', 'png', 'pdf', 'docx']) {
    const result = await page.evaluate(async format => {
      const f = window.f; f.reset()
      const path = await f.exporter.exportDocument(format)
      return { path, calls: f.calls, notifications: f.notifications, last: f.loadLastExport(), frames: document.querySelectorAll('iframe').length }
    }, format)
    assert.match(result.path, /notes\.(html|png|pdf|docx)$/)
    const command = format.startsWith('html') || format === 'png' ? 'save_binary_file' : format === 'pdf' ? 'print_to_pdf' : 'pandoc_export_docx'
    const write = result.calls.find(call => call.command === command)
    const selected = result.calls.find(call => call.command === 'export_save_dialog')
    assert(write?.args.token.startsWith('write-'))
    assert.equal(selected.args.defaultName, result.path.split('/').pop())
    assert(!['path', 'outputDocxPath', 'outputPdfPath', 'resourceDir'].some(key => key in write.args))
    if (format === 'docx') assert.equal(write.args.documentToken, 'document-capability')
    if (format === 'pdf') { assert.match(write.args.htmlContent, /@page/); assert.equal(write.args.options.paperSize, 'A4') }
    assert(result.calls.some(call => call.command === 'release_conversion_lease' && call.args.token === write.args.token))
    assert(!JSON.stringify(result.last).includes('write-'))
    assert(result.notifications.some(text => text.startsWith('已成功导出')))
    assert.equal(result.frames, 0)
    console.log(`PASS ${format} export: real controller/rendering, fresh lease IPC and cleanup`)
  }
  const repeated = await page.evaluate(async () => {
    const f = window.f; f.reset(); f.configure({ cancelSave: true })
    const path = await f.exporter.exportRepeat()
    return { path, calls: f.calls, notifications: f.notifications }
  })
  assert.equal(repeated.path, null)
  assert.deepEqual(repeated.calls.map(call => call.command), ['export_save_dialog'])
  assert(!repeated.notifications.some(text => text.startsWith('已成功')))
  console.log('PASS repeat export asks for a new destination; cancellation grants no authority')

  const failed = await page.evaluate(async () => {
    const f = window.f; f.reset(); f.configure({ failSave: true }); const before = JSON.stringify(f.loadLastExport())
    let error; try { await f.exporter.exportDocument('html') } catch (e) { error = String(e) }
    return { error, calls: f.calls, notifications: f.notifications, before, after: JSON.stringify(f.loadLastExport()) }
  })
  assert.match(failed.error, /injected native write failure/)
  assert(failed.calls.some(call => call.command === 'release_conversion_lease'))
  assert(failed.notifications.some(text => text.startsWith('导出失败')))
  assert(!failed.notifications.some(text => text.startsWith('已成功')))
  assert.equal(failed.before, failed.after)
  console.log('PASS failed export releases capability, reports failure and preserves history')

  for (const format of ['html', 'docx']) {
    const imported = await page.evaluate(async format => {
      const f = window.f; f.reset(); const path = await f.importer.importDocument(format)
      return { path, calls: f.calls, text: f.manager.getText(f.manager.activeDocument.id), notifications: f.notifications }
    }, format)
    assert(imported.path)
    assert.match(imported.text, format === 'html' ? /Selected HTML/ : /Imported Word/)
    assert.equal(imported.calls.filter(call => call.command === 'import_open_dialog').length, 1)
    assert(!imported.calls.some(call => ['open_dialog', 'reopen_file'].includes(call.command)))
    const convert = imported.calls.find(call => call.command === (format === 'html' ? 'read_conversion_html' : 'pandoc_import_docx'))
    if (format === 'docx') { assert(convert.args.sourceToken.startsWith('read-')); assert(convert.args.targetToken.startsWith('write-')); assert.deepEqual(Object.keys(convert.args).sort(), ['sourceToken', 'targetToken']) }
    assert.equal(imported.calls.filter(call => call.command === 'release_conversion_lease').length, format === 'html' ? 1 : 2)
    console.log(`PASS ${format} import: selected source only, real controller/document state, lease release`)
  }
  const cancelled = await page.evaluate(async () => {
    const f = window.f; f.reset(); f.configure({ cancelSave: true }); const path = await f.importer.importDocument('docx')
    return { path, calls: f.calls }
  })
  assert.equal(cancelled.path, null)
  assert(cancelled.calls.some(call => call.command === 'release_conversion_lease' && call.args.token.startsWith('read-')))
  assert(!cancelled.calls.some(call => call.command === 'pandoc_import_docx'))
  assert.deepEqual(errors, [])
  console.log('PASS cancelled Word destination releases the source lease')

  await page.evaluate(() => { window.isTauri = false; window.f.reset() })
  const download = page.waitForEvent('download')
  await page.evaluate(() => window.f.exporter.exportDocument('html'))
  assert.match((await download).suggestedFilename(), /\.html$/)
  assert.equal(await page.evaluate(() => window.f.calls.length), 0)
  console.log('PASS browser HTML export remains independent of native capabilities')
} finally {
  await browser?.close()
  await server.close()
}
