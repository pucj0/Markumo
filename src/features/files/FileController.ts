import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { Encoding, FileOpenEncoding, FileGateway, OpenBatch, OpenFile } from './contracts'
import { sameFilePath } from './pathKey'
import { isMedia } from './media'
import { ExternalFileChangeController } from './ExternalFileChangeController'

export function fileError(error: unknown) {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '文件操作失败；编辑内容仍保留。'
}

// A single save per document. Snapshot completion uses its original CM Text,
// allowing edits during IPC without incorrectly clearing the dirty flag.
export class FileController {
  readonly external: ExternalFileChangeController
  readonly saving = new Set<string>()
  get activeOperationCount() { return this.saving.size + this.external.resolvingCount }
  workspaceBusy = false
  private disposed = false
  private readonly stopRelease: () => void
  constructor(readonly manager: DocumentManager, readonly gateway: FileGateway, private readonly notify: (message: string) => void, private saved?: (id: string) => void | Promise<void>) {
    this.stopRelease = manager.onFileRelease(token => { void gateway.release(token).catch(error => notify(fileError(error))) })
    this.external = new ExternalFileChangeController(manager, this, notify)
  }
  setSavedHandler(handler: (id: string) => void | Promise<void>) { this.saved = handler }

  accept(file: OpenFile, preview = false, pane = this.manager.activePane, activatePane = true) {
    if (this.disposed) { void this.gateway.release(file.token).catch(() => {}); return false }
    const existing = this.manager.openedDocuments.find(doc => doc.fileToken && sameFilePath(doc.path, file.path))
    if (!this.manager.openFile(file, preview, pane, activatePane)) {
      if (file.token !== existing?.fileToken) void this.gateway.release(file.token).catch(() => {})
      this.notify('请先完成输入法输入，再重新打开文件。')
      return false
    }
    if (existing && isMedia(existing) && existing.lastDiskVersion !== file.version) {
      // Reopening a read-only preview should pick up external changes, without duplicating the document.
      if (this.manager.reloadFile(existing.id, file)) {
        if (existing.fileToken && existing.fileToken !== file.token) void this.gateway.release(existing.fileToken).catch(() => {})
        return true
      }
    }
    if (existing && existing.fileToken !== file.token) void this.gateway.release(file.token).catch(error => this.notify(fileError(error)))
    if (existing && existing.lastDiskVersion !== file.version) void this.external.check(existing.id)
    else if (file.warning) this.notify(file.warning)
    return true
  }
  acceptBatch(batch: OpenBatch) {
    for (const file of batch.files) this.accept(file)
    if (batch.errors.length) this.notify(batch.errors.join('\n'))
  }
  async open(encoding?: FileOpenEncoding) {
    try { this.acceptBatch(await this.gateway.openDialog(encoding)) }
    catch (error) { this.notify(fileError(error)) }
  }
  async recent(path: string, encoding?: FileOpenEncoding) {
    try { this.accept(await this.gateway.openRecent(path, encoding)) }
    catch (error) { this.notify(fileError(error)) }
  }
  async save(id: string, saveAs = false, encoding?: Encoding, bom?: boolean) {
    return await this.performSave(id, saveAs, encoding, bom, false) === 'saved'
  }
  async autoSave(id: string) {
    const doc = this.manager.metadata(id)
    if (!doc?.fileToken || doc.kind === 'javaClass' || !doc.dirty || doc.readOnly || this.manager.isComposing || this.workspaceBusy || this.saving.has(id)) return 'skipped' as const
    return this.performSave(id, false, undefined, undefined, true)
  }
  private async performSave(id: string, saveAs: boolean, encoding: Encoding | undefined, bom: boolean | undefined, automatic: boolean): Promise<'saved' | 'changed' | 'failed' | 'skipped'> {
    if (this.external.resolving(id) || (!saveAs && this.external.blocked(id))) {
      if (!automatic) { this.external.keep(id, false); this.notify('磁盘版本正在检查或已变化，请先比较差异、另存为或加载磁盘。') }
      return 'skipped'
    }
    if (isMedia(this.manager.metadata(id))) return 'skipped'
    if (this.manager.metadata(id)?.kind === 'javaClass') { if (!automatic) this.notify('ClassFile 仅供只读查看，不能作为文本保存或另存为。'); return 'skipped' }
    if (this.manager.metadata(id)?.encoding === 'Hex' && encoding && encoding !== 'Hex') {
      this.notify('字节编辑内容请直接保存或另存为；不能把十六进制显示文字作为原文件的文本编码保存。'); return 'skipped'
    }
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
        if (source.fileToken && sameFilePath(target.path, source.path)) {
          this.notify('另存为不能覆盖原文件，请选择其他文件名；原文件仍受版本保护。')
          return 'skipped'
        }
        token = target.token
        version = target.version
      }
      const targetEncoding = encoding || source.encoding as Encoding
      const targetBom = bom !== undefined ? bom : (encoding ? false : source.bom)
      if (this.disposed || !this.manager.metadata(id) || this.manager.metadata(id)?.fileToken !== source.fileToken) return 'skipped'
      if (!saveAs && this.external.blocked(id)) return 'skipped'
      const result = await this.gateway.save(token!, snapshot.text, version, targetEncoding, targetBom)
      targetToken = undefined
      const accepted = snapshot.complete(result)
      if (accepted && source.fileToken && source.fileToken !== result.token) await this.gateway.release(source.fileToken).catch(() => {})
      if (!accepted) await this.gateway.release(result.token).catch(() => {})
      if (accepted) await this.saved?.(id)
      if (accepted) this.external.saved(id)
      if (accepted && result.warning) this.notify(result.warning)
      return !accepted ? 'skipped' : this.manager.metadata(id)?.dirty ? 'changed' : 'saved'
    } catch (error) {
      if (!saveAs) this.external.saveFailed(id, error)
      this.notify(`${automatic ? '自动保存已暂停：' : ''}${fileError(error)}\n内容仍保留；可使用另存为保存到其他文件。`)
      return 'failed'
    } finally {
      if (targetToken && targetToken !== source.fileToken) await this.gateway.release(targetToken).catch(() => {})
      this.saving.delete(id)
    }
  }
  async reopen(encoding: FileOpenEncoding, force = false) {
    const doc = this.manager.activeDocument
    if (isMedia(doc)) return
    if (doc?.kind === 'javaClass' && encoding !== 'Hex') { this.notify('请使用“编辑文件字节”切回可编辑内容。'); return }
    if (!doc?.fileToken) { this.notify('请先打开真实文件。'); return }
    if (this.external.blocked(doc.id)) { this.notify('请先处理外部变化，再切换文件编码。'); return }
    if (!force && (doc.dirty || this.manager.isComposing || this.saving.has(doc.id))) {
      this.notify('请先保存修改并完成输入，再用其他编码重开。'); return
    }
    try {
      const file = await this.gateway.reopen(doc.fileToken, encoding)
      if (!this.manager.reloadFile(doc.id, file, force)) {
        if (file.token !== doc.fileToken) await this.gateway.release(file.token).catch(() => {})
        this.notify('重开期间文档已修改，保留现有编辑内容。')
      } else {
        if (file.token !== doc.fileToken) await this.gateway.release(doc.fileToken).catch(() => {})
        if (file.warning) this.notify(file.warning)
      }
    } catch (error) { this.notify(fileError(error)) }
  }
  close(id: string, discard = false, pane: string = this.manager.activePane) {
    if (this.external.resolving(id)) { this.notify('文件处理进行中，请稍后关闭。'); return 'saving' as const }
    if (this.saving.has(id)) { this.notify('保存进行中，请稍后关闭。'); return 'saving' as const }
    const result = this.manager.close(id, discard, pane)
    return result
  }
  async classHex(id: string, offset: number) {
    const doc = this.manager.metadata(id)
    if (this.disposed || doc?.kind !== 'javaClass' || !doc.fileToken || !doc.lastDiskVersion || !this.gateway.readClassHex) throw new Error('ClassFile 查看授权不可用。')
    return this.gateway.readClassHex(doc.fileToken,doc.lastDiskVersion,offset)
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.external.dispose()
    this.stopRelease()
    // HMR can dispose the frontend while the Rust process keeps running.
    for (const token of new Set(this.manager.openedDocuments.map(doc => doc.fileToken).filter((token): token is string => !!token))) {
      void this.gateway.release(token).catch(() => {})
    }
  }
}
