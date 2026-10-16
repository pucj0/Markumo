import { invoke, isTauri } from '@tauri-apps/api/core'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { createMarkdownResources } from '../../editor/markdown/images'
import type { ExportFormat, ConversionSettings } from './contracts'
import { loadConversionSettings, saveLastExport, loadLastExport } from './conversionSettings'
import { renderMarkdownForExport, extractDocumentTitle } from './ExportRenderer'
import { buildCompleteHtml } from './ExportStyles'
import { exportMarkdownToDocx } from './PandocBridge'

export class ExportController {
  constructor(
    private manager: DocumentManager,
    private notify: (message: string) => void
  ) {}

  canExportActive(): boolean {
    const doc = this.manager.activeDocument
    if (!doc) return false
    // Document must be a Markdown file or in markdown mode
    return (
      doc.kind !== 'javaClass' &&
      doc.encoding !== 'Hex' &&
      (doc.mode !== undefined || /\.(md|markdown|mdown|mkd)$/i.test(doc.name))
    )
  }

  async exportDocument(format: ExportFormat, customSettings?: Partial<ConversionSettings>): Promise<string | null> {
    if (!this.canExportActive()) {
      this.notify('当前活动文件不是 Markdown 文档，无法导出。')
      return null
    }

    const doc = this.manager.activeDocument!
    const textSnapshot = this.manager.getText(doc.id) ?? ''
    const settings = { ...loadConversionSettings(), ...(customSettings || {}) }

    // Derive base name from title or file name
    const rawName = doc.name.replace(/\.(md|markdown|mdown|mkd)$/i, '') || 'Untitled'
    const docTitle = extractDocumentTitle(textSnapshot, rawName)
    const ext = format === 'docx' ? 'docx' : format === 'pdf' ? 'pdf' : format === 'png' ? 'png' : 'html'
    const defaultFilename = `${rawName}.${ext}`

    let targetPath: string | null = null

    if (isTauri()) {
      targetPath = await invoke<string | null>('export_save_dialog', {
        defaultName: defaultFilename,
        format: format === 'html-plain' ? 'html' : format,
      })
      if (!targetPath) {
        // User cancelled dialog
        return null
      }
    } else {
      targetPath = defaultFilename
    }

    try {
      this.notify('正在准备导出…')

      if (format === 'html' || format === 'html-plain') {
        await this.exportHtml(textSnapshot, docTitle, targetPath, format === 'html', settings)
      } else if (format === 'pdf') {
        await this.exportPdf(textSnapshot, docTitle, targetPath, settings)
      } else if (format === 'docx') {
        await this.exportDocx(textSnapshot, doc.path, targetPath)
      } else if (format === 'png') {
        await this.exportPng(textSnapshot, targetPath, settings)
      }

      saveLastExport({
        format,
        targetPath,
        options: settings,
        timestamp: Date.now(),
      })

      const displayTarget = targetPath.split(/[/\\]/).pop() || targetPath
      this.notify(`已成功导出 ${displayTarget}`)
      return targetPath
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.notify(`导出失败：${msg}`)
      throw error
    }
  }

  async exportRepeat(): Promise<string | null> {
    const last = loadLastExport()
    if (!last) {
      this.notify('尚无上一次导出记录，请从“文件 → 导出”选择格式。')
      return null
    }
    return this.exportDocument(last.format, last.options)
  }

  private async exportHtml(
    markdown: string,
    title: string,
    targetPath: string,
    includeStyles: boolean,
    settings: ConversionSettings
  ): Promise<void> {
    const resources = createMarkdownResources(() => this.manager.activeDocument?.fileToken)
    const { bodyHtml } = await renderMarkdownForExport(markdown, resources, settings.embedImagesAsDataUri)
    const fullHtml = buildCompleteHtml(title, bodyHtml, includeStyles)

    const bytes = new TextEncoder().encode(fullHtml)
    if (isTauri()) {
      await invoke('save_binary_file', {
        path: targetPath,
        bytes: Array.from(bytes),
      })
    } else {
      this.downloadBlob(new Blob([bytes], { type: 'text/html;charset=utf-8' }), targetPath)
    }
  }

  private async exportPdf(
    markdown: string,
    title: string,
    targetPath: string,
    settings: ConversionSettings
  ): Promise<void> {
    const resources = createMarkdownResources(() => this.manager.activeDocument?.fileToken)
    const { bodyHtml } = await renderMarkdownForExport(markdown, resources, true)
    const fullHtml = buildCompleteHtml(title, bodyHtml, true, settings.pdf)

    if (isTauri()) {
      await invoke('print_to_pdf', {
        htmlContent: fullHtml,
        outputPdfPath: targetPath,
        options: settings.pdf,
      })
    } else {
      // Browser fallback: trigger print dialog on generated window
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(fullHtml)
        win.document.close()
        setTimeout(() => win.print(), 500)
      }
    }
  }

  private async exportDocx(
    markdown: string,
    docPath?: string,
    targetPath?: string
  ): Promise<void> {
    if (!targetPath) throw new Error('未指定导出路径')
    const resourceDir = docPath ? docPath.replace(/[/\\][^/\\]+$/, '') : undefined
    await exportMarkdownToDocx(markdown, targetPath, resourceDir)
  }

  private async exportPng(
    markdown: string,
    targetPath: string,
    settings: ConversionSettings
  ): Promise<void> {
    const resources = createMarkdownResources(() => this.manager.activeDocument?.fileToken)
    const { bodyHtml } = await renderMarkdownForExport(markdown, resources, true)

    // Render in an offscreen container
    const container = document.createElement('div')
    container.className = 'markumo-document styled'
    container.style.position = 'absolute'
    container.style.left = '-99999px'
    container.style.top = '0'
    container.style.width = `${settings.png.width}px`
    container.style.background = settings.png.backgroundColor || '#ffffff'
    container.style.padding = '32px'
    container.style.boxSizing = 'border-box'
    container.innerHTML = bodyHtml
    document.body.appendChild(container)

    try {
      // Check document height
      const totalHeight = container.scrollHeight
      if (totalHeight > 30000) {
        throw new Error('文档超出图片最大安全画布尺寸（30,000像素），建议改用 PDF 格式导出。')
      }

      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(container, {
        scale: settings.png.scale || 2,
        backgroundColor: settings.png.backgroundColor || '#ffffff',
        useCORS: true,
        logging: false,
      })

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('生成 PNG 图像失败')

      const buffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(buffer)

      if (isTauri()) {
        await invoke('save_binary_file', {
          path: targetPath,
          bytes: Array.from(bytes),
        })
      } else {
        this.downloadBlob(blob, targetPath)
      }
    } finally {
      container.remove()
    }
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}
