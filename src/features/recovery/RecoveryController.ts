import { ref } from 'vue'
import type { Text } from '@codemirror/state'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { FileController } from '../files/FileController'
import type { FileOpenEncoding } from '../files/contracts'
import { sameFilePath } from '../files/pathKey'
import { isMedia } from '../files/media'
import type { EditorDocument, MarkdownMode } from '../../types'
import type {
  RecoveryDiff,
  RecoveryGateway,
  RecoveryList,
  RecoveryMode,
  RecoveryPane,
  RecoverySaveInput,
  RecoverySummary,
} from './types'

const DEBOUNCE_MS = 2500
const RETRY_MS = 500
const MAX_TEXT_BYTES = 8 * 1024 * 1024

type Pending = { text: Text; due: number }

/**
 * Owns debounced, body-preserving snapshots. It observes immutable CM Text
 * identities; it never serializes on every keystroke and never writes the
 * original file. Recovery records are independent of last-session.json.
 */
export class RecoveryController {
  readonly records = ref<RecoverySummary[]>([])
  readonly warnings = ref<string[]>([])
  readonly visible = ref(false)
  readonly busy = ref(false)
  readonly lastError = ref<string | null>(null)
  readonly diff = ref<RecoveryDiff | null>(null)
  private readonly activeIds = new Map<string, string>()
  private readonly generations = new Map<string, number>()
  private readonly pending = new Map<string, Pending>()
  private readonly failed = new Map<string, Text>()
  private readonly lastSaved = new Map<string, Text>()
  private readonly savedSummaries = new Map<string, RecoverySummary>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushing: Promise<void> = Promise.resolve()
  private unsubscribe: () => void
  private started = false
  private disposed = false
  private readonly debounceMs: number

  constructor(
    private readonly manager: DocumentManager,
    private readonly files: FileController,
    private readonly gateway: RecoveryGateway,
    private readonly notify: (message: string) => void,
    options: { debounceMs?: number } = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS
    this.unsubscribe = manager.subscribe(() => this.refresh())
  }

  async start() {
    if (this.started || this.disposed) return
    this.started = true
    this.refresh()
    try {
      await this.reload()
      if (this.records.value.length) this.visible.value = true
    } catch (error) {
      this.lastError.value = `无法检查恢复快照：${String(error)}`
      this.notify(this.lastError.value)
    }
  }

  async open() {
    await this.reload()
    this.visible.value = true
  }

  close() {
    this.visible.value = false
    this.diff.value = null
  }

  async reload() {
    if (this.disposed) return
    let result: RecoveryList
    try {
      result = await this.gateway.list()
    } catch (error) {
      this.lastError.value = `无法读取恢复目录：${String(error)}`
      throw error
    }
    this.warnings.value = result.warnings
    if (result.warnings.length) this.notify(result.warnings.join('\n'))
    // A path match is not consent to restore. Only this session's own writes
    // and explicitly restored records may be cleaned after saving a document.
    this.records.value = result.records.filter(record => {
      const owner = [...this.activeIds.entries()].find(([, id]) => id === record.id)?.[0]
      const doc = owner ? this.manager.metadata(owner) : null
      return !(doc?.dirty && owner && !this.failed.has(owner))
    })
  }

  /** Called only after the controller has been attached to the main window. */
  refresh() {
    if (!this.started || this.disposed) return
    const seen = new Set<string>()
    const now = Date.now()
    for (const doc of this.manager.openedDocuments) {
      seen.add(doc.id)
      if (!this.eligible(doc)) { this.pending.delete(doc.id); continue }
      const text = this.manager.getState(doc.id)?.doc
      if (!text || this.failed.get(doc.id) === text || this.lastSaved.get(doc.id) === text) { this.pending.delete(doc.id); continue }
      const current = this.pending.get(doc.id)
      if (!current || current.text !== text) this.pending.set(doc.id, { text, due: now + this.debounceMs })
    }
    for (const id of [...this.pending.keys()]) if (!seen.has(id)) this.pending.delete(id)
    this.schedule()
  }

  async flushForClose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const item of this.pending.values()) item.due = 0
    await this.flush()
  }

  /** A destructive reload must wait for this exact buffer to reach durable storage.
   * The retained snapshot is deliberately detached from subsequent normal saves. */
  async checkpointBeforeReload(id: string): Promise<boolean> {
    const doc = this.manager.metadata(id), text = this.manager.getState(id)?.doc
    if (!doc) return false
    if (!doc?.dirty) return true
    if (!this.started || this.disposed || !text || !this.eligible(doc) || this.manager.isComposing) return false
    const generation = this.generation(id)
    const token = doc.fileToken
    const valid = () => !this.disposed && this.generation(id) === generation &&
      this.manager.metadata(id)?.fileToken === token && this.manager.getState(id)?.doc === text && !this.manager.isComposing
    await this.flushing.catch(() => {})
    if (!valid()) return false
    this.failed.delete(id)
    // Require a new successful receipt. A previous write of the same immutable
    // Text must not turn this attempt's I/O failure into permission to discard.
    this.lastSaved.delete(id)
    this.savedSummaries.delete(id)
    this.pending.set(id, { text, due: 0 })
    await this.flush()
    const snapshot = this.savedSummaries.get(id)
    if (!valid() || this.lastSaved.get(id) !== text || !snapshot || this.activeIds.get(id) !== snapshot.id) return false
    this.bumpGeneration(id)
    this.activeIds.delete(id); this.lastSaved.delete(id); this.savedSummaries.delete(id); this.pending.delete(id)
    // The checkpoint is now unclaimed and must remain reachable without a
    // restart, even if a later read fails or the original file is saved again.
    this.records.value = [snapshot, ...this.records.value.filter(record => record.id !== snapshot.id)]
    return true
  }

  async onSaved(documentId: string) {
    if (this.disposed) return
    this.bumpGeneration(documentId)
    const doc = this.manager.metadata(documentId)
    if (doc?.dirty) {
      const text = this.manager.getState(documentId)?.doc
      if (text) this.pending.set(documentId, { text, due: Date.now() + this.debounceMs })
      this.schedule()
      return
    }
    this.pending.delete(documentId)
    this.failed.delete(documentId)
    this.lastSaved.delete(documentId)
    this.savedSummaries.delete(documentId)
    const id = this.activeIds.get(documentId)
    this.activeIds.delete(documentId)
    if (id) await this.removeSnapshot(id)
  }

  async discardDocument(documentId: string) {
    await this.flushing.catch(() => {})
    this.bumpGeneration(documentId)
    this.pending.delete(documentId)
    this.failed.delete(documentId)
    this.lastSaved.delete(documentId)
    this.savedSummaries.delete(documentId)
    const id = this.activeIds.get(documentId)
    this.activeIds.delete(documentId)
    if (id) await this.removeSnapshot(id)
  }

  /** Window/workspace discard applies only to buffers owned by this session. */
  async discardActive() {
    await this.flushing.catch(() => {})
    for (const id of new Set([...this.pending.keys(), ...this.activeIds.keys()])) this.bumpGeneration(id)
    this.pending.clear()
    this.failed.clear()
    this.lastSaved.clear()
    this.savedSummaries.clear()
    const ids = new Set(this.activeIds.values())
    this.activeIds.clear()
    for (const id of ids) await this.removeSnapshot(id)
    this.schedule()
  }

  /** Explicit global recovery discard; never used by an ordinary window close. */
  async discardAll() {
    await this.discardActive()
    for (const record of [...this.records.value]) await this.removeSnapshot(record.id)
    this.visible.value = false
    this.diff.value = null
  }
  async discard(record: RecoverySummary) {
    await this.flushing.catch(() => {})
    try {
      await this.gateway.remove(record.id)
      this.records.value = this.records.value.filter(item => item.id !== record.id)
      for (const [documentId, id] of this.activeIds) if (id === record.id) this.activeIds.delete(documentId)
      if (this.diff.value?.id === record.id) this.diff.value = null
    } catch (error) {
      this.lastError.value = `丢弃恢复快照失败：${String(error)}`
      this.notify(this.lastError.value)
    }
  }

  async showDiff(record: RecoverySummary) {
    this.busy.value = true
    try {
      const body = await this.gateway.read(record.id)
      // Compare with the document already in this session. After a session
      // restore this is the current disk content; never open an arbitrary path
      // from a recovery record just to build a diff.
      const current = record.path
        ? this.manager.openedDocuments.find(doc => doc.path && sameFilePath(doc.path, record.path!))
        : undefined
      const diskText = current ? this.manager.getText(current.id) ?? null : null
      const error = record.path && !current ? '原文件未在当前会话打开，无法比较' : undefined
      this.diff.value = { id: record.id, name: record.name, path: record.path, recoveryText: body.text, diskText, error }
    } catch (error) {
      this.lastError.value = `读取恢复快照失败：${String(error)}`
      this.notify(this.lastError.value)
    } finally {
      this.busy.value = false
    }
  }

  clearDiff() { this.diff.value = null }

  async restore(record: RecoverySummary): Promise<boolean> {
    if (this.disposed || this.busy.value) return false
    if (this.manager.isComposing || (this.files.saving?.size ?? 0) || this.files.workspaceBusy === true) {
      this.lastError.value = '请先完成输入法输入、保存或工作区文件操作，再恢复文档'
      this.notify(this.lastError.value)
      return false
    }
    // Acquire the UI operation lock before the first await, including retries.
    this.busy.value = true
    try {
      await this.flushing.catch(() => {})
      if (this.disposed) return false
      const active = [...this.activeIds].find(([, id]) => id === record.id)?.[0]
      if (active && this.manager.metadata(active)) {
        // Retrying a failed refresh must never reapply an older body over edits.
        return await this.persistRestored(active, record.id)
      }
      const body = await this.gateway.read(record.id)
      if (this.disposed || this.manager.isComposing || (this.files.saving?.size ?? 0) || this.files.workspaceBusy) throw Error('恢复期间文件操作状态已变化，请重试')
      let docId: string | null = null
      let opened: EditorDocument | undefined
      if (body.path && record.diskExists) {
        await this.files.recent(body.path, body.encoding as FileOpenEncoding)
        opened = this.manager.openedDocuments.find(doc => doc.path && sameFilePath(doc.path, body.path!))
      }
      if (this.disposed || this.manager.isComposing || (this.files.saving?.size ?? 0) || this.files.workspaceBusy) throw Error('恢复期间文件操作状态已变化，请重试')
      // A changed/unknown disk baseline is restored as a pathless draft. Loading
      // the latest disk token must not authorize a later ordinary save of stale
      // recovery text over somebody else's newer file.
      const reusable = opened && !opened.dirty && !this.activeIds.has(opened.id) &&
        body.diskVersion !== null && body.diskVersion === opened.lastDiskVersion &&
        opened.kind !== 'javaClass' && opened.encoding !== 'Hex' && !isMedia(opened)
      if (reusable && this.manager.restoreRecoveredText(opened!.id, body.text, (body.mode || undefined) as MarkdownMode | undefined)) docId = opened!.id
      else docId = this.createDraft(body)
      if (!docId) throw Error('无法创建恢复文档')
      this.applyPlacements(docId, body.panes.length ? body.panes : [{ pane: 'main', mode: body.mode || undefined }])
      this.activeIds.set(docId, body.id)
      return await this.persistRestored(docId, body.id)
    } catch (error) {
      this.lastError.value = `恢复文档失败：${String(error)}`
      this.notify(this.lastError.value)
      return false
    } finally {
      this.busy.value = false
    }
  }

  private async persistRestored(documentId: string, recoveryId: string): Promise<boolean> {
    const text = this.manager.getState(documentId)?.doc
    if (!text || !this.manager.metadata(documentId)?.dirty || this.manager.isComposing) return false
    this.failed.delete(documentId)
    this.lastSaved.delete(documentId)
    this.savedSummaries.delete(documentId)
    this.pending.set(documentId, { text, due: 0 })
    await this.flush()
    // An existing old JSON is not evidence that this buffer was refreshed.
    if (this.disposed || this.lastSaved.get(documentId) !== text || this.manager.getState(documentId)?.doc !== text) {
      this.lastError.value = `恢复内容已打开，但快照更新未成功：${this.lastError.value || '编辑内容或输入状态在恢复期间发生变化'}。最后一次有效恢复稿仍保留。`
      this.notify(this.lastError.value)
      return false
    }
    this.records.value = this.records.value.filter(item => item.id !== recoveryId)
    this.visible.value = this.records.value.length > 0
    this.diff.value = null
    return true
  }

  async restoreAll() {
    let failures = 0
    for (const record of [...this.records.value]) {
      if (!(await this.restore(record))) failures++
    }
    if (failures) this.notify(`${failures} 个恢复文档未能打开；原恢复快照仍保留，可重试。`)
  }

  dispose() {
    this.disposed = true
    this.unsubscribe()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
    this.failed.clear()
    this.savedSummaries.clear()
  }

  private eligible(doc: EditorDocument): boolean {
    return !!doc.dirty && doc.kind !== 'javaClass' && doc.encoding !== 'Hex' && !isMedia(doc)
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.disposed || !this.pending.size) return
    let due = Infinity
    for (const item of this.pending.values()) due = Math.min(due, item.due)
    this.timer = setTimeout(() => { void this.flush() }, Math.max(0, due - Date.now()))
  }

  private flush(): Promise<void> {
    this.flushing = this.flushing.catch(() => {}).then(() => this.performFlush())
    return this.flushing
  }

  private async performFlush() {
    if (this.disposed || !this.pending.size) return
    if (this.manager.isComposing) {
      this.timer = setTimeout(() => { void this.flush() }, RETRY_MS)
      return
    }
    const items = [...this.pending]
    for (const [documentId, item] of items) {
      const doc = this.manager.metadata(documentId)
      if (!doc || !this.eligible(doc)) { this.pending.delete(documentId); continue }
      if (item.due > Date.now()) continue
      const current = this.manager.getState(documentId)?.doc
      if (!current) { this.pending.delete(documentId); continue }
      const panes = this.panesFor(documentId)
      const input: RecoverySaveInput = {
        id: this.activeIds.get(documentId) || null,
        name: doc.name,
        path: doc.path || null,
        text: item.text.toString(),
        encoding: allowedEncoding(doc.encoding),
        bom: doc.bom,
        eol: doc.eol,
        mode: (doc.mode || null) as RecoveryMode | null,
        panes,
        diskVersion: doc.lastDiskVersion,
      }
      if (new TextEncoder().encode(input.text).length > MAX_TEXT_BYTES) {
        this.failed.set(documentId, item.text)
        this.pending.delete(documentId)
        this.lastError.value = `恢复快照超过 ${MAX_TEXT_BYTES / (1024 * 1024)} MiB；当前文档未获得崩溃恢复保护`
        this.notify(this.lastError.value)
        continue
      }
      const generation = this.generation(documentId)
      try {
        const result = await this.gateway.save(input)
        if (generation !== this.generation(documentId)) {
          // A save/discard completed while this write was in flight.
          if (!this.manager.metadata(documentId)?.dirty) await this.removeSnapshot(result.record.id)
          continue
        }
        this.activeIds.set(documentId, result.record.id)
        this.failed.delete(documentId)
        this.lastError.value = null
        if (result.warnings.length) this.notify(result.warnings.join('\n'))
        const latest = this.manager.getState(documentId)?.doc
        if (!latest || latest !== item.text) {
          if (latest) this.pending.set(documentId, { text: latest, due: Date.now() + this.debounceMs })
        } else {
          this.lastSaved.set(documentId, item.text)
          this.savedSummaries.set(documentId, result.record)
          this.pending.delete(documentId)
        }
      } catch (error) {
        if (generation !== this.generation(documentId)) continue
        this.failed.set(documentId, item.text)
        const latest = this.manager.getState(documentId)?.doc
        // Failure of an older in-flight write must not drop edits queued while
        // it was running. Only suppress retry of the exact failed Text.
        if (latest && latest !== item.text) this.pending.set(documentId, { text: latest, due: Date.now() + this.debounceMs })
        else this.pending.delete(documentId)
        this.lastError.value = `恢复快照未保存：${String(error)}`
        this.notify(this.lastError.value)
      }
    }
    this.schedule()
  }

  private panesFor(documentId: string): RecoveryPane[] {
    const panes: RecoveryPane[] = []
    for (const pane of this.manager.layout.getAllPanes()) {
      if (!pane.group.tabs.some(tab => tab.documentId === documentId)) continue
      panes.push({ pane: pane.id, mode: (this.manager.getMarkdownMode(documentId, pane.id) || null) as RecoveryMode | null })
    }
    return panes.length ? panes : [{ pane: 'main', mode: null }]
  }

  private createDraft(body: { id: string; name: string; text: string; encoding: string; bom?: boolean; eol?: 'LF' | 'CRLF' | 'CR' | 'Mixed'; mode?: RecoveryMode | null }): string | null {
    let id = `recovered-${body.id}`
    if (this.manager.metadata(id)) id = `${id}-${Date.now()}`
    return this.manager.createRecoveredDocument({ id, name: body.name, text: body.text, encoding: body.encoding, bom: body.bom, eol: body.eol, mode: (body.mode || undefined) as MarkdownMode | undefined })
  }

  private applyPlacements(documentId: string, panes: RecoveryPane[]) {
    const leaves = this.manager.layout.getAllLeafIds()
    const primary = leaves[0] || 'main'
    this.manager.open(documentId, false, primary, false)
    const extra = panes.find(pane => pane.pane !== 'main')
    if (extra) {
      let target = leaves.find(id => id !== primary)
      if (!target) target = this.manager.splitPane('right', primary, documentId)
      if (target) {
        this.manager.open(documentId, false, target, false)
        if (extra.mode) this.manager.setMarkdownMode(documentId, extra.mode, target)
      }
    }
    for (const placement of panes) {
      if (!placement.mode) continue
      if (this.manager.layout.getPane(placement.pane)) this.manager.setMarkdownMode(documentId, placement.mode, placement.pane)
    }
    this.manager.pin(documentId)
    this.manager.focusPane(primary, false)
  }

  private generation(documentId: string) {
    return this.generations.get(documentId) || 0
  }

  private bumpGeneration(documentId: string) {
    this.generations.set(documentId, this.generation(documentId) + 1)
  }

  private async removeSnapshot(id: string) {
    try {
      await this.gateway.remove(id)
      this.records.value = this.records.value.filter(record => record.id !== id)
    } catch (error) {
      this.lastError.value = `清理恢复快照失败：${String(error)}`
      this.notify(this.lastError.value)
    }
  }
}

function allowedEncoding(encoding: string) {
  return ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'GB18030', 'windows-1252'].includes(encoding) ? encoding : 'UTF-8'
}
