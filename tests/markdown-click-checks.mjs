import assert from 'node:assert/strict'

// Use DOM text rectangles, not CM's own coordsAtPos, so a broken height map
// cannot make both the test input and expected output share the same error.
export async function checkMarkdownClicks(page, output) {
  const block = '# 第一行标题\n\n## 技术栈\n\n后端：Spring Boot\n前端：Vue\n数据库：MySQL\n\n## 系统角色\n\n系统分两种角色：\n\n- 商家\n  - 注册与登录\n  - 密码\n\n---\n\n最后一段\n\n'
  const source = block.repeat(40)
  const id = await page.evaluate(source => {
    const m = document.querySelector('#app').__vue_app__._instance.setupState.manager
    const id = m.createUntitled('md')
    m.dispatch(id, { changes: { from: 0, insert: source }, selection: { anchor: source.length } })
    return id
  }, source)
  await page.waitForFunction(id => document.querySelector('#app').__vue_app__._instance.setupState.manager.metadata(id)?.languageStatus === 'ready', id)
  try {
    for (const mode of ['live', 'source', 'split', 'live']) {
      await page.evaluate(({id, mode}) => document.querySelector('#app').__vue_app__._instance.setupState.manager.setMarkdownMode(id, mode), {id, mode})
      for (const number of [1, 3, 5, 6, 9, 13, 19, 205, 409, 619]) {
        await page.evaluate(({id, number}) => document.querySelector('#app').__vue_app__._instance.setupState.manager.revealPosition(id, number, 1), {id, number})
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const point = await page.evaluate(number => {
          const v = document.querySelector('#app').__vue_app__._instance.setupState.manager.view
          const line = [...v.contentDOM.querySelectorAll('.cm-line')].find(el => v.state.doc.lineAt(v.posAtDOM(el)).number === number)
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
          let text
          while ((text = walker.nextNode())) {
            if (!text.textContent.trim()) continue
            const range = document.createRange(); range.selectNodeContents(text)
            const rect = range.getBoundingClientRect()
            if (rect.width > 0) return { x: rect.left + Math.min(5, rect.width / 2), y: (rect.top + rect.bottom) / 2 }
          }
          throw new Error(`No rendered text at line ${number}`)
        }, number)
        await page.mouse.click(point.x, point.y)
        assert.equal(await page.evaluate(() => {
          const v = document.querySelector('#app').__vue_app__._instance.setupState.manager.view
          return v.state.doc.lineAt(v.state.selection.main.head).number
        }), number, `${mode}: clicking rendered line ${number} must edit that line`)
        await page.keyboard.insertText('X')
        const changed = await page.evaluate(id => document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(id), id)
        assert.equal(changed.split('\n')[number - 1].replace('X', ''), source.split('\n')[number - 1])
        await page.keyboard.press('Control+z')
        assert.equal(await page.evaluate(id => document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(id), id), source)
      }
    }
    await page.evaluate(id => document.querySelector('#app').__vue_app__._instance.setupState.manager.revealPosition(id, 1, 1), id)
    await page.waitForFunction(() => !!document.querySelector('.cm-md-paragraph'))
    const spacing = await page.locator('.cm-md-paragraph').first().evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))
    assert.ok(spacing >= 8, 'paragraphs should have source-preserving visual whitespace')
    await page.screenshot({ path: `${output}/markdown-clicks.png` })
  } finally {
    await page.evaluate(id => document.querySelector('#app').__vue_app__._instance.setupState.manager.close(id, true), id)
  }
}
