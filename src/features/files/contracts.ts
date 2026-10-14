export type Encoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'GB18030' | 'windows-1252'
export interface FileMetadata {
  token: string
  path: string
  name: string
  encoding: Encoding
  bom: boolean
  eol: 'LF' | 'CRLF' | 'CR' | 'Mixed'
  readOnly: boolean
  version: string
  warning?: string
}
export interface OpenFile extends FileMetadata { text: string }
export interface OpenBatch { files: OpenFile[]; errors: string[] }
export interface SaveTarget { token: string; path: string; version: string | null }
export interface Preferences {
  recent: { path: string; name: string }[]
  layout: { mode: 'single' | 'workspace'; sidebarVisible: boolean; sidebarWidth: number }
  warning?: string
}
export interface FileGateway {
  openDialog(encoding?: Encoding): Promise<OpenBatch>
  openRecent(path: string, encoding?: Encoding): Promise<OpenFile>
  drainPending(): Promise<OpenBatch>
  reopen(token: string, encoding: Encoding): Promise<OpenFile>
  saveTarget(sourceToken: string | null, name: string): Promise<SaveTarget | null>
  save(token: string, text: string, expectedVersion: string | null, encoding: Encoding, bom: boolean): Promise<FileMetadata>
  release(token: string): Promise<void>
  preferences(): Promise<Preferences>
  persistLayout(layout: Preferences['layout']): Promise<void>
}
