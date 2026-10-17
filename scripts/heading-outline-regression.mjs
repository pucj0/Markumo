import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(
  process.env.MARKUMO_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href
    : 'playwright'
)

const output = 'test-results/heading-outline'
fs.mkdirSync(output, { recursive: true })
const module = `fixture-${Date.now()}.ts`

fs.writeFileSync(
  `${output}/fixture.html`,
  `<!doctype html><html><meta charset="utf-8"><body><div id="app" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="./${module}"></script></body></html>`
)

fs.writeFileSync(
  `${output}/${module}`,
  `
import { createApp, h, ref } from 'vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import EditorContainer from '/src/components/layout/EditorContainer.vue';
import '/src/styles/reset.css';
import '/src/styles/variables.css';
import '/src/editor/markdown/styles.css';

const source = \`# 基于SpringBoot+Vue+Uniapp农产品产销对接商城APP

## 一、系统角色介绍

系统总共分成三种角色，分别是
- 用户（消费者）
- 商家
- 管理员

## 二、系统功能介绍

### 2.1、公用功能

- 注册和登录
- 密码修改

## 二、相关亮点

- 亮点一
- 亮点二

## 四、技术栈

- Spring Boot
- Vue 3

## 五、运行环境

- JDK 17
- Node.js
\`;

const manager = new DocumentManager([
  { id: 'md', name: '项目介绍.md', path: 'C:/docs/项目介绍.md', text: source }
]);
manager.open('md', false);
manager.setMarkdownMode('md', 'live');
document.body.classList.add('light');

const rev = ref(0);
manager.subscribe(() => rev.value++);

window.fixture = {
  manager,
  live: () => manager.liveViews.get('main')?.editor,
  view: () => manager.liveViews.get('main')?.editor.view
};

createApp({
  render() {
    rev.value;
    return h(EditorContainer, { doc: manager.activeDocument, manager, showOutline: true, desktop: false });
  }
}).mount('#app');
`
)

const server = await createServer({ server: { port: 1426, strictPort: false } })
await server.listen()
const port = server.httpServer.address().port

let browser
const results = []
const errors = []

async function test(name, run) {
  await run()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}),
  })

  const page = await browser.newPage({ viewport: { width: 1200, height: 780 } })
  page.on('pageerror', error => errors.push(error.message))

  await page.goto(`http://localhost:${port}/${output}/fixture.html`)
  await page.locator('.md-prose').waitFor()
  await page.locator('.outline-container').waitFor()

  await test('1. Heading level indicator (h2) is fully visible and not cut off on the left', async () => {
    // Focus the first H2 heading: "一、系统角色介绍"
    const heading = page.locator('.md-prose h2').first()
    await heading.click()
    await page.waitForFunction(() => document.querySelector('.md-heading-focused') !== null)

    const geom = await page.evaluate(() => {
      const live = document.querySelector('.markdown-live')
      const doc = document.querySelector('.md-document')
      const h = document.querySelector('.md-heading-focused')
      const beforeStyle = h ? window.getComputedStyle(h, '::before') : null

      const rLive = live?.getBoundingClientRect()
      const rDoc = doc?.getBoundingClientRect()
      const rH = h?.getBoundingClientRect()

      // Calculate where the badge sits
      // With right: calc(100% + 8px) and width: 24px:
      // badge right is rH.left - 8px, badge left is rH.left - 32px
      const badgeRight = rH ? rH.left - 8 : 0
      const badgeLeft = rH ? rH.left - 32 : 0

      return {
        liveLeft: rLive?.left ?? 0,
        docLeft: rDoc?.left ?? 0,
        headingLeft: rH?.left ?? 0,
        badgeLeft,
        badgeRight,
        content: beforeStyle?.content,
        width: beforeStyle?.width,
      }
    })

    assert.ok(geom.content?.includes('h2'), 'Badge must display heading level h2')
    // Badge left edge must be strictly inside the .markdown-live viewport with comfortable margin (> 8px)
    assert.ok(
      geom.badgeLeft >= geom.liveLeft + 8,
      `Badge left (${geom.badgeLeft}) must be at least 8px inside live left (${geom.liveLeft}), not cut off`
    )

    // Take screenshot of editor showing the complete h2 badge on the left
    await page.screenshot({ path: `${output}/01-heading-badge-complete.png` })
  })

  await test('2. Outline H2 headings at the same level have identical horizontal alignment (zero false indent)', async () => {
    // Get all H2 items in the outline
    const h2Data = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.outline-item.level-2'))
      return items.map(item => {
        const foldSlot = item.querySelector('.outline-fold-slot')
        const fold = item.querySelector('.outline-fold')
        const label = item.querySelector('.outline-label')
        const rItem = item.getBoundingClientRect()
        const rSlot = foldSlot?.getBoundingClientRect()
        const rLabel = label?.getBoundingClientRect()
        return {
          text: label?.textContent?.trim() || '',
          hasFoldArrow: fold !== null,
          itemLeft: rItem.left,
          slotLeft: rSlot?.left,
          labelLeft: rLabel?.left,
        }
      })
    })

    assert.ok(h2Data.length >= 4, `Expected at least 4 H2 outline items, got ${h2Data.length}`)

    // Item 0: 一、系统角色介绍 (has no subheadings)
    // Item 1: 二、系统功能介绍 (has subheadings)
    // Item 2: 二、相关亮点 (has no subheadings)
    // Item 3: 四、技术栈 (has no subheadings)
    assert.ok(h2Data[0].text.includes('系统角色介绍'))
    assert.ok(h2Data[1].text.includes('系统功能介绍'))
    assert.equal(h2Data[0].hasFoldArrow, false, 'First H2 should not have fold arrow')
    assert.equal(h2Data[1].hasFoldArrow, true, 'Second H2 should have fold arrow')

    // Crucial assertion: All H2 labels must have the EXACT SAME left coordinate
    const baseLabelLeft = h2Data[0].labelLeft
    for (let i = 1; i < h2Data.length; i++) {
      const diff = Math.abs(h2Data[i].labelLeft - baseLabelLeft)
      assert.ok(
        diff <= 1,
        `H2 item "${h2Data[i].text}" labelLeft (${h2Data[i].labelLeft}) must align with base "${h2Data[0].text}" (${baseLabelLeft}), diff: ${diff}px`
      )
    }

    // Crucial assertion: All H2 fold slots must have the EXACT SAME left coordinate
    const baseSlotLeft = h2Data[0].slotLeft
    for (let i = 1; i < h2Data.length; i++) {
      const diff = Math.abs(h2Data[i].slotLeft - baseSlotLeft)
      assert.ok(
        diff <= 1,
        `H2 item "${h2Data[i].text}" slotLeft (${h2Data[i].slotLeft}) must align with base slot (${baseSlotLeft})`
      )
    }

    // Check H3 item: "2.1、公用功能" must be indented further to the right than H2
    const h3Data = await page.evaluate(() => {
      const h3 = document.querySelector('.outline-item.level-3 .outline-label')
      return {
        text: h3?.textContent?.trim(),
        labelLeft: h3?.getBoundingClientRect().left,
      }
    })
    assert.ok(h3Data.text?.includes('公用功能'))
    assert.ok(
      h3Data.labelLeft > baseLabelLeft + 8,
      `H3 label left (${h3Data.labelLeft}) must be indented further than H2 (${baseLabelLeft})`
    )

    // Take screenshot of outline list showing perfect alignment of all H2s
    await page.screenshot({ path: `${output}/02-outline-perfect-alignment.png` })
  })

  await test('3. Collapsing and expanding H2 heading updates subtree without misaligning siblings', async () => {
    // Fold "二、系统功能介绍"
    const foldBtn = page.locator('.outline-item.level-2').nth(1).locator('.outline-fold')
    await foldBtn.click()

    // Subtree "2.1、公用功能" should now be hidden
    assert.equal(await page.locator('.outline-item.level-3').count(), 0)

    // Check all visible H2 items are STILL perfectly aligned
    const labelsLeft = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.outline-item.level-2 .outline-label')).map(
        el => el.getBoundingClientRect().left
      )
    })
    const base = labelsLeft[0]
    for (const left of labelsLeft) {
      assert.ok(Math.abs(left - base) <= 1, 'H2 labels remain aligned when folded')
    }

    // Take screenshot when folded
    await page.screenshot({ path: `${output}/03-outline-folded.png` })

    // Unfold again
    await foldBtn.click()
    assert.equal(await page.locator('.outline-item.level-3').count(), 1)
  })

  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  results.push({ name: 'failure', result: 'FAIL', error: String(error) })
  await page.screenshot({ path: `${output}/failure.png` })
  process.exitCode = 1
} finally {
  await fs.promises.writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2))
  await browser?.close()
  await server.close()
}
