import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = 'test-results/theme', name = `fixture-${Date.now()}`
await mkdir(output, { recursive: true })
await writeFile(`${output}/${name}.html`, `<!doctype html><link rel="icon" type="image/png" href="/favicon.png"><div id="app"></div><script type="module" src="./${name}.ts"></script>`)
await writeFile(`${output}/${name}.ts`, `import {EditorView} from '@codemirror/view'; window.ThemeEditorView=EditorView; import '/src/main.ts';`)
const browser = await chromium.launch({ headless: true, channel: process.env.LIGHTEDIT_TEST_BROWSER || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, colorScheme: 'dark' })
const errors = [], results = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.addInitScript(() => {
  window.themeListeners = new Set()
  const add = MediaQueryList.prototype.addEventListener, remove = MediaQueryList.prototype.removeEventListener
  MediaQueryList.prototype.addEventListener = function(type, listener, options) {
    if (type === 'change' && this.media === '(prefers-color-scheme: dark)') window.themeListeners.add(listener)
    return add.call(this, type, listener, options)
  }
  MediaQueryList.prototype.removeEventListener = function(type, listener, options) {
    if (type === 'change') window.themeListeners.delete(listener)
    return remove.call(this, type, listener, options)
  }
})
const url = `${process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1422'}/${output}/${name}.html`
const editor = () => page.getByRole('textbox', { name: '文本编辑器', exact: true })
const raw = () => page.evaluate(() => {
  const manager = document.querySelector('#app').__vue_app__._instance.setupState.manager
  return manager.getText(manager.activeId)
})
async function selectTheme(theme) {
  await page.getByTitle('设置', { exact: true }).click()
  const select = page.getByLabel('颜色主题', { exact: true })
  assert.deepEqual(await select.locator('option').allTextContents(), ['浅色', '深色', '跟随系统'])
  await select.selectOption(theme)
  await page.getByRole('button', { name: '完成', exact: true }).click()
}
async function appearance(theme) {
  await page.waitForFunction(theme => {
    const m = document.querySelector('#app').__vue_app__._instance.setupState.manager
    return document.body.classList.contains('light') === (theme === 'light') &&
      document.documentElement.style.colorScheme === theme &&
      m.getState(m.activeId).facet(window.ThemeEditorView.darkTheme) === (theme === 'dark')
  }, theme)
}
async function persisted(theme) {
  await page.waitForFunction(theme => JSON.parse(localStorage.getItem('lightedit.settings.v1') || '{}').theme === theme, theme)
}
try {
  await page.goto(url)
  await editor().waitFor()
  await appearance('dark')
  await editor().click(); await page.keyboard.insertText('保留文本和撤销 🚀')
  for (const theme of ['light', 'dark', 'system']) {
    await selectTheme(theme); await appearance(theme === 'system' ? 'dark' : theme)
    assert.equal(await editor().innerText(), '保留文本和撤销 🚀')
  }
  await persisted('system')
  await page.emulateMedia({ colorScheme: 'light' }); await appearance('light')
  await page.emulateMedia({ colorScheme: 'dark' }); await appearance('dark')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lightedit.settings.v1')).theme), 'system')
  await editor().click(); await editor().press('Control+z')
  assert.equal(await raw(), '')
  await editor().press('Control+y'); assert.equal(await editor().innerText(), '保留文本和撤销 🚀')
  await editor().press('Control+z') // Clean document before reload.
  results.push({ name: '系统实时切换、三种设置、CM6 主题及文本/撤销保留', result: 'PASS' })

  await page.reload(); await editor().waitFor(); await appearance('dark')
  await page.getByTitle('设置', { exact: true }).click()
  assert.equal(await page.getByLabel('颜色主题', { exact: true }).inputValue(), 'system')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  for (const theme of ['light', 'dark']) {
    await selectTheme(theme); await persisted(theme)
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' }); await appearance(theme)
    await page.reload(); await editor().waitFor(); await appearance(theme)
  }
  await page.getByTitle('深色 · 切换浅色主题', { exact: true }).click(); await appearance('light')
  await page.getByTitle('浅色 · 切换跟随系统', { exact: true }).click(); await appearance('light')
  await persisted('system')
  await page.getByTitle('跟随系统 · 切换深色主题', { exact: true }).click(); await appearance('dark')
  results.push({ name: '选择持久化/重载、显式主题忽略系统变化、顶部三态循环', result: 'PASS' })

  assert.equal(await page.getByAltText('LightEdit 标志').evaluate(img => img.complete && img.naturalWidth === 256), true)
  assert.equal((await page.request.get(new URL('/favicon.png', url).href)).status(), 200)
  for (const theme of ['dark', 'light']) {
    await selectTheme(theme); await appearance(theme)
    for (const width of [1200, 680]) {
      await page.setViewportSize({ width, height: 780 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.topbar').scrollWidth > document.querySelector('.topbar').clientWidth), false)
      await page.screenshot({ path: `${output}/${theme}-${width}.png` })
    }
  }
  assert.equal(await page.evaluate(() => window.themeListeners.size), 1)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.unmount())
  assert.equal(await page.evaluate(() => window.themeListeners.size), 0)
  results.push({ name: '新 Logo 加载、明暗/680px 布局、主题监听卸载清理', result: 'PASS' })
  assert.deepEqual(errors, [])
  console.log(`PASS ${results.length} theme groups; console/page errors: 0`)
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, browser: browser.version() }, null, 2))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, failure: String(error) }, null, 2))
  throw error
} finally { await browser.close() }
