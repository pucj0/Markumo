// Bare URL incremental editing: source text, visible link range and real href.
//
// Every case asserts the three things that can drift apart:
//   1. the Markdown source that would be written to disk,
//   2. which characters the editor paints as a link,
//   3. the destination actually reachable through a[href].
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/autolink'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/src/styles/reset.css">
<link rel="stylesheet" href="/src/styles/variables.css">
<link rel="stylesheet" href="/src/editor/markdown/styles.css">
<link rel="stylesheet" href="/src/editor/markdown/presentation.css">
<link rel="stylesheet" href="/src/editor/markdown/wysiwyg/MarkdownTheme.css">
<div id="app" class="markdown-live" style="display:flex;height:720px"></div>
<script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>`)

const server = await createServer({
  server: { host: '127.0.0.1', port: 1453, strictPort: true, hmr: false, watch: null }
})
await server.listen()

let browser
const results = []
const test = async (name, run) => {
  await run()
  results.push(name)
  console.log('PASS ' + name)
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {})
  })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(30000)

  await page.goto('http://127.0.0.1:1453/test-results/autolink/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  /** Source text, painted link spans and their real hrefs, all at once. */
  const snapshot = async () => {
    await page.waitForSelector('.markdown-live .ProseMirror', { state: 'attached' })
    await page.waitForTimeout(50)
    return page.evaluate(() => {
      const root = document.querySelector('.markdown-live .ProseMirror')
      const anchors = [...root.querySelectorAll('a')].map(a => ({
        text: a.textContent,
        href: a.getAttribute('href'),
        dataHref: a.getAttribute('data-href'),
        autolink: a.getAttribute('data-autolink'),
      }))
      return { source: window.f.source(), anchors, text: root.textContent }
    })
  }

  /** Types at the end of a literal string, like a user would. */
  const typeAtEndOf = async (needle, insert) => {
    await page.evaluate(([needle, insert]) => {
      const m = window.f.manager
      const id = m.activeId
      const at = m.getText(id).indexOf(needle) + needle.length
      m.dispatch(id, { changes: { from: at, insert }, userEvent: 'input.type' })
    }, [needle, insert])
    await page.waitForTimeout(60)
  }

  await test('1. pasting a bare URL links the whole URL and keeps the source bare', async () => {
    await page.evaluate(() => window.f.reset('前缀 后缀', false))
    await typeAtEndOf('前缀', ' https://yuanmahome.cn/originalDetail?id=2113188155363074049')
    const state = await snapshot()
    assert.equal(state.source, '前缀 https://yuanmahome.cn/originalDetail?id=2113188155363074049 后缀')
    assert.equal(state.anchors.length, 1)
    assert.equal(state.anchors[0].text, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')
    assert.equal(state.anchors[0].href, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')
    assert.equal(state.anchors[0].autolink, 'bare')
  })

  await test('2. typing an id after ?id= extends the same link instead of splitting it', async () => {
    await page.evaluate(() => window.f.reset('文本 https://yuanmahome.cn/originalDetail?id= 结束', false))
    await typeAtEndOf('?id=', '2113188155363074049')
    const state = await snapshot()
    assert.equal(state.source, '文本 https://yuanmahome.cn/originalDetail?id=2113188155363074049 结束')
    assert.equal(state.anchors.length, 1, 'exactly one link, never a half-linked URL')
    assert.equal(state.anchors[0].text, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')
    assert.equal(state.anchors[0].href, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')
  })

  await test('3. appending more query parameters keeps href in step with the text', async () => {
    await page.evaluate(() => window.f.reset('文本 https://yuanmahome.cn/p?id=1 结束', false))
    await typeAtEndOf('?id=1', '&name=test#frag')
    const state = await snapshot()
    assert.equal(state.source, '文本 https://yuanmahome.cn/p?id=1&name=test#frag 结束')
    assert.equal(state.anchors[0].text, 'https://yuanmahome.cn/p?id=1&name=test#frag')
    assert.equal(state.anchors[0].href, 'https://yuanmahome.cn/p?id=1&name=test#frag')
  })

  await test('4. editing inside an existing URL updates href, not just the paint', async () => {
    await page.evaluate(() => window.f.reset('文本 https://yuanmahome.cn/originalDetail?id=42 结束', false))
    await page.evaluate(() => {
      const m = window.f.manager, id = m.activeId
      const at = m.getText(id).indexOf('originalDetail') + 8
      m.dispatch(id, { changes: { from: at, insert: 'X' }, userEvent: 'input.type' })
    })
    await page.waitForTimeout(60)
    const state = await snapshot()
    assert.equal(state.source, '文本 https://yuanmahome.cn/originalXDetail?id=42 结束')
    assert.equal(state.anchors.length, 1)
    assert.equal(state.anchors[0].text, 'https://yuanmahome.cn/originalXDetail?id=42')
    assert.equal(state.anchors[0].href, 'https://yuanmahome.cn/originalXDetail?id=42')
  })

  await test('5. deleting part of a query shrinks the link and its href', async () => {
    await page.evaluate(() => window.f.reset('文本 https://yuanmahome.cn/p?id=123456&x=1 结束', false))
    await page.evaluate(() => {
      const m = window.f.manager, id = m.activeId
      const at = m.getText(id).indexOf('123456')
      m.dispatch(id, { changes: { from: at, to: at + 6, insert: '9' }, userEvent: 'delete' })
    })
    await page.waitForTimeout(60)
    const state = await snapshot()
    assert.equal(state.source, '文本 https://yuanmahome.cn/p?id=9&x=1 结束')
    assert.equal(state.anchors[0].text, 'https://yuanmahome.cn/p?id=9&x=1')
    assert.equal(state.anchors[0].href, 'https://yuanmahome.cn/p?id=9&x=1')
  })

  await test('6. a URL next to Chinese text links one contiguous span whose href resolves to its text', async () => {
    // Linkify (like GFM) treats non-ASCII as legal IRI characters, so text typed
    // with no separator continues the URL and the destination is percent-encoded
    // for the browser. What must never happen is a stale destination or a
    // rewritten source.
    await page.evaluate(() => window.f.reset('中文紧邻https://a.cn/p?id=7后置中文', false))
    const state = await snapshot()
    assert.equal(state.source, '中文紧邻https://a.cn/p?id=7后置中文')
    assert.equal(state.anchors.length, 1)
    const anchor = state.anchors[0]
    assert.ok(anchor.text.startsWith('https://a.cn/p?id=7'), 'the link starts at the URL')
    assert.equal(decodeURI(anchor.href), anchor.text, 'href always resolves to the painted text')
    assert.ok(state.text.startsWith('中文紧邻'), 'the leading Chinese text stays plain')

    // Editing that block must keep the bare spelling, not expand it into
    // `[text](encoded-url)`.
    await page.evaluate(() => {
      const m = window.f.manager, id = m.activeId
      const at = m.getText(id).length
      m.dispatch(id, { changes: { from: at, insert: '！' }, userEvent: 'input.type' })
    })
    await page.waitForTimeout(60)
    const edited = await snapshot()
    assert.ok(edited.source.includes('https://a.cn/p?id=7后置中文！'), 'the bare URL survives an edit in its block')
    assert.ok(!edited.source.includes('](https://'), 'a bare URL is never expanded into an explicit link')

    // A separator must end the URL exactly as it did before the edit.
    await page.evaluate(() => window.f.reset('中文紧邻 https://a.cn/p?id=7 后置中文', false))
    const spaced = await snapshot()
    assert.equal(spaced.anchors.length, 1)
    assert.equal(spaced.anchors[0].text, 'https://a.cn/p?id=7')
    assert.equal(spaced.anchors[0].href, 'https://a.cn/p?id=7')
  })

  await test('7. a URL inside a table cell links only inside the cell', async () => {
    await page.evaluate(() => window.f.reset('| 站点 | 备注 |\n| --- | --- |\n| https://a.cn/p?id= | 无 |', false))
    const state = await snapshot()
    assert.equal(state.anchors.length, 1)
    assert.equal(state.anchors[0].text, 'https://a.cn/p?id=')
    assert.equal(state.anchors[0].href, 'https://a.cn/p?id=')
    assert.equal(state.source, '| 站点 | 备注 |\n| --- | --- |\n| https://a.cn/p?id= | 无 |')
  })

  await test('8. URLs in lists and blockquotes link without changing the source', async () => {
    await page.evaluate(() => window.f.reset('- 列表 https://a.cn/l?id=1\n\n> 引用 https://a.cn/q?id=2', false))
    const state = await snapshot()
    assert.equal(state.anchors.length, 2)
    assert.deepEqual(state.anchors.map(a => a.text), ['https://a.cn/l?id=1', 'https://a.cn/q?id=2'])
    assert.deepEqual(state.anchors.map(a => a.href), ['https://a.cn/l?id=1', 'https://a.cn/q?id=2'])
    assert.equal(state.source, '- 列表 https://a.cn/l?id=1\n\n> 引用 https://a.cn/q?id=2')
  })

  await test('9. URLs in fenced code and inline code are never linked', async () => {
    await page.evaluate(() => window.f.reset('```\nhttps://a.cn/x?id=1\n```\n\n`https://a.cn/y?id=2`', false))
    const state = await snapshot()
    assert.equal(state.anchors.length, 0)
    assert.equal(state.source, '```\nhttps://a.cn/x?id=1\n```\n\n`https://a.cn/y?id=2`')
  })

  await test('10. Live, Source and Split agree and none of them rewrite the source', async () => {
    const source = '文本 https://yuanmahome.cn/originalDetail?id=2113188155363074049 结束'
    await page.evaluate(src => window.f.reset(src, true), source)
    const live = await snapshot()
    assert.equal(live.anchors[0].href, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')

    await page.evaluate(() => { const m = window.f.manager; m.setMarkdownMode(window.f.id, 'source') })
    await page.waitForFunction(() => !!document.querySelector('.cm-content'))
    assert.equal(await page.evaluate(() => window.f.source()), source)

    await page.evaluate(() => { const m = window.f.manager; m.setMarkdownMode(window.f.id, 'live') })
    await page.waitForFunction(() => !!window.f?.ready())
    const back = await snapshot()
    assert.equal(back.source, source)
    assert.equal(back.anchors[0].text, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')
    assert.equal(back.anchors[0].href, 'https://yuanmahome.cn/originalDetail?id=2113188155363074049')
  })

  await test('11. the link survives a save-style reopen with href unchanged', async () => {
    const source = '保存 https://yuanmahome.cn/originalDetail?id=2113188155363074049 结束'
    const reopened = await page.evaluate(async src => {
      const { parseMarkdown } = await import('/src/editor/markdown/wysiwyg/MarkdownParser.ts')
      const { markdownSerializer } = await import('/src/editor/markdown/wysiwyg/MarkdownSerializer.ts')
      const doc = parseMarkdown(src).doc
      const links = []
      doc.descendants(node => {
        if (!node.isText) return
        for (const mark of node.marks) if (mark.type.name === 'link') links.push({ text: node.text, href: mark.attrs.href })
      })
      return { out: markdownSerializer.serialize(doc), links }
    }, source)
    assert.equal(reopened.out, source, 'reopening must not rewrite a bare URL')
    assert.deepEqual(reopened.links, [{ text: 'https://yuanmahome.cn/originalDetail?id=2113188155363074049', href: 'https://yuanmahome.cn/originalDetail?id=2113188155363074049' }])
  })

  await test('12. undo and redo change the source like one ordinary edit', async () => {
    await page.evaluate(() => window.f.reset('文本 https://a.cn/p?id= 结束', false))
    await typeAtEndOf('?id=', '77')
    assert.equal((await snapshot()).source, '文本 https://a.cn/p?id=77 结束')
    await page.evaluate(() => window.f.undo())
    await page.waitForTimeout(60)
    assert.equal((await snapshot()).source, '文本 https://a.cn/p?id= 结束')
    await page.evaluate(() => window.f.redo())
    await page.waitForTimeout(60)
    const redone = await snapshot()
    assert.equal(redone.source, '文本 https://a.cn/p?id=77 结束')
    assert.equal(redone.anchors[0].href, 'https://a.cn/p?id=77')
  })

  await test('13. unsafe protocols never become executable links', async () => {
    await page.evaluate(() => window.f.reset('x javascript:alert(1) 文本', false))
    const state = await snapshot()
    assert.equal(state.anchors.length, 0, 'no anchor for javascript:')
    assert.equal(state.source, 'x javascript:alert(1) 文本')
  })

  await test('14. an explicit link keeps its own label and destination', async () => {
    await page.evaluate(() => window.f.reset('说明 [自定义文字](https://a.cn/x?id=1) 结尾', false))
    await page.evaluate(() => {
      const m = window.f.manager, id = m.activeId
      const at = m.getText(id).indexOf('自定义文字') + 5
      m.dispatch(id, { changes: { from: at, insert: '补充' }, userEvent: 'input.type' })
    })
    await page.waitForTimeout(60)
    const state = await snapshot()
    assert.equal(state.source, '说明 [自定义文字补充](https://a.cn/x?id=1) 结尾')
    assert.equal(state.anchors.length, 1)
    assert.equal(state.anchors[0].text, '自定义文字补充')
    assert.equal(state.anchors[0].href, 'https://a.cn/x?id=1')
    assert.equal(state.anchors[0].autolink, 'none', 'an explicit link is never re-spelled as a bare URL')
  })

  await test('15. replacing a selected part of a URL rewrites text and href together', async () => {
    await page.evaluate(() => window.f.reset('文本 https://yuanmahome.cn/originalDetail?id=42 结束', false))
    // Replace `originalDetail` exactly as a user would: select, then type.
    await page.evaluate(() => {
      const m = window.f.manager, id = m.activeId
      const text = m.getText(id)
      const from = text.indexOf('originalDetail')
      m.dispatch(id, {
        changes: { from, to: from + 'originalDetail'.length, insert: 'itemDetail' },
        userEvent: 'input.type',
      })
    })
    await page.waitForTimeout(60)
    const state = await snapshot()
    assert.equal(state.source, '文本 https://yuanmahome.cn/itemDetail?id=42 结束')
    assert.equal(state.anchors.length, 1)
    assert.equal(state.anchors[0].text, 'https://yuanmahome.cn/itemDetail?id=42')
    assert.equal(state.anchors[0].href, 'https://yuanmahome.cn/itemDetail?id=42')
    assert.equal(state.anchors[0].autolink, 'bare')
  })

  await test('16. a percent-encoded query keeps its exact spelling and stays one link', async () => {
    const source = '查询 https://a.cn/search?q=hello%20world&tag=%E4%B8%AD%E6%96%87 结束'
    await page.evaluate(src => window.f.reset(src, false), source)
    const state = await snapshot()
    assert.equal(state.source, source, 'a percent-encoded URL is never rewritten')
    assert.equal(state.anchors.length, 1)
    // The painted text and the destination are the same raw URL: decoding the
    // label would corrupt the source on the next edit.
    assert.equal(state.anchors[0].text, 'https://a.cn/search?q=hello%20world&tag=%E4%B8%AD%E6%96%87')
    assert.equal(state.anchors[0].href, state.anchors[0].text)
    // Editing after the encoded part still extends the same link.
    await page.evaluate(() => {
      const m = window.f.manager, id = m.activeId
      const at = m.getText(id).indexOf('%E4%B8%AD%E6%96%87') + '%E4%B8%AD%E6%96%87'.length
      m.dispatch(id, { changes: { from: at, insert: '&page=2' }, userEvent: 'input.type' })
    })
    await page.waitForTimeout(60)
    const edited = await snapshot()
    assert.equal(edited.anchors.length, 1)
    assert.ok(edited.source.includes('%E4%B8%AD%E6%96%87&page=2'), 'the encoded part survives the edit')
    assert.ok(edited.anchors[0].href.endsWith('%E4%B8%AD%E6%96%87&page=2'), 'href follows the appended parameter')
    assert.equal(edited.anchors[0].autolink, 'bare')
  })

  await test('17. the Split renderer produces the same target as the Live link', async () => {
    const source = '文本 https://yuanmahome.cn/originalDetail?id=2113188155363074049 结束'
    await page.evaluate(src => window.f.reset(src, false), source)
    const live = await snapshot()
    // Render the same Markdown through the shared preview renderer (the one the
    // split pane uses) and compare the resolved target, not the styling.
    const preview = await page.evaluate(async src => {
      const { createMarkdownRenderer } = await import('/src/editor/markdown/rendering.ts')
      const host = document.createElement('div')
      host.innerHTML = createMarkdownRenderer(() => {}, true).render(src, {})
      const anchor = host.querySelector('a')
      const previewSource = host.textContent || ''
      return { href: anchor?.getAttribute('href') ?? null, text: anchor?.textContent ?? null, previewSource }
    }, source)
    assert.ok(preview.href, 'the preview also renders a link')
    assert.equal(decodeURI(preview.href), decodeURI(live.anchors[0].href), 'both modes resolve to the same target')
    assert.equal(preview.text, live.anchors[0].text, 'both modes paint the same range')
    assert.ok(preview.previewSource.includes('https://yuanmahome.cn/originalDetail?id=2113188155363074049'))
    assert.equal(await page.evaluate(() => window.f.source()), source, 'rendering never mutates the source')
  })

  console.log('========================================')
  console.log(`All ${results.length} bare URL editing tests passed successfully!`)
  console.log('========================================')

} finally {
  await browser?.close()
  await server.close()
}
