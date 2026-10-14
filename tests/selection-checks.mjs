import assert from 'node:assert/strict'

// Check actual screenshot pixels: computed selection CSS alone misses an opaque line covering it.
export async function checkSelection(page, { output, name, pane = 'main' }) {
  await page.locator('.settingsoverlay').waitFor({ state: 'hidden' })
  const selector = pane === 'main' ? '.main-pane' : '.secondary-pane'
  const content = page.locator(`${selector} .cm-content`)
  await content.focus(); await content.press('Control+Home')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const points = await page.evaluate(pane => {
    const manager = document.querySelector('#app').__vue_app__._instance.setupState.manager
    const view = pane === 'main' ? manager.view : manager.secondaryView
    const from = view.coordsAtPos(3), to = view.coordsAtPos(22)
    return { from: { x: from.left, y: (from.top + from.bottom) / 2 }, to: { x: to.left, y: (to.top + to.bottom) / 2 } }
  }, pane)
  await page.mouse.move(points.from.x, points.from.y)
  await page.mouse.down()
  await page.mouse.move(points.to.x, points.to.y, { steps: 12 })
  await page.mouse.up()
  const selection = () => page.evaluate(pane => {
    const manager = document.querySelector('#app').__vue_app__._instance.setupState.manager
    const view = pane === 'main' ? manager.view : manager.secondaryView
    return { from: view.state.selection.main.from, to: view.state.selection.main.to, text: view.state.doc.toString() }
  }, pane)
  assert.deepEqual([ (await selection()).from, (await selection()).to ], [3, 22], `real mouse drag must select requested text: ${JSON.stringify({points, actual: await selection()})}`)
  async function visible(suffix) {
    const block = page.locator(`${selector} .cm-selectionBackground`).first()
    await block.waitFor({ state: 'visible' })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const bounds = await block.boundingBox()
    const shot = await page.screenshot({ path: `${output}/${name}-${suffix}.png`, animations: 'disabled' })
    const pixels = await page.evaluate(async ({ data, bounds }) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
      const pixel = (x, y) => Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data).slice(0, 3)
      const y = bounds.y + 2
      return { selected: pixel(bounds.x + 3, y), outside: pixel(bounds.x + bounds.width + 40, y) }
    }, { data: shot.toString('base64'), bounds })
    const difference = pixels.selected.reduce((sum, value, i) => sum + Math.abs(value - pixels.outside[i]), 0)
    assert.ok(difference >= 70, `${name}/${suffix}: selection is obscured or too faint: ${JSON.stringify(pixels)}`)
  }
  await visible('drag')
  const original = (await selection()).text
  // Move focus without opening a modal over the selected text.
  await page.getByTitle('设置', { exact: true }).focus()
  assert.deepEqual([(await selection()).from, (await selection()).to], [3, 22])
  await visible('blur')
  await content.focus(); await content.press('Control+Home'); await content.press('Shift+End')
  assert.equal((await selection()).from, 0)
  assert.equal((await selection()).to, original.indexOf('\n'))
  await visible('keyboard')
  await content.press('Shift+ArrowDown')
  assert.ok((await selection()).to > original.indexOf('\n'))
  await page.waitForFunction(selector => document.querySelectorAll(`${selector} .cm-selectionBackground`).length >= 2, selector)
  assert.equal((await selection()).text, original, 'selection must never alter source')
}
