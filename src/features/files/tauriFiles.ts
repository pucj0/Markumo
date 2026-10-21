import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { FileGateway, FileMetadata, OpenBatch, OpenFile, Preferences, SaveTarget, HexPage } from './contracts'

// No path-based arbitrary read/write API: native selection creates backend tokens.
export const tauriFiles: FileGateway = {
  checkExternal: token => invoke<string>('check_external_file', { token }),
  readExternal: (token, expectedVersion, encoding) => invoke<OpenFile>('read_external_file', { token, expectedVersion, encoding }),
  beginExternalWatch: () => invoke('begin_external_watch'),
  endExternalWatch: lease => invoke('end_external_watch', { lease }),
  watchExternal: (tokens, generation, lease) => invoke('watch_external_files', { tokens, generation, lease }),
  listenExternal: handler => listen<import('./contracts').ExternalFileHint>('external-file-change', event => handler(event.payload)),
  listenFocus: handler => getCurrentWindow().onFocusChanged(event => { if (event.payload) handler() }),
  openDialog: encoding => invoke<OpenBatch>('open_dialog', { encoding: encoding ?? null }),
  openRecent: (path, encoding) => invoke<OpenFile>('open_recent', { path, encoding: encoding ?? null }),
  drainPending: () => invoke<OpenBatch>('drain_pending'),
  reopen: (token, encoding) => invoke<OpenFile>('reopen_file', { token, encoding }),
  saveTarget: (sourceToken, name) => invoke<SaveTarget | null>('save_dialog', { sourceToken, name }),
  save: (token, text, expectedVersion, encoding, bom) => invoke<FileMetadata>('save_file', { token, text, expectedVersion, encoding, bom }),
  release: token => invoke('release_file', { token }),
  preferences: () => invoke<Preferences>('file_preferences'),
  persistLayout: layout => invoke('persist_layout', { layout }),
  readClassHex: (token, expectedVersion, offset) => invoke<HexPage>('read_class_hex', { token, expectedVersion, offset }),
}
