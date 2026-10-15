export type AppMode = 'single' | 'workspace'
export type SidebarPanel = 'files' | 'search' | 'outline'
export type Theme = 'dark' | 'light'
export type ThemePreference = Theme | 'system'
export type MarkdownMode = 'live' | 'source' | 'split'
import type { LanguageName } from '../editor/languages'
import type { ClassInfo } from '../features/files/contracts'

export interface EditorDocument {
  kind?: 'text' | 'javaClass'
  classInfo?: ClassInfo
  id: string
  uri: string
  name: string
  path: string
  language: LanguageName
  languageStatus: 'loading' | 'ready' | 'error'
  languageError?: string
  charCount: number
  line: number
  column: number
  bom: boolean
  readOnly: boolean
  lastDiskVersion: string | null
  fileToken?: string
  dirty: boolean
  pinned: boolean
  mode?: MarkdownMode
  encoding: string
  eol: 'LF' | 'CRLF' | 'CR' | 'Mixed'
}

export interface TreeItem {
  id: string
  name: string
  path: string
  isFolder: boolean
  depth: number
  children?: TreeItem[]
}

export interface PaletteAction {
  id: string
  title: string
  detail: string
  category: 'action' | 'file'
  disabled?: boolean
  fileName?: string
  action: () => void
}
