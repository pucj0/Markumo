import type { Text } from '@codemirror/state'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { FileController } from './FileController'

/** One timer and one background save queue for all canonical documents.
 * Observe immutable Text identities, never serialize while typing. */
export class AutoSaveController {
  private enabled = false
  private delay = 1500
  private disposed = false
  private running = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending = new Map<string, { text: Text; due: number }>()
  private failures = new Map<string, string>()
  private unsubscribe: () => void
  constructor(private manager: DocumentManager, private files: FileController, private blocked: () => boolean = () => false) {
    this.unsubscribe = manager.subscribe(() => this.refresh())
  }
  configure(enabled: boolean, delay: number) {
    if (this.disposed) return
    if (enabled !== this.enabled || delay !== this.delay) {
      this.pending.clear()
      if (enabled && !this.enabled) this.failures.clear()
    }
    this.enabled = enabled
    this.delay = delay
    this.refresh()
  }
  private refresh() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.disposed || !this.enabled) { this.pending.clear(); return }
    const ids = new Set<string>()
    for (const doc of this.manager.openedDocuments) {
      ids.add(doc.id)
      const version = `${doc.fileToken}|${doc.lastDiskVersion}`
      if (!doc.dirty || this.failures.get(doc.id) !== version) this.failures.delete(doc.id)
      if (!doc.dirty || !doc.fileToken || doc.readOnly || this.failures.has(doc.id)) { this.pending.delete(doc.id); continue }
      const text = this.manager.getState(doc.id)?.doc
      if (text && this.pending.get(doc.id)?.text !== text) this.pending.set(doc.id, { text, due: Date.now() + this.delay })
    }
    for (const id of this.pending.keys()) if (!ids.has(id)) this.pending.delete(id)
    for (const id of this.failures.keys()) if (!ids.has(id)) this.failures.delete(id)
    if (this.running || !this.pending.size) return
    let due = Infinity
    for (const item of this.pending.values()) due = Math.min(due, item.due)
    this.timer = setTimeout(() => void this.flush(), Math.max(0, due - Date.now()))
  }
  private async flush() {
    this.timer = undefined
    if (this.disposed || !this.enabled) return
    if (this.manager.isComposing || this.files.workspaceBusy || this.blocked()) { this.retry(); return }
    this.running = true
    try {
      for (const [id, item] of this.pending) {
        if (this.disposed || !this.enabled || this.manager.isComposing || this.files.workspaceBusy || this.blocked()) break
        if (item.due > Date.now() || this.files.saving.has(id)) continue
        const result = await this.files.autoSave(id)
        if (result === 'failed') {
          const doc = this.manager.metadata(id)
          if (doc) this.failures.set(id, `${doc.fileToken}|${doc.lastDiskVersion}`)
          this.pending.delete(id)
        } else if (result === 'skipped') item.due = Date.now() + 250
        // New edits during IPC retain their own delay and dirty flag.
      }
    } finally {
      this.running = false
      // An in-flight manual save need not publish completion notifications.
      for (const [id, item] of this.pending) if (this.files.saving.has(id)) item.due = Math.max(item.due, Date.now() + 250)
      this.refresh()
    }
  }
  private retry() { this.timer = setTimeout(() => void this.flush(), 250) }
  dispose() {
    this.disposed = true
    this.unsubscribe()
    if (this.timer) clearTimeout(this.timer)
    this.pending.clear(); this.failures.clear()
  }
}
