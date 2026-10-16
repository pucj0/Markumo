import { invoke, isTauri } from '@tauri-apps/api/core'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { ImportFormat } from './contracts'
import { importHtmlToMarkdown } from './HtmlImporter'
import { getPandocStatus, importDocxToMarkdown } from './PandocBridge'

export class ImportController {
  constructor(
    private manager: DocumentManager,
    private notify: (message: string) => void
  ) {}

  async importDocument(format: ImportFormat): Promise<string | null> {
    if (format === 'html') {
      return this.importHtml()
    } else if (format === 'docx') {
      return this.importDocx()
    }
    return null
  }

  private async importHtml(): Promise<string | null> {
    let sourcePath: string | null = null

    if (isTauri()) {
      sourcePath = await invoke<string | null>('import_open_dialog', { format: 'html' })
      if (!sourcePath) return null
    }

    try {
      this.notify('正在读取并转换 HTML…')

      let htmlContent = ''
      if (isTauri() && sourcePath) {
        // Read file content using backend
        htmlContent = await invoke<string>('reopen_file', { token: null, encoding: 'UTF-8' })
          .catch(async () => {
            // Read via fetch or standard fs
            const resp = await fetch(`asset://localhost/${encodeURIComponent(sourcePath!)}`)
            return resp.text()
          })
          .catch(() => '')

        // If backend open batch is preferred:
        const fileBatch = await invoke<{ files: { path: string; text: string; name: string }[] }>('open_dialog', { encoding: 'UTF-8' })
          .catch(() => null)
        if (fileBatch?.files?.[0]) {
          htmlContent = fileBatch.files[0].text
        }
      }

      if (!htmlContent) {
        // In browser fallback or if direct file open, open file input
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.html,.htm'
        const picked = await new Promise<File | null>(resolve => {
          input.onchange = () => resolve(input.files?.[0] || null)
          input.click()
        })
        if (!picked) return null
        htmlContent = await picked.text()
      }

      const result = importHtmlToMarkdown(htmlContent)

      // Create new Untitled Markdown document in DocumentManager
      const docId = this.manager.createUntitled('md')
      if (docId) {
        this.manager.dispatch(docId, {
          changes: { from: 0, insert: result.markdown },
        })
        this.manager.select(docId)
        this.notify(`已成功导入 HTML 文档「${result.title}」为 Markdown`)
        return docId
      }
      return null
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.notify(`导入 HTML 失败：${msg}`)
      throw error
    }
  }

  private async importDocx(): Promise<string | null> {
    if (!isTauri()) {
      this.notify('Word 导入需要桌面版运行环境。')
      return null
    }

    const status = await getPandocStatus()
    if (!status.available) {
      this.notify('未检测到 Pandoc。Word 导入需要安装 Pandoc，请先前往 https://pandoc.org 安装。')
      return null
    }

    // 1. Pick source docx
    const docxPath = await invoke<string | null>('import_open_dialog', { format: 'docx' })
    if (!docxPath) return null

    // 2. Pick target md path
    const defaultMdName = docxPath.replace(/\.docx$/i, '.md').split(/[/\\]/).pop() || 'Imported.md'
    const targetMdPath = await invoke<string | null>('export_save_dialog', {
      defaultName: defaultMdName,
      format: 'markdown',
    })
    if (!targetMdPath) return null

    // 3. Target media directory
    const baseDir = targetMdPath.replace(/[/\\][^/\\]+$/, '')
    const baseName = targetMdPath.split(/[/\\]/).pop()?.replace(/\.md$/i, '') || 'assets'
    const mediaDir = `${baseDir}/${baseName}.assets`

    try {
      this.notify('正在使用 Pandoc 转换 Word 文档…')
      const markdown = await importDocxToMarkdown(docxPath, targetMdPath, mediaDir)

      // Create new document or open file in DocumentManager
      const docId = this.manager.createUntitled('md')
      if (docId) {
        this.manager.dispatch(docId, {
          changes: { from: 0, insert: markdown },
        })
        this.manager.select(docId)
      }

      const targetFileName = targetMdPath.split(/[/\\]/).pop()
      this.notify(`已成功将 Word 文档导入为 ${targetFileName}`)
      return targetMdPath
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.notify(`导入 Word 失败：${msg}`)
      throw error
    }
  }
}
