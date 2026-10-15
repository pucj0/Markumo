import {setMarkdownMode,viewCommand} from './menu-helpers.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { checkSelection } from './selection-checks.mjs'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = 'test-results/selection'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.LIGHTEDIT_TEST_BROWSER || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } })
const results = [], errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const editor = () => page.locator('.main-pane .cm-content')
const text = '0123456789 中文拖选 abcdefghijklmnopqrstuvwxyz\n第二行 keyboard selection abcdefghijklmnopqrstuvwxyz\n第三行'
async function theme(value) {
  await page.getByTitle('设置', { exact: true }).click()
  await page.getByLabel('颜色主题', { exact: true }).selectOption(value)
  await page.getByRole('button', { name: '完成', exact: true }).click()
}
try {
  await page.goto(`${process.env.LIGHTEDIT_TEST_URL || 'http://localhost:1422'}/?demo=1`)
  await editor().waitFor(); await page.keyboard.press('Control+n')
  await editor().click(); await page.keyboard.insertText(text)
  for (const value of ['dark', 'light']) {
    await theme(value)
    await checkSelection(page, { output, name: `${value}-text` })
    results.push({ name: `${value}: 鼠标单行、失焦、键盘及多行选区像素`, result: 'PASS' })
  }
  await editor().focus(); await editor().press('Control+z')
  assert.equal(await page.evaluate(() => { const m = document.querySelector('#app').__vue_app__._instance.setupState.manager; return m.getText(m.activeId) }), '')
  await editor().press('Control+y')
  assert.equal(await editor().innerText(), text)
  await viewCommand(page,'编辑器分栏')
  await page.locator('.secondary-pane .cm-content').waitFor()
  await checkSelection(page, { output, name: 'light-secondary', pane: 'secondary' })
  await viewCommand(page,'编辑器分栏')
  results.push({ name: '双窗格选区、源文本与撤销/重做保留', result: 'PASS' })
  await page.getByRole('tab', { name: /README.md/ }).click()
  await setMarkdownMode(page,'源码')
  await editor().click(); await editor().press('Control+a'); await page.keyboard.insertText(text)
  for (const value of ['dark', 'light']) {
    await theme(value)
    for (const mode of ['源码', '即时排版', '双栏']) {
      await setMarkdownMode(page,mode)
      await checkSelection(page, { output, name: `${value}-md-${mode}` })
    }
    results.push({ name: `${value}: Markdown Source/Live/Split 真实选区像素`, result: 'PASS' })
  }
  assert.deepEqual(errors, [])
  console.log(`PASS ${results.length} selection groups; console/page errors: 0`)
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }); results.push({ result: 'FAIL', error: String(error) }); throw error
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, browser: browser.version() }, null, 2))
  await browser.close()
}
