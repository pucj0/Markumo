export type RecoveryMode = 'live' | 'source' | 'split'
export interface RecoveryPane {
  pane: string
  mode?: RecoveryMode | null
}
export interface RecoverySummary {
  id: string
  name: string
  path: string | null
  updatedAt: number
  charCount: number
  sizeBytes: number
  mode?: RecoveryMode | null
  panes: RecoveryPane[]
  diskExists: boolean
  diskChanged: boolean
}
export interface RecoveryRecord {
  schemaVersion: number
  id: string
  name: string
  path: string | null
  text: string
  encoding: string
  bom: boolean
  eol: 'LF' | 'CRLF' | 'CR' | 'Mixed'
  mode?: RecoveryMode | null
  panes: RecoveryPane[]
  updatedAt: number
  charCount: number
  diskVersion: string | null
  diskSize: number | null
  diskModifiedNs: number | null
  checksum: string
}
export interface RecoveryList {
  records: RecoverySummary[]
  warnings: string[]
}
export interface RecoverySaveInput {
  id?: string | null
  name: string
  path: string | null
  text: string
  encoding: string
  bom: boolean
  eol: string
  mode?: RecoveryMode | null
  panes: RecoveryPane[]
  diskVersion: string | null
}
export interface RecoverySaveResult {
  record: RecoverySummary
  warnings: string[]
}
export interface RecoveryDiff {
  id: string
  name: string
  path: string | null
  recoveryText: string
  diskText: string | null
  error?: string
}
export interface RecoveryGateway {
  list(): Promise<RecoveryList>
  read(id: string): Promise<RecoveryRecord>
  save(input: RecoverySaveInput): Promise<RecoverySaveResult>
  remove(id: string): Promise<void>
}
