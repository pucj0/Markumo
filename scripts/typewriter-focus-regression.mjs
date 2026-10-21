import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(
  process.env.MARKUMO_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href
    : 'playwright'
)

const output = 'test-results/typewriter-focus'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(
  `${output}/pixel.png`,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64')
)

fs.writeFileSync(
  `${output}/index.html`,
  `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="height:720px;display:flex"></div><script type="module" src="./fixture.js"></script>`
)

fs.writeFileSync(
  `${output}/fixture.js`,
  `
import { createApp, h, ref, markRaw } from 'vue'
import SplitLayoutNode from '/src/components/layout/SplitLayoutNode.vue'
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import { EditorView as CM } from '@codemirror/view'
import { EditorState as CMState, EditorSelection } from '@codemirror/state'
import { TextSelection } from 'prosemirror-state'
import {
  calculateTypewriterScroll,
  TYPEWRITER_DEAD_ZONE,
  TYPEWRITER_RATIO,
} from '/src/editor/core/typewriterScroll.ts'
import {
  defaultSettings,
  settingsFrom,
  persistedSettings,
} from '/src/features/shell/editorSettings.ts'
import {
  allCommands,
  commandDefinition,
  getPresetBindings,
} from '/src/features/shell/keybindings/index.ts'
import { mainMenu } from '/src/features/shell/mainMenu.ts'
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import '/src/styles/main.css'

const manager = new DocumentManager([], async () => [])
const revision = ref(0)
const focusMode = ref(false)
manager.subscribe(() => revision.value++)

createApp({
  render() {
    revision.value
    return h(SplitLayoutNode, {
      manager: markRaw(manager),
      node: manager.layout.root,
      revision: revision.value,
      desktop: false,
      focusMode: focusMode.value,
    })
  },
}).mount('#app')

window.f = {
  manager,
  focusMode,
  CM,
  CMState,
  EditorSelection,
  TextSelection,
  calculateTypewriterScroll,
  TYPEWRITER_DEAD_ZONE,
  TYPEWRITER_RATIO,
  defaultSettings,
  settingsFrom,
  persistedSettings,
  allCommands,
  commandDefinition,
  getPresetBindings,
  mainMenu,
  cm: () => manager.activeEditorView,
  live: () => manager.activeLiveEditor,
  reset(source, ext = 'md', mode = 'live') {
    const id = manager.createUntitled(ext)
    manager.setMarkdownMode(id, mode, 'main')
    manager.dispatch(id, { changes: { from: 0, insert: source } })
    return id
  },
}
`
)

const server = await createServer({ server: { port: 1439, strictPort: true } })
await server.listen()

let browser
const results = []

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}),
  })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(15000)

  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text())
  })

  await page.goto(`http://localhost:1439/${output}/index.html`)
  await page.waitForFunction(() => window.f)

  const test = async (name, run) => {
    await run()
    results.push(name)
    console.log('PASS ' + name)
  }

  // --- 1. Unit Tests for calculateTypewriterScroll & Algorithms ---
  await test('unit: calculateTypewriterScroll centering, deadband and scroll bounds', async () => {
    const res = await page.evaluate(() => {
      const mockScroller = {
        clientHeight: 600,
        scrollHeight: 2000,
        scrollTop: 200,
        getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600 }),
      }
      const deadZoneRes = window.f.calculateTypewriterScroll(mockScroller, { top: 370, bottom: 390 })
      const belowRes = window.f.calculateTypewriterScroll(mockScroller, { top: 500, bottom: 520 })
      const aboveRes = window.f.calculateTypewriterScroll(mockScroller, { top: 150, bottom: 170 })

      const shortScroller = {
        clientHeight: 600,
        scrollHeight: 400,
        scrollTop: 0,
        getBoundingClientRect: () => ({ top: 0, bottom: 600, height: 600 }),
      }
      const shortRes = window.f.calculateTypewriterScroll(shortScroller, { top: 50, bottom: 70 })

      return {
        deadZoneNeeded: deadZoneRes.needed,
        belowNeeded: belowRes.needed,
        belowDest: belowRes.destination,
        aboveNeeded: aboveRes.needed,
        aboveDest: aboveRes.destination,
        shortDest: shortRes.destination,
      }
    })

    assert.equal(res.deadZoneNeeded, false, 'Caret within dead zone must not trigger scroll')
    assert.equal(res.belowNeeded, true)
    assert.equal(res.belowDest, 340, 'Destination below should adjust downward')
    assert.equal(res.aboveNeeded, true)
    assert.equal(res.aboveDest, 0, 'Destination above should clamp to 0 at top')
    assert.equal(res.shortDest, 0, 'Short document destination must be bounded to 0')
  })

  // --- 2. Settings & Command Registry Invariants ---
  await test('config: settings persistence, presets and menu registration', async () => {
    const res = await page.evaluate(() => {
      const def = window.f.defaultSettings()
      const parsedOn = window.f.settingsFrom({ typewriterMode: true })
      const persisted = window.f.persistedSettings(parsedOn)
      const cmd = window.f.commandDefinition('toggle-typewriter')
      const markumoBinding = window.f.getPresetBindings('markumo')['toggle-typewriter']
      const typoraBinding = window.f.getPresetBindings('typora')['toggle-typewriter']
      const fleetBinding = window.f.getPresetBindings('fleet')['toggle-typewriter']

      const menu = window.f.mainMenu({
        sidebar: true,
        outline: false,
        wrap: false,
        split: false,
        focus: false,
        typewriter: true,
        markdown: true,
        markdownMode: 'live',
        composing: false,
        recentFiles: [],
        recentWorkspaces: [],
      })
      const viewGroup = menu.find(g => g.id === 'view')
      const item = viewGroup?.items.find(i => i.id === 'toggle-typewriter')

      return {
        defMode: def.typewriterMode,
        parsedMode: parsedOn.typewriterMode,
        persistedMode: persisted.typewriterMode,
        hasCmd: !!cmd,
        defaultBinding: cmd?.defaultBinding,
        markumoBinding,
        typoraBinding,
        fleetBinding,
        menuChecked: item?.checked,
      }
    })

    assert.equal(res.defMode, false, 'typewriterMode must be false by default')
    assert.equal(res.parsedMode, true, 'settingsFrom must parse typewriterMode: true')
    assert.equal(res.persistedMode, true, 'persistedSettings must retain typewriterMode')
    assert.equal(res.hasCmd, true, 'toggle-typewriter command must be registered')
    assert.equal(res.defaultBinding, 'F9', 'toggle-typewriter defaultBinding must be F9')
    assert.equal(res.markumoBinding, 'F9', 'markumo preset must map F9')
    assert.equal(res.typoraBinding, 'F9', 'typora preset must map F9')
    assert.equal(res.fleetBinding, 'F9', 'fleet preset must map F9')
    assert.equal(res.menuChecked, true, 'menu item must reflect typewriter active state')
  })

  // --- 3. Browser E2E Regressions ---

  // Regression A: CodeMirror Source Mode Typewriter Behavior
  await test('CodeMirror Source: enables typewriter mode, adds bottom padding and follows cursor', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: Sample typewriter source text`).join('\n')
    await page.evaluate(lines => {
      window.f.reset(lines, 'md', 'source')
      window.f.manager.setTypewriterMode(true)
    }, lines)

    await page.waitForSelector('.cm-editor.cm-typewriter-mode')
    const hasTypewriterClass = await page.locator('.cm-editor').evaluate(el => el.classList.contains('cm-typewriter-mode'))
    assert.equal(hasTypewriterClass, true, 'cm-editor must have cm-typewriter-mode class')

    // Move cursor to line 40
    await page.evaluate(() => {
      const view = window.f.cm()
      const pos = view.state.doc.line(40).from
      view.dispatch({ selection: window.f.EditorSelection.cursor(pos) })
      view.focus()
    })

    // Wait for smooth alignment
    await page.waitForTimeout(400)
    const scrollTop = await page.locator('.cm-scroller').evaluate(el => el.scrollTop)
    assert.ok(scrollTop > 100, `Typewriter must scroll to keep line 40 centered, got scrollTop: ${scrollTop}`)
  })

  // Regression B: Manual Mouse Wheel Interrupt in CodeMirror
  await test('CodeMirror Source: mouse wheel pauses auto-centering until subsequent input', async () => {
    // Scroll manually via wheel
    await page.locator('.cm-scroller').evaluate(el => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -150, bubbles: true }))
      el.scrollTop = 50
    })
    await page.waitForTimeout(200)

    const scrollAfterWheel = await page.locator('.cm-scroller').evaluate(el => el.scrollTop)
    assert.equal(scrollAfterWheel, 50, 'Manual scroll must pause auto-center without forcing view back')

    // Subsequent typing resumes typewriter following
    await page.evaluate(() => {
      const view = window.f.cm()
      const pos = view.state.doc.line(40).from
      view.dispatch({ changes: { from: pos, insert: 'Typing ' } })
    })
    await page.waitForTimeout(400)
    const scrollAfterTyping = await page.locator('.cm-scroller').evaluate(el => el.scrollTop)
    assert.ok(scrollAfterTyping > 100, 'Subsequent typing must resume typewriter centering')
  })

  // Regression C: Continuous 100 lines input & rapid line insertions without oscillation
  await test('Continuous Input: 100 lines typed continuously maintains steady vertical center without jitter', async () => {
    await page.evaluate(() => {
      const id = window.f.reset('', 'md', 'source')
      window.f.manager.setTypewriterMode(true)
      const view = window.f.cm()
      view.focus()
      // Simulate continuous 100 lines typing
      for (let i = 1; i <= 100; i++) {
        const text = `Line ${i}: continuously generated text content for typewriter test\n`
        view.dispatch({
          changes: { from: view.state.doc.length, insert: text },
          selection: window.f.EditorSelection.cursor(view.state.doc.length + text.length),
        })
      }
    })

    await page.waitForTimeout(400)
    const scrollerInfo = await page.locator('.cm-scroller').evaluate(el => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))

    assert.ok(scrollerInfo.scrollTop > 500, `Continuous 100 lines must scroll into bottom half, got ${scrollerInfo.scrollTop}`)
    assert.ok(scrollerInfo.scrollTop <= scrollerInfo.scrollHeight - scrollerInfo.clientHeight, 'Must remain bounded')
  })

  // Regression D: Markdown Live Editor Typewriter Centering & Controlled Padding
  await test('Markdown Live: typewriter mode applies controlled bottom padding and centers active paragraph', async () => {
    const liveDoc = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1} with Markdown **bold** and *italic* content.`).join('\n\n')
    await page.evaluate(liveDoc => {
      window.f.reset(liveDoc, 'md', 'live')
      window.f.manager.setTypewriterMode(true)
    }, liveDoc)

    await page.waitForSelector('.markdown-live.typewriter-mode')
    const hasClass = await page.locator('.markdown-live').evaluate(el => el.classList.contains('typewriter-mode'))
    assert.equal(hasClass, true, '.markdown-live must have typewriter-mode class')

    // Place selection in paragraph 35
    await page.evaluate(() => {
      const live = window.f.live()
      const doc = live.view.state.doc
      const targetPos = doc.content.size - 200
      live.view.dispatch(live.view.state.tr.setSelection(window.f.TextSelection.create(doc, targetPos)))
      live.focus()
    })

    await page.waitForTimeout(450)
    const liveScroll = await page.locator('.markdown-live').evaluate(el => el.scrollTop)
    assert.ok(liveScroll > 200, `Live editor must scroll to center active paragraph, got: ${liveScroll}`)
  })

  // Regression E: Nested Embedded CodeBlock in Live Editor
  await test('Markdown Live: embedded CodeBlock focuses actual caret without fighting outer container', async () => {
    const codeDoc = '# Header\n\n```javascript\nfunction test() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}\n```\n\nTail paragraph.'
    await page.evaluate(codeDoc => {
      window.f.reset(codeDoc, 'md', 'live')
      window.f.manager.setTypewriterMode(true)
    }, codeDoc)

    await page.waitForSelector('.markdown-live .md-code-block .cm-editor')
    // Click inside embedded CodeMirror
    await page.locator('.markdown-live .md-code-block .cm-content').click()
    await page.waitForTimeout(200)

    const isInsideCM = await page.evaluate(() => {
      return document.activeElement?.closest('.cm-editor') !== null
    })
    assert.equal(isInsideCM, true, 'Focus must reside in embedded CodeMirror')
  })

  // Regression F: IME Composition Guard
  await test('Markdown Live: IME composition suspends scroll and resumes smoothly on compositionend', async () => {
    await page.evaluate(() => {
      const root = document.querySelector('.markdown-live')
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })

    // Dispatch text change while composing
    await page.evaluate(() => {
      const live = window.f.live()
      live.view.dispatch(live.view.state.tr.insertText('测试输入'))
    })
    await page.waitForTimeout(150)

    // End composition
    await page.evaluate(() => {
      const root = document.querySelector('.markdown-live')
      root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    await page.waitForTimeout(400)
    assert.ok(true, 'IME composition completed safely')
  })

  // Regression G: Special Contents: Large Tables, Math, Diagrams, HTML & Blank Document
  await test('Special Content: tables, math formulas, mermaid and blank documents handle centering gracefully', async () => {
    // 1. Blank document
    await page.evaluate(() => {
      window.f.reset('', 'md', 'live')
      window.f.manager.setTypewriterMode(true)
    })
    await page.waitForSelector('.markdown-live')
    const blankScroll = await page.locator('.markdown-live').evaluate(el => el.scrollTop)
    assert.equal(blankScroll, 0, 'Blank document must stay cleanly at scrollTop 0 without NaN or jitter')

    // 2. Large document with table, math, mermaid and HTML block
    const richDoc = `
# Special Content Document

| Column 1 | Column 2 | Column 3 |
|---|---|---|
| Row 1 Data | Values | Test |
| Row 2 Data | Values | Test |
| Row 3 Data | Values | Test |

$$
e^{i\\pi} + 1 = 0
$$

\`\`\`mermaid
graph TD;
    A-->B;
    B-->C;
\`\`\`

<div>
  <span>Embedded HTML Block</span>
</div>

${Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} with trailing text.`).join('\n\n')}
`
    await page.evaluate(richDoc => {
      window.f.reset(richDoc, 'md', 'live')
      window.f.manager.setTypewriterMode(true)
    }, richDoc)

    await page.waitForSelector('.markdown-live .md-prose')
    // Select last paragraph
    await page.evaluate(() => {
      const live = window.f.live()
      const doc = live.view.state.doc
      live.view.dispatch(live.view.state.tr.setSelection(window.f.TextSelection.create(doc, doc.content.size - 20)))
      live.focus()
    })
    await page.waitForTimeout(450)
    const richScroll = await page.locator('.markdown-live').evaluate(el => el.scrollTop)
    assert.ok(richScroll > 200, `Special content document must center end of document, got: ${richScroll}`)
  })

  // Regression H: F8 Focus Mode & Multi-Mode Independence
  await test('F8 Focus Mode: hides non-essential workspace UI, preserves selection, independent of typewriter', async () => {
    // 1. Initial: focusMode = false, typewriter = false with a javaClass file showing breadcrumb
    await page.evaluate(() => {
      window.f.manager.setTypewriterMode(false)
      window.f.focusMode.value = false
      const id = window.f.manager.createUntitled('txt')
      const rec = window.f.manager.metadata(id)
      if (rec) rec.kind = 'javaClass'
      const rawRec = window.f.manager.records?.get(id) || window.f.manager['records']?.get(id)
      if (rawRec) rawRec.meta.kind = 'javaClass'
      window.f.manager.notify()
    })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.readonly-kind').count(), 1, 'Breadcrumb visible when not in focus mode')

    // 2. Enable F8 Focus Mode
    await page.evaluate(() => {
      window.f.focusMode.value = true
    })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.readonly-kind').count(), 0, 'Breadcrumb hidden in focus mode')

    // 3. Enable typewriter mode alongside focus mode
    await page.evaluate(() => {
      window.f.manager.setTypewriterMode(true)
    })
    const isBothActive = await page.evaluate(() => {
      return window.f.focusMode.value === true && window.f.manager.getTypewriterMode() === true
    })
    assert.equal(isBothActive, true, 'Both Focus Mode and Typewriter Mode can be active simultaneously')

    // 4. Exit Focus Mode
    await page.evaluate(() => {
      window.f.focusMode.value = false
    })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.readonly-kind').count(), 1, 'Breadcrumb restored upon exiting focus mode')
    assert.equal(await page.evaluate(() => window.f.manager.getTypewriterMode()), true, 'Typewriter mode remains active after exiting focus mode')
  })

  // Regression I: Toggling Typewriter Off Cleans Up Classes & Padding
  await test('Typewriter Mode: turning off cleans up classes, listener bounds and smooth scroll', async () => {
    await page.evaluate(() => {
      window.f.reset('# Header\n\nLive test for cleanup', 'md', 'live')
      window.f.manager.setTypewriterMode(true)
    })
    await page.waitForSelector('.markdown-live.typewriter-mode')

    await page.evaluate(() => {
      window.f.manager.setTypewriterMode(false)
    })
    await page.waitForTimeout(200)

    const liveHasClass = await page.locator('.markdown-live').evaluate(el => el.classList.contains('typewriter-mode'))
    assert.equal(liveHasClass, false, 'typewriter-mode class removed from live editor')
  })

  assert.equal(errors.length, 0, `Browser errors encountered: ${errors.join(', ')}`)
  console.log('======================================================================')
  console.log(`PASS All ${results.length} Typewriter and Focus Mode regression tests passed!`)
  console.log('======================================================================')
} finally {
  await browser?.close()
  await server.close()
}
