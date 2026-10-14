import type { OpenFile } from '../files/contracts'

export interface WorkspaceNode {
  id: string
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  isSymlink: boolean
  isReadOnly: boolean
  size: number
  mtime: number | null
  hasChildren: boolean
  children?: WorkspaceNode[]
  isExpanded?: boolean
  isLoading?: boolean
}

export interface WorkspaceInfo {
  rootPath: string
  name: string
  entries: WorkspaceNode[]
  warning?: string | null
}

export interface SearchMatch {
  search_id: string
  path: string
  relative_path: string
  line_number: number
  column_number: number
  line_text: string
  match_length: number
}

export interface SearchQuery {
  search_id: string
  query: string
  is_case_sensitive: boolean
  is_whole_word: boolean
  is_regex: boolean
  max_results?: number
  include_ignored?: boolean
}

export interface SearchDonePayload {
  search_id: string
  total: usize
  canceled: boolean
}

type usize = number

export interface WorkspaceGateway {
  openWorkspaceDialog(add?: boolean): Promise<WorkspaceInfo | null>
  removeWorkspaceFolder(path: string): Promise<void>
  restoreWorkspaces(): Promise<WorkspaceInfo[]>
  openWorkspacePath(path: string, add?: boolean): Promise<WorkspaceInfo>
  openWorkspaceFile(path: string, encoding?: string): Promise<OpenFile>
  readDirectory(path: string): Promise<WorkspaceNode[]>
  createFile(parentDir: string, name: string): Promise<WorkspaceNode>
  createDirectory(parentDir: string, name: string): Promise<WorkspaceNode>
  renameNode(oldPath: string, newName: string): Promise<[string, string]>
  deleteNode(path: string): Promise<string>
  moveNode(srcPath: string, destDir: string): Promise<[string, string]>
  findFiles(query: string, includeIgnored: boolean): Promise<{ name: string; path: string; relativePath: string }[]>
  setShowIgnored(show: boolean): Promise<WorkspaceNode[]>
  getRecentWorkspaces(): Promise<string[]>
  searchWorkspace(query: SearchQuery): Promise<number>
  cancelSearch(searchId: string): Promise<void>
  onSearchBatch(listener: (batch: SearchMatch[]) => void): () => void
  onSearchDone(listener: (payload: SearchDonePayload) => void): () => void
}
