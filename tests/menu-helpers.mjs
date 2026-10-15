// Exercise the production menubar; no direct manager mode changes here.
export async function setMarkdownMode(page, mode) {
  const name = ({ source:'源码编辑',live:'实时排版',split:'双栏预览',源码:'源码编辑',即时排版:'实时排版',双栏:'双栏预览' })[mode] || mode
  await page.getByRole('menubar').getByRole('menuitem',{name:'视图',exact:true}).click()
  await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'Markdown 编辑模式',exact:true}).click()
  await page.locator('[data-menu-popup]').getByRole('menuitemradio',{name,exact:true}).click()
}
export async function viewCommand(page,name) {
  await page.getByRole('menubar').getByRole('menuitem',{name:'视图',exact:true}).click()
  await page.locator('[data-menu-popup]').getByRole('menuitemcheckbox',{name,exact:true}).click()
}
// "视图 > 编辑器布局" is a submenu of plain commands, so it needs its own helper.
export async function layoutCommand(page,name) {
  await page.getByRole('menubar').getByRole('menuitem',{name:'视图',exact:true}).click()
  await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'编辑器布局',exact:true}).click()
  await page.locator('[data-menu-popup]').getByRole('menuitem',{name,exact:true}).click()
}
export async function splitPaneViaMenu(page) { await layoutCommand(page,'向右拆分') }
export async function mergePanesViaMenu(page) { await layoutCommand(page,'合并所有分栏') }
