// Windows release-build startup through real WebView2 and the actual app shell.
// The dedicated build must embed native-config.json, never the production ID/profile.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

assert.equal(process.platform, 'win32', 'This probe requires Windows/WebView2')
const label = process.argv.find(value => value.startsWith('--label='))?.slice(8) || 'baseline'
assert.match(label, /^[a-zA-Z0-9_-]+$/)
const root = path.resolve('test-results/phase07'), output = path.join(root, `native-startup-${label}`)
fs.mkdirSync(output, { recursive: true })
const config = JSON.parse(fs.readFileSync(path.join(root, 'native-config.json'), 'utf8').replace(/^\uFEFF/, ''))
assert.equal(config.identifier, 'com.markumo.phase07-audit')
const profile = config.app.appDirectoriesOverride
assert.equal(path.resolve(profile), path.join(root, 'native-profile'))
fs.mkdirSync(profile, { recursive: true })
const binary = path.join(root, /^final(?:-|$)/.test(label) ? 'native-final/markumo-isolated.exe' : 'native-baseline/markumo-isolated.exe'), bytes = fs.readFileSync(binary)
assert(bytes.includes(Buffer.from(config.identifier)), 'Refusing to launch a binary without the dedicated test identifier')
const fixture = path.join(root, 'native-fixtures')
fs.mkdirSync(fixture, { recursive: true })
const files = Array.from({ length: 100 }, (_, i) => path.join(fixture, `file-${i}.txt`))
for (const [i, file] of files.entries()) fs.writeFileSync(file, `Native startup fixture ${i}\n` + 'ordinary line\n'.repeat(100))
const workspace = path.join(fixture, 'workspace')
fs.mkdirSync(workspace, { recursive: true })
for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(workspace, `note-${i}.txt`), `Fixture ${i}\n`)
const report = { mode: 'release / isolated ID and data directory / real Windows WebView2 / CDP attached',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), label, binarySha256: createHash('sha256').update(bytes).digest('hex'), startedAt: new Date().toISOString(), samples: [], errors: [],
  caveats: ['OS file cache is uncontrolled; fresh-profile is not an uncached OS boot.', 'CDP attachment and polling overhead is included in process-to-ready.', 'Native init/JS/Vue/CM subphases cannot be independently attributed without instrumentation.'] }
const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, browser
let sequence = 0
const invocation = Date.now().toString(36)
try {
  for (const scenario of ['fresh-profile', 'warm-profile', 'single-file', 'workspace-session', 'history-10-tabs', 'large-workspace-100-tabs']) {
    for (let run = scenario === 'warm-profile' ? 0 : 1; run <= 5; run++) {
      fs.writeFileSync(path.join(profile, 'editor-settings.json'), JSON.stringify({ settingsVersion: 6, autoCheckUpdates: false, autoDownloadUpdates: false }))
      // Native session persistence uses canonical Windows namespace paths.
      const canonical = file => path.toNamespacedPath(fs.realpathSync.native(file))
      const tabs = (scenario === 'history-10-tabs' ? files.slice(0, 10) : scenario === 'large-workspace-100-tabs' ? files : []).map(canonical)
      const roots = scenario.includes('workspace') ? [canonical(workspace)] : []
      fs.writeFileSync(path.join(profile, 'last-session.json'), JSON.stringify({ schemaVersion: 1, kind: roots.length ? 'workspace' : 'single', roots,
        tabs: tabs.map(file => ({ path: file, encoding: 'UTF-8' })), activePath: tabs.at(-1) ?? null,
        layout: { mode: roots.length ? 'workspace' : 'single', sidebarVisible: !!roots.length, sidebarWidth: 240 } }))
      const port = 9480 + sequence++, webProfile = path.join(output, invocation, scenario === 'warm-profile' ? 'warm-webview' : `${scenario}-${run}`)
      const start = performance.now()
      child = spawn(binary, scenario === 'single-file' ? [files[0]] : [], { windowsHide: true,
        env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webProfile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'pipe' })
      child.on('error', error => report.errors.push(String(error)))
      let diagnostic = ''
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4096) })
      const deadline = performance.now() + 30000
      while (true) {
        if (child.exitCode !== null) throw Error(`Isolated native process exited early (${child.exitCode}): ${diagnostic}`)
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
          if (response.ok) break
        } catch { /* Condition-based wait for the actual WebView2 debug endpoint. */ }
        if (performance.now() >= deadline) throw Error('Native WebView2 endpoint timed out')
        await wait(25)
      }
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      report.webviewVersion = browser.version()
      let page
      while (!page) {
        page = browser.contexts().flatMap(context => context.pages()).find(page => !page.url().startsWith('devtools:'))
        if (performance.now() >= deadline) throw Error('Native page timed out')
        if (!page) await wait(25)
      }
      page.on('pageerror', error => report.errors.push(error.message))
      await page.waitForFunction(() => document.querySelector('.app:not([inert])') && !document.querySelector('.startup-overlay'), null, { timeout: 30000 })
      const shellReadyMs = performance.now() - start
      const expectedTabs = scenario === 'single-file' ? 1 : tabs.length
      assert.equal(await page.locator('.tab .filename').count(), expectedTabs, 'Native session restoration tab count')
      if (roots.length) assert(await page.locator('.sidebar-wrapper').count() > 0, 'Workspace sidebar must be present')
      if (!expectedTabs) await page.keyboard.press('Control+n')
      await page.locator('.cm-content').first().waitFor()
      const editorReadyMs = performance.now() - start
      const editor = page.locator('.cm-content').first()
      await editor.click(); await page.keyboard.press('Control+Home')
      await page.keyboard.type('PHASE07_INPUT_PROBE')
      await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('PHASE07_INPUT_PROBE'))
      const interactiveMs = performance.now() - start
      await page.keyboard.press('Control+z')
      await page.waitForFunction(() => !document.querySelector('.cm-content')?.textContent.includes('PHASE07_INPUT_PROBE'))
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage')
      const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
      const nativeMemory = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `
        $auditRows = @(Get-CimInstance Win32_Process)
        $auditIds = [Collections.Generic.HashSet[int]]::new()
        [void]$auditIds.Add(${child.pid})
        do {
          $auditAdded = $false
          foreach ($auditRow in $auditRows) {
            if ($auditIds.Contains([int]$auditRow.ParentProcessId) -and $auditIds.Add([int]$auditRow.ProcessId)) { $auditAdded = $true }
          }
        } while ($auditAdded)
        $auditViews = @(Get-Process -Id @($auditIds) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'msedgewebview2')
        [pscustomobject]@{
          native = (Get-Process -Id ${child.pid} | Select-Object WorkingSet64,PrivateMemorySize64,HandleCount,@{Name='ThreadCount';Expression={$_.Threads.Count}})
          webviewProcessCount = $auditViews.Count
          webviewWorkingSetSum = [long](($auditViews | Measure-Object WorkingSet64 -Sum).Sum)
          webviewPrivateBytesSum = [long](($auditViews | Measure-Object PrivateMemorySize64 -Sum).Sum)
          webviewHandleSum = [long](($auditViews | Measure-Object HandleCount -Sum).Sum)
        } | ConvertTo-Json -Depth 3 -Compress
      `], { encoding: 'utf8', windowsHide: true }))
      const sample = { scenario, run, shellReadyMs, editorReadyMs, interactiveMs, heap: metrics.JSHeapUsedSize,
        dom: await cdp.send('Memory.getDOMCounters'), nativeMemory, navigation: await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.toJSON()) }
      if (run > 0) report.samples.push(sample)
      persist()
      if (run === 1) await page.screenshot({ path: path.join(output, `${scenario}.png`) })
      // Use the real frontend close handshake; never install or invoke updater APIs.
      const exited = once(child, 'exit')
      await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
      let closeTimer
      try {
        await Promise.race([exited, new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('Native close handshake timed out')), 10000) })])
      } finally { clearTimeout(closeTimer) }
      await browser.close().catch(() => {}); browser = undefined; child = undefined
      console.log(`PASS ${scenario} ${run}/5 shell=${shellReadyMs.toFixed(0)}ms interactive=${interactiveMs.toFixed(0)}ms`)
    }
  }
  assert.deepEqual(report.errors, [])
  report.completedAt = new Date().toISOString(); report.passed = true; persist()
} catch (error) { report.failure = String(error.stack || error); persist(); throw error }
finally {
  if (child?.exitCode === null) child.kill()
  await browser?.close().catch(() => {})
}
