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
import { isSmoothScrolling } from '/src/editor/core/smoothScroll.ts'
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import '/src/styles/main.css'

// Count actual registrations by target, callback and capture mode for cleanup checks.
const listeners = new WeakMap()
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener
for (const [name, original] of [['addEventListener', add], ['removeEventListener', remove]]) {
  EventTarget.prototype[name] = function(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture
    let entries = listeners.get(this)
    if (!entries) listeners.set(this, entries = new Map())
    const key = type + ':' + capture
    if (!entries.has(key)) entries.set(key, new Set())
    if (name === 'addEventListener') entries.get(key).add(callback)
    else entries.get(key).delete(callback)
    return original.call(this, type, callback, options)
  }
}
const manager = new DocumentManager([], async () => [])
const revision = ref(0)
manager.subscribe(() => revision.value++)

createApp({
  render() {
    revision.value
    return h(SplitLayoutNode, {
      manager: markRaw(manager),
      node: manager.layout.root,
      revision: revision.value,
      desktop: false,
    })
  },
}).mount('#app')

window.f = {
  manager,
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
  isSmoothScrolling,
  listenerCount: target => [...(listeners.get(target)?.values() || [])].reduce((sum, entries) => sum + entries.size, 0),
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
    ignoreDefaultArgs: ['--hide-scrollbars'],
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
  const cdp = await page.context().newCDPSession(page)
  const settled = () => page.waitForTimeout(650)
  const caretOffset = () => page.evaluate(() => {
    const cm = window.f.cm(), live = window.f.live()
    const host = cm?.scrollDOM || live.dom
    // Read editor coordinates directly, independently of the production helper.
    const nestedRoot = document.activeElement?.closest('.cm-editor')
    const nested = !cm && nestedRoot ? window.f.CM.findFromDOM(nestedRoot) : null
    const caret = cm ? cm.coordsAtPos(cm.state.selection.main.head)
      : nested ? nested.coordsAtPos(nested.state.selection.main.head)
      : live.view.coordsAtPos(live.view.state.selection.head)
    return (caret.top + caret.bottom) / 2 - host.getBoundingClientRect().top - host.getBoundingClientRect().height * window.f.TYPEWRITER_RATIO
  })

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
    const scroller = page.locator('.cm-scroller')
    await scroller.hover();await page.mouse.wheel(0, -150);await page.waitForTimeout(150)
    const manual = await scroller.evaluate(el => el.scrollTop)
    await settled()
    assert.equal(await scroller.evaluate(el => el.scrollTop), manual, 'Real wheel position stays put')
    await page.keyboard.type('Typing ');await settled()
    assert.ok(Math.abs(await caretOffset()) <= 20, 'Real keyboard input resumes caret alignment')
  })

  // Regression C: Continuous 100 lines input & rapid line insertions without oscillation
  await test('Programmatic edits: 100 line insertions maintain bounded vertical alignment', async () => {
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
    const codeDoc = Array.from({length:20},(_,i)=>`Intro ${i}`).join('\n\n')+'\n\n```javascript\n'+Array.from({length:65},(_,i)=>`const value${i} = ${i};`).join('\n')+'\n```\n\nTail paragraph.'
    await page.evaluate(codeDoc => {
      window.f.reset(codeDoc, 'md', 'live')
      window.f.manager.setTypewriterMode(true)
    }, codeDoc)

    await page.waitForSelector('.markdown-live .md-code-block .cm-editor')
    await page.locator('.markdown-live .md-code-block .cm-line').first().click()
    await page.keyboard.press('Control+End');await page.keyboard.type(' // actual input');await settled()
    assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.cm-editor')),true)
    assert.ok(Math.abs(await caretOffset()) <= 20, 'Outer Live scroller centers the embedded CM caret, not the block top')
  })

  // Regression F: IME Composition Guard
  for (const mode of ['source','live']) {
    await test(`${mode}: browser IME, real wheel and scrollbar drag suspend follow; keyboard resumes`, async () => {
      await page.evaluate(mode => {window.f.reset(Array.from({length:100},(_,i)=>`Paragraph ${i} with text.`).join('\n\n'),'md',mode);window.f.manager.setTypewriterMode(true)},mode)
      const host = page.locator(mode==='source'?'.cm-scroller':'.markdown-live')
      await host.waitFor()
      await page.evaluate(()=>{
        const cm=window.f.cm(),live=window.f.live()
        if(cm){cm.dispatch({selection:window.f.EditorSelection.cursor(cm.state.doc.line(81).from)});cm.focus()}
        else {live.view.dispatch(live.view.state.tr.setSelection(window.f.TextSelection.create(live.view.state.doc,1000)));live.focus()}
      })
      await settled()
      await host.hover();await page.mouse.wheel(0,120);await page.waitForTimeout(180)
      const before=await host.evaluate(el=>el.scrollTop)
      await cdp.send('Input.imeSetComposition',{text:'中',selectionStart:1,selectionEnd:1})
      await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2})
      await page.waitForTimeout(200)
      assert.equal(await page.evaluate(()=>window.f.cm()?.composing||window.f.live()?.composing),true,'Browser actually entered IME composition')
      assert.ok(Math.abs(await host.evaluate(el=>el.scrollTop)-before)<=2,'Chinese composition must not steal scroll')
      await cdp.send('Input.insertText',{text:'中文'});await settled()
      await page.keyboard.type('x');await settled()
      assert.ok(Math.abs(await caretOffset())<=20,'Keyboard after IME aligns caret')
      assert.ok(await page.evaluate(()=>window.f.manager.getText(window.f.manager.activeId).includes('中文')),'Chinese text committed through browser input')

      // A native scrollbar, with a stable gutter so Chromium exposes a draggable thumb.
      await page.addStyleTag({content:'.cm-scroller,.markdown-live{scrollbar-width:auto!important;scrollbar-gutter:stable} .cm-scroller::-webkit-scrollbar,.markdown-live::-webkit-scrollbar{width:16px}'})
      await settled()
      const bar=await host.evaluate(el=>{const r=el.getBoundingClientRect(),track=el.clientHeight-32,height=Math.max(17,track*el.clientHeight/el.scrollHeight);return {x:r.left+el.clientWidth+8,y:r.top+16+(track-height)*el.scrollTop/(el.scrollHeight-el.clientHeight)+height/2,top:el.scrollTop,width:r.width,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight}})
      await page.screenshot({path:`${output}/scrollbar-${mode}.png`})
      await page.mouse.move(bar.x,bar.y);await page.mouse.down();await page.mouse.move(bar.x,bar.y+90,{steps:12})
      await page.waitForTimeout(150)
      const dragged=await host.evaluate(el=>el.scrollTop)
      assert.ok(Math.abs(dragged-bar.top)>40,`Native scrollbar drag changes scroll coordinate: ${JSON.stringify({bar,dragged})}`)
      await settled()
      assert.equal(await host.evaluate(el=>el.scrollTop),dragged,'No recenter while thumb held')
      await page.mouse.up();await settled()
      assert.equal(await host.evaluate(el=>el.scrollTop),dragged,'No recenter after thumb release')
      // Chromium focuses the native scrollbar's scroller. Return editing focus
      // without changing the selection or scroll, then send real key events.
      await host.evaluate(el=>el.querySelector('[contenteditable="true"]').focus({preventScroll:true}))
      await settled()
      assert.equal(await host.evaluate(el=>el.scrollTop),dragged,'Focus alone does not resume follow')
      await page.keyboard.type('y');await settled()
      const offset=await caretOffset()
      assert.ok(Math.abs(offset)<=20,`Real typing resumes after scrollbar drag: ${JSON.stringify(await page.evaluate(offset=>({offset,focus:document.activeElement?.outerHTML.slice(0,150),top:(window.f.cm()?.scrollDOM||window.f.live().dom).scrollTop,text:window.f.manager.getText(window.f.manager.activeId).includes('中文xy')}),offset))}`)
    })
  }

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

  for (const mode of ['source','live']) {
    await test(`${mode}: disabling during animation releases listeners, pending frames and scroll`, async () => {
      await page.evaluate(mode=>{window.f.manager.setTypewriterMode(false);window.f.reset(Array.from({length:100},(_,i)=>`Cleanup paragraph ${i}`).join('\n\n'),'md',mode)},mode)
      await page.waitForSelector(mode==='source'?'.cm-editor':'.markdown-live');await settled()
      const baseline=await page.evaluate(()=>{const host=window.f.cm()?.scrollDOM||window.f.live().dom;return {host:window.f.listenerCount(host),window:window.f.listenerCount(window)}})
      await page.evaluate(()=>{
        window.f.manager.setTypewriterMode(true)
        const cm=window.f.cm(),live=window.f.live()
        if(cm){cm.focus();cm.dispatch({selection:window.f.EditorSelection.cursor(cm.state.doc.line(160).from)})}
        else {live.focus();live.view.dispatch(live.view.state.tr.setSelection(window.f.TextSelection.create(live.view.state.doc,2000)))}
      })
      await page.waitForFunction(()=>window.f.isSmoothScrolling(window.f.cm()?.scrollDOM||window.f.live().dom))
      const disabled=await page.evaluate(()=>{
        window.f.manager.setTypewriterMode(false)
        const host=window.f.cm()?.scrollDOM||window.f.live().dom
        return {host:window.f.listenerCount(host),window:window.f.listenerCount(window),animating:window.f.isSmoothScrolling(host),frame:window.f.live()?.typewriterAlignFrame||0}
      })
      assert.deepEqual(disabled,{...baseline,animating:false,frame:0},'Actual registrations return to disabled baseline')
      await settled()
      const top=await page.evaluate(()=>(window.f.cm()?.scrollDOM||window.f.live().dom).scrollTop)
      await settled()
      assert.equal(await page.evaluate(()=>(window.f.cm()?.scrollDOM||window.f.live().dom).scrollTop),top,'No stale animation after disable')
    })
  }

  for (const mode of ['source','live']) {
    await test(`${mode}: switching split panes scrolls only the active editor`, async () => {
      await page.evaluate(mode=>{
        const m=window.f.manager;m.setTypewriterMode(false)
        const id=window.f.reset(Array.from({length:150},(_,i)=>`Split paragraph ${i}`).join('\n\n'),'md',mode)
        window.f.other=m.splitPane('right','main',id);m.setMarkdownMode(id,mode,window.f.other)
      },mode)
      await page.waitForFunction(mode=>mode==='source'?document.querySelectorAll('.cm-editor').length===2:document.querySelectorAll('.markdown-live').length===2,mode)
      await settled()
      await page.evaluate(()=>{window.f.manager.focusPane('main');window.f.manager.setTypewriterMode(true)})
      await settled()
      const scrolls=()=>page.evaluate(()=>window.f.manager.layout.getAllLeafIds().map(id=>{const m=window.f.manager;return (m.paneView(id)?.scrollDOM||m.liveViews.get(id).editor.dom).scrollTop}))
      const before=await scrolls()
      await page.keyboard.press('Control+End');await page.keyboard.type('active main');await settled()
      const first=await scrolls()
      assert.ok(first[0]>before[0]+100);assert.equal(first[1],before[1],'Inactive pane ignores edits propagated from main')
      // Activate the other pane with a real click, then type through the keyboard.
      await page.locator(`[data-pane-id="${await page.evaluate(()=>window.f.other)}"] ${mode==='source'?'.cm-content':'.md-document'}`).click({position:{x:50,y:80}})
      await page.keyboard.press('Control+End');await page.keyboard.type('active right');await settled()
      const second=await scrolls()
      assert.equal(second[0],first[0],'Previous pane does not scroll after activation switches')
      assert.ok(second[1]>first[1]+100)
      await page.evaluate(()=>{const m=window.f.manager;m.setTypewriterMode(false);m.closePane(window.f.other);m.focusPane('main')})
      await settled()
    })
  }

  assert.equal(errors.length, 0, `Browser errors encountered: ${errors.join(', ')}`)
  console.log('======================================================================')
  console.log(`PASS All ${results.length} Typewriter regression groups passed!`)
  console.log('======================================================================')
} finally {
  await browser?.close()
  await server.close()
}
