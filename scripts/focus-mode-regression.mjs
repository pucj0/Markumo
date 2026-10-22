import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/focus-mode'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { createApp } from 'vue'
import { EditorSelection } from '@codemirror/state'
import { TextSelection } from 'prosemirror-state'
import App from '/src/App.vue'
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/styles/main.css'
mockWindows('main')
mockIPC(async(command,args)=>{
  if(command==='plugin:event|listen')return args.handler
  if(command==='load_editor_settings')return {externalFileMonitoring:false,autoCheckUpdates:false}
  if(command==='initialize_launch')return {kind:'app',ownsSession:true,files:{files:[],errors:[]},roots:[],activePath:null,layout:{mode:'workspace',sidebarVisible:true},warnings:[]}
  if(command==='file_preferences')return {recent:[],layout:{mode:'workspace',sidebarVisible:true}}
  if(command==='get_recent_workspaces')return []
  if(command==='drain_pending')return {files:[],errors:[]}
  if(command==='update_runtime')return {version:'1.0.5',platform:'linux',installSupported:false}
  if(command==='recovery_list')return {records:[],warnings:[]}
  if(['confirm_update_startup','plugin:event|unlisten','plugin:window|set_theme','report_update_window','save_editor_settings','persist_layout','persist_session','release_file','watch_external_files','cancel_workspace_search'].includes(command))return
  throw Error('Unexpected focus fixture IPC: '+command)
})
const app=createApp(App);app.mount('#app');window.s=app._instance.setupState
window.f={EditorSelection,TextSelection,snapshot(){
  const m=window.s.manager
  return {layout:JSON.stringify(m.layout.root),active:m.activePane,typewriter:m.getTypewriterMode(),
    panes:m.layout.getAllLeafIds().map(id=>{const cm=m.paneView(id),live=m.liveViews.get(id)?.editor
      return {id,selection:cm?cm.state.selection.toJSON():live?.selection,
        scroll:Array.from(document.querySelector('[data-pane-id="'+id+'"]')?.querySelectorAll('.cm-scroller,.markdown-live,.split-preview-content')||[]).map(el=>({top:el.scrollTop,left:el.scrollLeft}))}})}
}}
`)
const server = await createServer({ server: { port: 1465, strictPort: true } })
await server.listen()
let browser
const results = [], errors = []
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://localhost:1465/${output}/index.html`)
  await page.waitForFunction(() => window.s?.settingsReady && !window.s.startupLoading)
  await page.evaluate(() => {
    const m=window.s.manager
    const id=m.createUntitled('md');m.setMarkdownMode(id,'source','main')
    m.dispatch(id,{changes:{from:0,insert:Array.from({length:150},(_,i)=>`Paragraph ${i} text.`).join('\n\n')}})
    const right=m.splitPane('right','main',id);m.setMarkdownMode(id,'live',right)
    const bottom=m.splitPane('down','main',id);m.setMarkdownMode(id,'split',bottom)
    window.f.right=right
  })
  await page.waitForSelector('.markdown-live')
  await page.evaluate(() => {
    const m=window.s.manager,cm=m.paneView('main'),live=m.liveViews.get(window.f.right).editor
    cm.dispatch({selection:window.f.EditorSelection.range(500,520)})
    live.view.dispatch(live.view.state.tr.setSelection(window.f.TextSelection.create(live.view.state.doc,600,615)))
    m.focusPane('main');cm.scrollDOM.scrollTop=250;live.dom.scrollTop=340
    window.f.views=[cm,live]
  })
  await page.waitForTimeout(500)
  const paletteCommand = async title => {
    await page.keyboard.press('Control+Shift+P')
    await page.getByRole('textbox',{name:'搜索文件或命令'}).fill('> '+title)
    await page.locator('.palrow .label').filter({hasText:new RegExp('^'+title+'$')}).click()
    await page.locator('.palette').waitFor({state:'detached'})
  }
  for (const path of ['F8','Escape','dock','palette','explorer']) {
    for (const [sidebar,outline] of [[false,false],[false,true],[true,false],[true,true]]) {
      await page.evaluate(({sidebar,outline}) => {
        window.s.manager.focusPane(outline ? window.f.right : 'main')
        window.s.sidebarVisible=sidebar;window.s.showOutline=outline
      },{sidebar,outline})
      await page.waitForTimeout(150)
      const before=await page.evaluate(()=>window.f.snapshot())
      await page.keyboard.press('F8')
      await page.waitForFunction(()=>window.s.focusMode)
      await page.waitForTimeout(150)
      assert.deepEqual(await page.evaluate(()=>[window.s.sidebarVisible,window.s.outlineVisible]),[false,false])
      assert.equal(await page.evaluate(()=>window.s.showOutline),outline,'Focus masks the outline without changing its persistent preference')
      assert.deepEqual(await page.evaluate(()=>window.f.snapshot()),before,`${path} entering preserves editor state`)
      if(path==='dock')await page.getByTitle('退出专注模式 (Esc / F8)').click()
      else if(path==='palette')await paletteCommand('切换专注模式')
      else if(path==='explorer')await paletteCommand('资源管理器')
      else await page.keyboard.press(path)
      await page.waitForFunction(()=>!window.s.focusMode)
      await page.waitForTimeout(450)
      assert.deepEqual(await page.evaluate(()=>[window.s.sidebarVisible,window.s.showOutline]),[path==='explorer'?true:sidebar,outline],`${path} restores chrome`)
      assert.deepEqual(await page.evaluate(()=>window.f.snapshot()),before,`${path} preserves panes, selection and scroll`)
      assert.equal(await page.evaluate(()=>{const m=window.s.manager;return m.paneView('main')===window.f.views[0]&&m.liveViews.get(window.f.right).editor===window.f.views[1]}),true)
      results.push(`${path}, sidebar=${sidebar}, outline=${outline}`)
      console.log('PASS '+results.at(-1))
    }
  }
  await page.keyboard.press('F9')
  await page.waitForTimeout(500)
  await page.keyboard.press('F8');await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(()=>window.s.manager.getTypewriterMode()),true,'Focus exit keeps typewriter enabled')
  await page.keyboard.press('F9')
  assert.deepEqual(errors,[])
} finally {
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,errors},null,2))
  await browser?.close();await server.close()
}
