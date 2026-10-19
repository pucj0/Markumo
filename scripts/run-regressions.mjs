#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Smoke tests: fast, deterministic, core regressions covering Markdown, settings, updater, smooth caret, workspace, syntax, brackets
const SMOKE_TESTS = [
  'scripts/markdown-empty-regression.mjs',
  'scripts/settings-keybindings-regression.mjs',
  'scripts/updater-regression.mjs',
  'scripts/smooth-caret-regression.mjs',
  'scripts/workspace-p0-regression.mjs',
  'scripts/syntax-regression.mjs',
  'scripts/brackets-regression.mjs'
]

// Full regression suite: all existing regression scripts
const FULL_REGRESSION_TESTS = [
  'scripts/markdown-empty-regression.mjs',
  'scripts/settings-keybindings-regression.mjs',
  'scripts/updater-regression.mjs',
  'scripts/smooth-caret-regression.mjs',
  'scripts/workspace-p0-regression.mjs',
  'scripts/workspace-smart-expand-regression.mjs',
  'scripts/syntax-regression.mjs',
  'scripts/brackets-regression.mjs',
  'scripts/rich-clipboard-regression.mjs',
  'scripts/outline-regression.mjs',
  'scripts/outline-navigation-regression.mjs',
  'scripts/heading-outline-regression.mjs',
  'scripts/table-layout-regression.mjs',
  'scripts/native-drop-regression.mjs',
  'scripts/export-code-regression.mjs',
  'scripts/media-regression.mjs',
  'scripts/windows-artifacts-regression.mjs',
  'scripts/release-regression.mjs'
]

function findSystemBrowser() {
  const candidates = []
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const localAppData = process.env.LOCALAPPDATA || ''
    candidates.push(
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe')
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    )
  } else {
    // Linux
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium'
    )
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function inspectEnvironment() {
  let playwrightInstalled = false
  let chromiumPath = null

  try {
    const pw = await import('playwright')
    playwrightInstalled = true
    if (pw.chromium && typeof pw.chromium.executablePath === 'function') {
      try {
        const p = pw.chromium.executablePath()
        if (p && fs.existsSync(p)) {
          chromiumPath = p
        }
      } catch {}
    }
  } catch {}

  if (process.env.MARKUMO_CHROME) {
    if (fs.existsSync(process.env.MARKUMO_CHROME)) {
      return { ok: true, browser: process.env.MARKUMO_CHROME, type: 'custom-chrome' }
    } else {
      console.warn(`[WARN] MARKUMO_CHROME is set to "${process.env.MARKUMO_CHROME}" but file does not exist.`)
    }
  }

  if (chromiumPath) {
    return { ok: true, browser: chromiumPath, type: 'playwright-chromium' }
  }

  const sysBrowser = findSystemBrowser()
  if (sysBrowser) {
    process.env.MARKUMO_CHROME = sysBrowser
    return { ok: true, browser: sysBrowser, type: 'detected-system-browser' }
  }

  if (!playwrightInstalled) {
    return {
      ok: false,
      error: 'Playwright is not installed. Run `pnpm install`.'
    }
  }

  return {
    ok: false,
    error:
      'No compatible Chromium or Chrome executable found.\n' +
      '  - Run `pnpm exec playwright install chromium` to install Playwright Chromium, OR\n' +
      '  - Set MARKUMO_CHROME to your Chrome/Edge executable path.'
  }
}

function checkTestPrerequisites(scriptPath) {
  const norm = scriptPath.replace(/\\/g, '/')
  if (norm.endsWith('media-regression.mjs')) {
    const requiredFiles = ['single.pdf', 'transparent.png', 'sample.jpg']
    const fixtureDir = path.resolve(ROOT_DIR, '.markumo-media-test/fixtures')
    const missing = requiredFiles.filter(f => !fs.existsSync(path.join(fixtureDir, f)))
    if (missing.length > 0) {
      return {
        ok: false,
        reason:
          `Missing media fixtures in .markumo-media-test/fixtures (${missing.join(', ')}).\n` +
          'Please generate fixtures before running media regression:\n' +
          '  python scripts/media-fixtures.py .markumo-media-test/fixtures\n' +
          '(Requires Python packages: Pillow, reportlab, pypdf)'
      }
    }
  }
  return { ok: true }
}

function terminateProcess(child) {
  if (!child || child.killed) return
  const pid = child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {}
    }
  }
}

function runSingleTest(scriptPath, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const absPath = path.resolve(ROOT_DIR, scriptPath)
    if (!fs.existsSync(absPath)) {
      resolve({
        name: scriptPath,
        status: 'FAIL',
        duration: 0,
        error: `Test script not found: ${absPath}`
      })
      return
    }

    const prereq = checkTestPrerequisites(scriptPath)
    if (!prereq.ok) {
      resolve({
        name: scriptPath,
        status: 'FAIL',
        duration: 0,
        error: prereq.reason
      })
      return
    }

    const startTime = performance.now()
    const env = { ...process.env }
    // Ensure temporary directories on Windows avoid permission issues in restricted sandboxes
    if (process.platform === 'win32' && !env.TEMP) {
      const fallbackTemp = path.resolve(ROOT_DIR, '.markumo-media-test')
      fs.mkdirSync(fallbackTemp, { recursive: true })
      env.TEMP = fallbackTemp
      env.TMP = fallbackTemp
    }

    const child = spawn(process.execPath, [absPath], {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      terminateProcess(child)
    }, timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const duration = Math.round(performance.now() - startTime)

      if (timedOut) {
        resolve({
          name: scriptPath,
          status: 'FAIL',
          duration,
          error: `Test timed out after ${timeoutMs}ms`,
          stdout,
          stderr
        })
        return
      }

      if (signal) {
        resolve({
          name: scriptPath,
          status: 'FAIL',
          duration,
          error: `Process terminated by signal ${signal}`,
          stdout,
          stderr
        })
        return
      }

      const isSkipped = code === 0 && stdout.includes('SKIP:')
      if (isSkipped) {
        resolve({
          name: scriptPath,
          status: 'SKIP',
          duration,
          stdout,
          stderr
        })
        return
      }

      if (code !== 0) {
        resolve({
          name: scriptPath,
          status: 'FAIL',
          duration,
          error: `Process exited with code ${code}`,
          stdout,
          stderr
        })
        return
      }

      resolve({
        name: scriptPath,
        status: 'PASS',
        duration,
        stdout,
        stderr
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      const duration = Math.round(performance.now() - startTime)
      resolve({
        name: scriptPath,
        status: 'FAIL',
        duration,
        error: `Failed to spawn process: ${err.message}`,
        stdout,
        stderr
      })
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  let suiteName = 'smoke'
  let customFiles = []
  let timeoutMs = 180000

  for (const arg of args) {
    if (arg === 'smoke' || arg === '--smoke' || arg === '--suite=smoke') {
      suiteName = 'smoke'
    } else if (arg === 'regression' || arg === '--regression' || arg === '--suite=regression' || arg === 'all') {
      suiteName = 'regression'
    } else if (arg.startsWith('--timeout=')) {
      const val = parseInt(arg.split('=')[1], 10)
      if (!isNaN(val) && val > 0) timeoutMs = val
    } else if (!arg.startsWith('-')) {
      customFiles.push(arg)
    }
  }

  let testsToRun = []
  if (customFiles.length > 0) {
    testsToRun = customFiles
    suiteName = 'custom'
  } else if (suiteName === 'regression') {
    testsToRun = FULL_REGRESSION_TESTS
  } else {
    testsToRun = SMOKE_TESTS
  }

  console.log('='.repeat(70))
  console.log(` Markumo Regression Runner [suite: ${suiteName}]`)
  console.log(` Platform: ${process.platform} (${process.arch}), Node: ${process.version}`)
  console.log('='.repeat(70))

  const envCheck = await inspectEnvironment()
  if (!envCheck.ok) {
    console.error(`\n[FATAL] Environment check failed:\n${envCheck.error}\n`)
    process.exit(1)
  }
  console.log(`[ENV] Browser: ${envCheck.browser} (${envCheck.type})`)
  console.log(`[INFO] Running ${testsToRun.length} test(s) serially (timeout: ${timeoutMs / 1000}s)...\n`)

  const results = []
  const overallStart = performance.now()

  for (let i = 0; i < testsToRun.length; i++) {
    const testFile = testsToRun[i]
    const indexStr = `[${i + 1}/${testsToRun.length}]`
    process.stdout.write(`${indexStr} Running ${testFile} ... `)

    const res = await runSingleTest(testFile, timeoutMs)
    results.push(res)

    if (res.status === 'PASS') {
      console.log(`\x1b[32mPASS\x1b[0m (${(res.duration / 1000).toFixed(2)}s)`)
    } else if (res.status === 'SKIP') {
      console.log(`\x1b[33mSKIP\x1b[0m (${(res.duration / 1000).toFixed(2)}s)`)
    } else {
      console.log(`\x1b[31mFAIL\x1b[0m (${(res.duration / 1000).toFixed(2)}s)`)
      if (res.error) {
        console.log(`      Error: ${res.error}`)
      }
      if (res.stderr && res.stderr.trim()) {
        const lines = res.stderr.trim().split('\n').slice(-10)
        console.log('      Stderr tail:')
        for (const line of lines) {
          console.log(`        ${line}`)
        }
      }
    }
  }

  const overallDuration = ((performance.now() - overallStart) / 1000).toFixed(2)
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length

  console.log('\n' + '='.repeat(70))
  console.log(' Test Summary')
  console.log('='.repeat(70))
  console.log(` Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped} | Time: ${overallDuration}s`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  - ${r.name}: ${r.error || 'Unknown failure'}`)
    }
    console.log('='.repeat(70) + '\n')
    process.exit(1)
  }

  console.log('='.repeat(70) + '\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('[UNCAUGHT ERROR in runner]', err)
  process.exit(1)
})
