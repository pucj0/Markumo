export async function selectCodeLanguage(block, label, option) {
  if (await block.locator('.cm-content').count()) {
    await block.locator('.cm-content').click().catch(() => {})
  } else {
    await block.click().catch(() => {})
  }
  await block.locator('.md-code-lang > button').click()
  await block.getByRole('combobox', { name: '搜索代码语言' }).fill(label)
  await block.getByRole('option', { name: option, exact: true }).click()
}
