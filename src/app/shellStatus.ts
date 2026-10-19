/**
 * Pure status computation functions for shell lifecycle and desktop integration.
 * Centralizing these expressions prevents accidental inversion of boolean flags
 * (such as Set.size > 0 vs !Set.size or visible vs !visible).
 */

export interface WindowCloseStatusInput {
  fileBusy: boolean
  workspaceBusy: boolean
  updateInstalling: boolean
  updateConfirmVisible: boolean
  savingCount: number
  composing: boolean
  dirtyCount: number
  documentCount: number
  activePane: string
  activeId: string | null
}

export function computeWindowCloseStatus(input: WindowCloseStatusInput) {
  return {
    fileBusy:
      input.fileBusy ||
      input.workspaceBusy ||
      input.updateInstalling ||
      input.updateConfirmVisible,
    savingCount: input.savingCount,
    composing: input.composing,
    dirtyCount: input.dirtyCount,
    documentCount: input.documentCount,
    activePane: input.activePane,
    hasActiveDocument: Boolean(input.activeId),
  }
}

export interface UpdateReportStatusInput {
  dirtyCount: number
  fileBusy: boolean
  workspaceBusy: boolean
  savingCount: number
  composing: boolean
  ready: boolean
}

export function computeUpdateReportStatus(input: UpdateReportStatusInput) {
  return {
    dirtyCount: input.dirtyCount,
    busy: input.fileBusy || input.workspaceBusy || input.savingCount > 0,
    composing: input.composing,
    ready: input.ready,
  }
}

export interface UpdatePrepareBusyInput {
  startupLoading: boolean
  fileBusy: boolean
  workspaceBusy: boolean
  savingCount: number
  discardVisible: boolean
  hasWorkspaceDialog: boolean
}

export function computeUpdatePrepareBusy(input: UpdatePrepareBusyInput) {
  return (
    input.startupLoading ||
    input.fileBusy ||
    input.workspaceBusy ||
    input.savingCount > 0 ||
    input.discardVisible ||
    input.hasWorkspaceDialog
  )
}
