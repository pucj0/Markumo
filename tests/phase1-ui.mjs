import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'

// Use the desktop runtime's bundled Playwright without adding a production dependency.
// LIGHTEDIT_PLAYWRIGHT_PACKAGE points to a Playwright package.json (Node >= 20).
const require = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.LIGHTEDIT_TEST_BROWSER || undefined })
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } })
const errors = []
const results = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const output = 'test-results/phase1'
await mkdir(output, { recursive: true })
const url = process.env.LIGHTEDIT_TEST_URL || 'http://127.0.0.1:1420'
async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}
async function ready() {
  await page.goto(url)
  await page.locator('.code-pre').waitFor()
}
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 5000 }) }
async function hidden(locator) { await locator.waitFor({ state: 'hidden', timeout: 5000 }) }

try {
  await test('默认代码示例、只读边界和 Markdown 条件工具栏', async () => {
    await ready()
    await visible(page.getByRole('tab', { name: /main.rs/ }))
    await hidden(page.locator('.mdswitch'))
    assert.equal(await page.locator('textarea, [contenteditable="true"]').count(), 0)
    assert.match(await page.locator('.status').innerText(), /只读示例/)
    await page.getByRole('tab', { name: /README.md/ }).click()
    await visible(page.locator('.mdswitch'))
    const source = await page.locator('.code-pre').innerText()
    for (const button of await page.locator('.mdswitch button').all()) assert.equal(await button.isDisabled(), true)
    await page.getByRole('tab', { name: /settings.json/ }).click()
    await hidden(page.locator('.mdswitch'))
    await page.getByRole('tab', { name: /README.md/ }).click()
    assert.equal(await page.locator('.code-pre').innerText(), source)
  })
  await test('示例树折叠、键盘打开、双击固定及标签关闭重开', async () => {
    await page.getByRole('button', { name: '搜索面板占位（Phase 4 接入）' }).click()
    assert.equal(await page.locator('.search-input').isDisabled(), true)
    await page.getByRole('button', { name: '大纲面板占位（Phase 6 接入）' }).click()
    await visible(page.getByText('文档大纲将在 Phase 6 基于 CodeMirror 6 语法树解析实现。'))
    await page.getByRole('button', { name: '文件资源管理器', exact: true }).click()
    const src = page.getByRole('button', { name: 'src', exact: true })
    await src.click()
    await hidden(page.getByRole('button', { name: 'editor', exact: true }))
    await src.press('Enter')
    await visible(page.getByRole('button', { name: 'editor', exact: true }))
    await page.getByRole('button', { name: 'today.txt', exact: true }).press('Enter')
    assert.match(await page.locator('.code-pre').innerText(), /工作笔记/)
    await page.getByRole('tab', { name: /README.md/ }).dblclick()
    assert.equal(await page.getByRole('tab', { name: /README.md/ }).evaluate(el => el.classList.contains('temp')), false)
    await page.getByRole('button', { name: '关闭 today.txt', exact: true }).click()
    await page.getByRole('button', { name: 'today.txt', exact: true }).click()
    assert.match(await page.locator('.code-pre').innerText(), /工作笔记/)
    assert.equal(await page.getByText('Cargo.toml', { exact: true }).count(), 0)
  })
  await test('快捷键、命令过滤索引重置、中文组合输入及空结果', async () => {
    await page.keyboard.press('Control+p')
    const input = page.getByRole('textbox', { name: '搜索示例文件或命令' })
    const selectedBeforeComposition = await page.locator('.palrow.on').innerText()
    await input.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
    assert.equal(await page.locator('.palrow.on').innerText(), selectedBeforeComposition)
    await input.press('ArrowDown')
    await input.press('ArrowDown')
    await input.fill('today')
    await input.press('Enter')
    await hidden(page.locator('.palette'))
    assert.match(await page.locator('.code-pre').innerText(), /工作笔记/)
    await page.keyboard.press('Control+Shift+p')
    await input.fill('单文件')
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await visible(page.locator('.palette'))
    await input.press('Enter')
    await hidden(page.locator('.sidebar-wrapper'))
    await page.keyboard.press('Control+p')
    await input.fill('没有此文件-xyz')
    await visible(page.getByText('没有符合条件的操作或文件'))
    await input.press('Enter')
    await visible(page.locator('.palette'))
    await input.press('Escape')
  })
  await test('设置 Esc、焦点循环、快捷键隔离和恢复焦点', async () => {
    const settings = page.getByRole('button', { name: '设置', exact: true })
    await settings.focus()
    await settings.press('Enter')
    const theme = page.getByRole('combobox', { name: '颜色主题' })
    await theme.waitFor()
    await theme.press('Shift+Tab')
    assert.equal(await page.getByRole('button', { name: '完成' }).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await theme.evaluate(el => el === document.activeElement), true)
    const tabCount = await page.getByRole('tab').count()
    await page.keyboard.press('Control+n')
    assert.equal(await page.getByRole('tab').count(), tabCount)
    await page.keyboard.press('Control+p')
    await hidden(page.locator('.palette'))
    await theme.selectOption('light')
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('light')), true)
    assert.equal(await page.getByRole('combobox', { name: /Markdown 默认模式/ }).isDisabled(), true)
    await page.getByRole('slider', { name: '编辑器字号' }).press('End')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.code-pre')).fontSize === '18px')
    await page.getByRole('checkbox', { name: '显示文档大纲占位' }).check()
    await visible(page.locator('.outline-sidebar'))
    await page.getByRole('checkbox', { name: '自动软换行' }).check()
    assert.equal(await page.locator('.code-viewport').evaluate(el => el.classList.contains('wrap')), true)
    await page.getByRole('checkbox', { name: '自动软换行' }).uncheck()
    await page.keyboard.press('Escape')
    await hidden(page.locator('.settings'))
    assert.equal(await settings.evaluate(el => el === document.activeElement), true)
    await page.getByRole('button', { name: '关闭大纲' }).click()
    await hidden(page.locator('.outline-sidebar'))
  })
  await test('侧栏 190–420 边界、键盘调宽及拖拽卸载清理', async () => {
    await page.getByRole('button', { name: '工作区', exact: true }).click()
    const handle = page.getByRole('separator', { name: '调整侧边栏宽度' })
    let box = await handle.boundingBox()
    await page.mouse.move(box.x + 2, box.y + 100)
    await page.mouse.down()
    await page.mouse.move(1100, box.y + 100)
    assert.equal(await handle.getAttribute('aria-valuenow'), '420')
    await page.mouse.move(10, box.y + 100)
    assert.equal(await handle.getAttribute('aria-valuenow'), '190')
    await page.mouse.up()
    await handle.press('ArrowRight')
    assert.equal(await handle.getAttribute('aria-valuenow'), '200')
    box = await handle.boundingBox()
    await page.mouse.move(box.x + 2, box.y + 100)
    await page.mouse.down()
    await page.keyboard.press('Control+b')
    await page.mouse.move(700, box.y + 100)
    await page.mouse.up()
    assert.equal(await page.locator('body').evaluate(el => el.style.cursor), '')
    await page.keyboard.press('Control+b')
    assert.equal(await handle.getAttribute('aria-valuenow'), '200')
  })
  await test('新建和关闭不积累草稿、专注模式退出、软换行布局', async () => {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Control+n')
      await visible(page.getByRole('tab', { name: /Untitled-1.txt/ }))
      await page.getByRole('button', { name: '关闭 Untitled-1.txt' }).click()
    }
    await page.keyboard.press('Control+p')
    await page.getByRole('textbox').fill('Untitled')
    await visible(page.getByText('没有符合条件的操作或文件'))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '专注模式', exact: true }).click()
    await hidden(page.locator('.topbar'))
    await page.keyboard.press('Escape')
    await visible(page.locator('.topbar'))
    await page.getByRole('button', { name: '软换行', exact: true }).click()
    await hidden(page.locator('.linenums'))
    assert.equal(await page.locator('.code-pre').evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap')
  })
  await test('明暗主题和窄窗口/缩放等效尺寸无页面及工具栏溢出', async () => {
    await ready()
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换浅色主题' }).click()
      await page.getByRole('tab', { name: /README.md/ }).click()
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('.quickbtn')).backgroundColor === expected,
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(25, 28, 34)')
      for (const [width, height] of [[1200, 780], [960, 624], [800, 520], [680, 480], [453, 320]]) {
        await page.setViewportSize({ width, height })
        const metrics = await page.evaluate(() => {
          const within = selector => {
            const el = document.querySelector(selector)
            const r = el.getBoundingClientRect()
            return r.left >= -1 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1
          }
          return { page: document.documentElement.scrollWidth <= innerWidth, top: within('.topbar'), tools: within('.toolrow'), editor: document.querySelector('.editor-main').clientWidth }
        })
        assert.equal(metrics.page && metrics.top && metrics.tools, true, JSON.stringify({ width, theme, metrics }))
        assert.ok(metrics.editor >= 350, JSON.stringify(metrics))
        await page.screenshot({ path: `${output}/${theme}-${width}.png`, animations: 'disabled' })
      }
    }
  })
  await test('关闭所有标签的空状态及重新新建', async () => {
    await page.setViewportSize({ width: 1200, height: 780 })
    while (await page.locator('.tab .tinyclose').count()) await page.locator('.tab .tinyclose').first().click()
    await visible(page.locator('.empty-state'))
    await page.keyboard.press('Control+n')
    await visible(page.locator('.code-viewport'))
    await hidden(page.locator('.empty-state'))
  })
  assert.deepEqual(errors, [], '浏览器控制台或未捕获异常')
  await writeFile(`${output}/results.json`, JSON.stringify({ url, browser: browser.version(), node: process.version, results, errors }, null, 2))
  console.log(`PASS ${results.length} groups; console/page errors: 0`)
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` })
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, failure: String(error) }, null, 2))
  throw error
} finally {
  await browser.close()
}
