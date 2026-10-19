import type { EditorDocument } from '../../types'
import type { OpenFile, MediaMetadata } from '../../features/files/contracts'
import { newMediaViewState, type MediaViewState } from '../../features/files/media'
import { sameFilePath } from '../../features/files/pathKey'

export interface CachedMediaDocument {
  meta: EditorDocument
  panes: Map<string, MediaViewState>
}

/**
 * Encapsulates non-text media document records (images, PDFs).
 *
 * Media documents deliberately have no EditorState, text buffer, undo/redo history,
 * or line ending snapshots. By segregating their metadata and per-pane view state
 * into a dedicated store, DocumentManager no longer mixes binary media records
 * with CodeMirror/ProseMirror transaction pipelines.
 */
export class MediaDocumentStore {
  private readonly records = new Map<string, CachedMediaDocument>()

  has(id: string): boolean {
    return this.records.has(id)
  }

  get(id: string): CachedMediaDocument | undefined {
    return this.records.get(id)
  }

  create(id: string, file: Extract<OpenFile, { kind: 'image' | 'pdf' }>): CachedMediaDocument {
    const record: CachedMediaDocument = {
      meta: {
        id,
        uri: `file:${file.path}`,
        name: file.name,
        path: file.path,
        kind: file.kind,
        media: file.media,
        fileToken: file.token,
        readOnly: true,
        dirty: false,
        pinned: true,
        language: 'Plain Text',
        languageStatus: 'ready',
        encoding: 'Binary',
        eol: 'LF',
        bom: false,
        charCount: 0,
        line: 0,
        column: 0,
        lastDiskVersion: file.version,
      },
      panes: new Map(),
    }
    this.records.set(id, record)
    return record
  }

  metadata(id: string, isPinned: boolean): EditorDocument | null {
    const record = this.records.get(id)
    if (!record) return null
    return { ...record.meta, pinned: isPinned }
  }

  viewState(id: string, pane: string): MediaViewState {
    const record = this.records.get(id)
    if (!record) return newMediaViewState()
    if (!record.panes.has(pane)) record.panes.set(pane, newMediaViewState())
    return record.panes.get(pane)!
  }

  updateMetadata(id: string, media: MediaMetadata, version: string): boolean {
    const record = this.records.get(id)
    if (!record) return false
    record.meta.media = media
    record.meta.lastDiskVersion = version
    return true
  }

  copyViewState(id: string, from: string, to: string) {
    const record = this.records.get(id)
    if (record && !record.panes.has(to)) {
      record.panes.set(to, { ...this.viewState(id, from) })
    }
  }

  deletePane(pane: string) {
    for (const record of this.records.values()) {
      record.panes.delete(pane)
    }
  }

  delete(id: string): boolean {
    return this.records.delete(id)
  }

  renamePath(oldPath: string, newPath: string, newName: string): boolean {
    for (const record of this.records.values()) {
      if (record.meta.path === oldPath) {
        Object.assign(record.meta, { path: newPath, name: newName, uri: `file:${newPath}` })
        return true
      }
    }
    return false
  }

  findByPath(filePath: string): CachedMediaDocument | undefined {
    for (const record of this.records.values()) {
      if (record.meta.fileToken && sameFilePath(record.meta.path, filePath)) {
        return record
      }
    }
    return undefined
  }

  clear() {
    this.records.clear()
  }
}
