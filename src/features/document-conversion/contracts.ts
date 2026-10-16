export type ExportFormat = 'pdf' | 'html' | 'html-plain' | 'docx' | 'png'
export type ImportFormat = 'html' | 'docx'

export interface PandocStatus {
  available: boolean
  version?: string
  path?: string
}

export interface PdfOptions {
  paperSize: 'A4' | 'Letter'
  orientation: 'portrait' | 'landscape'
  margins: 'default' | 'compact' | 'loose'
  printBackground: boolean
  codeWrap: boolean
}

export interface HtmlExportOptions {
  includeStyles: boolean
  embedImages: boolean
}

export interface PngExportOptions {
  width: number
  scale: number
  backgroundColor: string
}

export interface ConversionSettings {
  defaultExportDir?: string
  askSaveLocation: boolean
  embedImagesAsDataUri: boolean
  pdf: PdfOptions
  html: HtmlExportOptions
  png: PngExportOptions
}

export interface LastExportRecord {
  format: ExportFormat
  targetPath?: string
  options: Partial<ConversionSettings>
  timestamp: number
}
