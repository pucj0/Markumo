import { isTauri } from '@tauri-apps/api/core'
export interface TextClipboard { readText(): Promise<string>; writeText(text: string): Promise<void> }
export const textClipboard: TextClipboard = {
  async readText() {
    if (isTauri()) return (await import('@tauri-apps/plugin-clipboard-manager')).readText()
    if (!navigator.clipboard) throw new Error('浏览器未开放剪贴板权限，请在编辑区使用系统粘贴快捷键。')
    return navigator.clipboard.readText()
  },
  async writeText(text: string) {
    if (isTauri()) return (await import('@tauri-apps/plugin-clipboard-manager')).writeText(text)
    if (!navigator.clipboard) throw new Error('浏览器未开放剪贴板权限，请在编辑区使用系统复制快捷键。')
    await navigator.clipboard.writeText(text)
  },
}

/** Both representations belong to one clipboard write, so rich-text targets
 * receive semantic HTML while plain-text targets receive the user's preference. */
export async function writeRichClipboard(text: string, html: string) {
  if (isTauri()) {
    await (await import('@tauri-apps/plugin-clipboard-manager')).writeHtml(html, text)
  } else if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })])
  } else await textClipboard.writeText(text)
}
