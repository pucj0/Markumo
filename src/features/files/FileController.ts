import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { Encoding, FileGateway, OpenBatch, OpenFile } from './contracts'

export function fileError(error: unknown) {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '文件操作失败；编辑内容仍保留。'
}

// A single save per document. Snapshot completion uses its original CM Text,
// allowing edits during IPC without incorrectly clearing the dirty flag.
export class FileController {
  readonly saving = new Set<string>()
  workspaceBusy = false
  private disposed = false
  constructor(readonly manager: DocumentManager, readonly gateway: FileGateway, private readonly notify: (message: string) => void) {}

  accept(file: OpenFile, preview = false) {
    if (this.disposed) { void this.gateway.release(file.token).catch(() => {}); return false }
    const existing = this.manager.openedDocuments.find(doc => doc.fileToken && doc.path === file.path)
    const before = this.manager.openedDocuments
    if (!this.manager.openFile(file, preview)) {
      if (file.token !== existing?.fileToken) void this.gateway.release(file.token).catch(() => {})
      this.notify('请先完成输入法输入，再重新打开文件。')
      return false
    }
    const openedIds = new Set(this.manager.openedDocuments.map(doc => doc.id))
    for (const doc of before) {
      if (doc.fileToken && !openedIds.has(doc.id)) void this.gateway.release(doc.fileToken).catch(error => this.notify(fileError(error)))
    }
    if (existing && existing.fileToken !== file.token) void this.gateway.release(file.token).catch(error => this.notify(fileError(error)))
    if (existing && existing.lastDiskVersion !== file.version) this.notify('检测到磁盘版本变化。保留当前编辑内容；请先另存为，再关闭并重开原文件。')
    else if (file.warning) this.notify(file.warning)
    return true
  }
  acceptBatch(batch: OpenBatch) {
    for (const file of batch.files) this.accept(file)
    if (batch.errors.length) this.notify(batch.errors.join('\n'))
  }
  async open(encoding?: Encoding) {
    try { this.acceptBatch(await this.gateway.openDialog(encoding)) }
    catch (error) { this.notify(fileError(error)) }
  }
  async recent(path: string, encoding?: Encoding) {
    try { this.accept(await this.gateway.openRecent(path, encoding)) }
    catch (error) { this.notify(fileError(error)) }
  }
  async save(id: string, saveAs = false, encoding?: Encoding) {
    return await this.performSave(id, saveAs, encoding, false) === 'saved'
  }
  async autoSave(id: string) {
    const doc = this.manager.metadata(id)
    if (!doc?.fileToken || !doc.dirty || doc.readOnly || this.manager.isComposing || this.workspaceBusy || this.saving.has(id)) return 'skipped' as const
    return this.performSave(id, false, undefined, true)
  }
  private async performSave(id: string, saveAs: boolean, encoding: Encoding | undefined, automatic: boolean): Promise<'saved' | 'changed' | 'failed' | 'skipped'> {
    if (this.workspaceBusy) { if (!automatic) this.notify('工作区文件操作进行中，请稍后保存。'); return 'skipped' }
    if (this.disposed || this.saving.has(id)) return 'skipped'
    const snapshot = this.manager.saveSnapshot(id)
    if (!snapshot) { if (!automatic) this.notify('请先完成输入法输入，再保存。'); return 'skipped' }
    this.saving.add(id)
    let targetToken: string | undefined
    const source = snapshot.metadata
    try {
      let token = source.fileToken
      let version = source.lastDiskVersion
      if (!token || saveAs) {
        const target = await this.gateway.saveTarget(token ?? null, source.name)
        if (!target) return 'skipped'
        targetToken = target.token
        if (this.disposed) return 'skipped'
        token = target.token
        version = target.version
      }
      const result = await this.gateway.save(token!, snapshot.text, version, encoding || source.encoding as Encoding, encoding ? false : source.bom)
      targetToken = undefined
      const accepted = snapshot.complete(result)
      if (accepted && source.fileToken && source.fileToken !== result.token) await this.gateway.release(source.fileToken).catch(() => {})
      if (!accepted) await this.gateway.release(result.token).catch(() => {})
      if (accepted && result.warning) this.notify(result.warning)
      return !accepted ? 'skipped' : this.manager.metadata(id)?.dirty ? 'changed' : 'saved'
    } catch (error) {
      this.notify(`${automatic ? '自动保存已暂停：' : ''}${fileError(error)}\n内容仍保留；可使用另存为保存到其他文件。`)
      return 'failed'
    } finally {
      if (targetToken && targetToken !== source.fileToken) await this.gateway.release(targetToken).catch(() => {})
      this.saving.delete(id)
    }
  }
  async reopen(encoding: Encoding) {
    const doc = this.manager.activeDocument
    if (!doc?.fileToken) { this.notify('请先打开真实文件。'); return }
    if (doc.dirty || this.manager.isComposing || this.saving.has(doc.id)) {
      this.notify('请先保存修改并完成输入，再用其他编码重开。'); return
    }
    try {
      const file = await this.gateway.reopen(doc.fileToken, encoding)
      if (!this.manager.reloadFile(doc.id, file)) {
        if (file.token !== doc.fileToken) await this.gateway.release(file.token).catch(() => {})
        this.notify('重开期间文档已修改，保留现有编辑内容。')
      } else {
        if (file.token !== doc.fileToken) await this.gateway.release(doc.fileToken).catch(() => {})
        if (file.warning) this.notify(file.warning)
      }
    } catch (error) { this.notify(fileError(error)) }
  }
  close(id: string, discard = false, pane: 'main' | 'secondary' = this.manager.activePane) {
    if (this.saving.has(id)) { this.notify('保存进行中，请稍后关闭。'); return 'saving' as const }
    const token = this.manager.metadata(id)?.fileToken
    const result = this.manager.close(id, discard, pane)
    if (result === 'closed' && token && !this.manager.metadata(id)) void this.gateway.release(token).catch(error => this.notify(fileError(error)))
    return result
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    // HMR can dispose the frontend while the Rust process keeps running.
    for (const token of new Set(this.manager.openedDocuments.map(doc => doc.fileToken).filter((token): token is string => !!token))) {
      void this.gateway.release(token).catch(() => {})
    }
  }
}
