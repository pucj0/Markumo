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
  private failures = new Map<string, { version: string; attempts: number; retryAt: number }>()
  private unsubscribe: () => void
  private stopExternal: () => void
  constructor(private manager: DocumentManager, private files: FileController, private blocked: () => boolean = () => false) {
    this.unsubscribe = manager.subscribe(() => this.refresh())
    this.stopExternal = files.external.subscribe(() => this.refresh())
  }
  configure(enabled: boolean, delay: number) {
    if (this.disposed) return
    if (enabled !== this.enabled || delay !== this.delay) {
      this.pending.clear()
    }
    this.enabled = enabled
    this.delay = delay
    this.refresh()
  }
  private failureVersion(id: string) {
    const state = this.files.external.state(id)
    // Touches and a rolled-back native write may change only mtime. They must
    // not reset the retry budget and start a save/check/rollback feedback loop.
    return `${state?.token}|${state?.saveRevision}`
  }
  private refresh() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.disposed || !this.enabled) { this.pending.clear(); return }
    const ids = new Set<string>()
    for (const doc of this.manager.openedDocuments) {
      ids.add(doc.id)
      const version = this.failureVersion(doc.id)
      if (!doc.dirty || (this.failures.has(doc.id) && this.failures.get(doc.id)!.version !== version)) this.failures.delete(doc.id)
      const retryAt = this.failures.get(doc.id)?.retryAt ?? 0
      if (!doc.dirty || !doc.fileToken || doc.readOnly || retryAt === Infinity || this.files.external.blocked(doc.id)) { this.pending.delete(doc.id); continue }
      const text = this.manager.getState(doc.id)?.doc
      if (text && this.pending.get(doc.id)?.text !== text) this.pending.set(doc.id, { text, due: Math.max(Date.now() + this.delay, retryAt) })
    }
    for (const id of this.pending.keys()) if (!ids.has(id)) this.pending.delete(id)
    for (const id of this.failures.keys()) if (!ids.has(id)) this.failures.delete(id)
    if (this.running || !this.pending.size) return
    let due = Infinity
    // Check completion publishes a refresh. Leave pending edits parked without
    // a polling timer while that document has an outstanding check Promise.
    for (const [id, item] of this.pending) if (!this.files.external.checking(id)) due = Math.min(due, item.due)
    if (due !== Infinity) this.timer = setTimeout(() => void this.flush(), Math.max(0, due - Date.now()))
  }
  private async flush() {
    this.timer = undefined
    if (this.disposed || !this.enabled) return
    if (this.manager.isComposing || this.files.workspaceBusy || this.blocked()) { this.retry(); return }
    this.running = true
    try {
      for (const [id, item] of this.pending) {
        if (this.disposed || !this.enabled || this.manager.isComposing || this.files.workspaceBusy || this.blocked()) break
        if (item.due > Date.now() || this.files.saving.has(id) || this.files.external.checking(id)) continue
        const result = await this.files.autoSave(id)
        if (result === 'failed') {
          const doc = this.manager.metadata(id)
          const attempts = (this.failures.get(id)?.attempts ?? 0) + 1
          if (doc) this.failures.set(id, { version: this.failureVersion(id), attempts, retryAt: attempts < 3 ? Date.now() + 1000 * 4 ** (attempts - 1) : Infinity })
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
    this.stopExternal()
    if (this.timer) clearTimeout(this.timer)
    this.pending.clear(); this.failures.clear()
  }
}
