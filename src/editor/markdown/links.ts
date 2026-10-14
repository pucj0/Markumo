import { invoke, isTauri } from '@tauri-apps/api/core'
export function safeMarkdownURL(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/^<|>$/g, '').replace(/\\([\\()<>])/g, '$1'))
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
export async function openMarkdownLink(raw: string) {
  const url = safeMarkdownURL(raw)
  if (!url) return
  try {
    if (isTauri()) await invoke('open_external_link', { url })
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch (error) { window.dispatchEvent(new CustomEvent('editor-notice', { detail: `打开链接失败: ${String(error)}` })) }
}
