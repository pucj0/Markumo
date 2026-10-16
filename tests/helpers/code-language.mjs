export async function selectCodeLanguage(block, label, option) {
  await block.evaluate(el => el.classList.add('is-focused')).catch(() => {})
  const btn = block.locator('.md-code-lang > button')
  if (await btn.count()) {
    await btn.click({ force: true })
  }
  const input = block.getByRole('combobox', { name: /搜索代码语言/ })
  await input.waitFor({ state: 'visible' })
  await input.fill(label)
  await block.getByRole('option', { name: option, exact: true }).click()
}
