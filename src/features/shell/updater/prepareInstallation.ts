export interface PreparationStatus { dirtyIds: string[]; busy: boolean; composing: boolean }
export interface PreparationServices {
  status(): PreparationStatus
  validateWindows(): Promise<void>
  confirmSave(count: number): Promise<boolean>
  save(id: string): Promise<boolean>
  lock(value: boolean): void
  persist(): Promise<void>
}
/** Preserve FileController's save dialogs, encoding and conflict checks. */
export async function prepareInstallation(services: PreparationServices): Promise<boolean> {
  const assertIdle = () => {
    const state = services.status()
    if (state.composing) throw Error('请先完成输入法组合输入，再安装更新。')
    if (state.busy) throw Error('文件读写或对话框尚未完成，请完成后重试。')
    return state
  }
  let prepared = false
  try {
    assertIdle(); await services.validateWindows(); const state = assertIdle()
    if (state.dirtyIds.length && !await services.confirmSave(state.dirtyIds.length)) return false
    const afterConfirmation = assertIdle()
    services.lock(true)
    for (const id of afterConfirmation.dirtyIds) if (!await services.save(id)) return false
    if (assertIdle().dirtyIds.length) throw Error('保存期间文档又发生修改，请检查后重试。')
    await services.persist()
    if (assertIdle().dirtyIds.length) throw Error('仍有未保存修改，已停止安装。')
    await services.validateWindows()
    prepared = true
    return true
  } finally { if (!prepared) services.lock(false) }
}
