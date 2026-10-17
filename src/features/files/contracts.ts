export type Encoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'GB18030' | 'windows-1252' | 'Hex'
export type FileOpenEncoding = Encoding | 'ClassInfo'
export interface FileMetadata {
  token: string
  path: string
  name: string
  encoding: Encoding | 'Binary'
  bom: boolean
  eol: 'LF' | 'CRLF' | 'CR' | 'Mixed'
  readOnly: boolean
  version: string
  warning?: string
}
export interface ClassInfo {
  className: string; superName: string | null; majorVersion: number; minorVersion: number; accessFlags: number; byteLength: number
  constantPoolCount: number; constants: { index: number; tag: string; value: string }[]
  fieldsCount: number; methodsCount: number
  fields: { name: string; descriptor: string; flags: number }[]; methods: { name: string; descriptor: string; flags: number }[]
  interfaces: string[]; displayTruncated: boolean
}
export interface HexPage { offset: number; totalLength: number; nextOffset: number | null; text: string }
export interface TextOpenFile extends FileMetadata { kind?: 'text'; text: string }
export interface JavaClassOpenFile extends FileMetadata { kind: 'javaClass'; text: ''; classInfo: ClassInfo }
export interface MediaMetadata { byteLength: number; mime: string; format: string; width?: number; height?: number }
export interface MediaOpenFile extends FileMetadata { kind: 'image' | 'pdf'; text: ''; media: MediaMetadata }
export type OpenFile = TextOpenFile | JavaClassOpenFile | MediaOpenFile
export interface OpenBatch { files: OpenFile[]; errors: string[] }
export interface SaveTarget { token: string; path: string; version: string | null }
export interface Preferences {
  recent: { path: string; name: string }[]
  layout: { mode: 'single' | 'workspace'; sidebarVisible: boolean; sidebarWidth: number }
  warning?: string
}
export interface FileGateway {
  openDialog(encoding?: FileOpenEncoding): Promise<OpenBatch>
  openRecent(path: string, encoding?: FileOpenEncoding): Promise<OpenFile>
  drainPending(): Promise<OpenBatch>
  reopen(token: string, encoding: FileOpenEncoding): Promise<OpenFile>
  saveTarget(sourceToken: string | null, name: string): Promise<SaveTarget | null>
  save(token: string, text: string, expectedVersion: string | null, encoding: Encoding, bom: boolean): Promise<FileMetadata>
  release(token: string): Promise<void>
  preferences(): Promise<Preferences>
  persistLayout(layout: Preferences['layout']): Promise<void>
  readClassHex?(token: string, expectedVersion: string, offset: number): Promise<HexPage>
}
