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
