export type AppMode = 'single' | 'workspace'
export type SidebarPanel = 'files' | 'search' | 'outline'
export type Theme = 'dark' | 'light'
export type MarkdownMode = 'live' | 'source' | 'split'

export interface EditorDocument {
  id: string
  name: string
  path: string
  language: string
  content: string
  original: string
  dirty: boolean
  pinned: boolean
  mode?: MarkdownMode
  encoding: string
  eol: 'LF' | 'CRLF'
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
  action: () => void
}
