export interface Tab { documentId: string; pinned: boolean }

// A pane owns a tab group; document state stays in DocumentManager.
export class TabGroup {
  readonly tabs: Tab[] = []
  activeId: string | null = null
  constructor(readonly id = 'main') {}

  open(documentId: string, preview = true, canReplace?: (docId: string) => boolean): string | null {
    const existing = this.tabs.find(tab => tab.documentId === documentId)
    let replaced: string | null = null
    if (existing) {
      if (!preview) existing.pinned = true
    } else {
      const previewIndex = preview
        ? this.tabs.findIndex(tab => !tab.pinned && (!canReplace || canReplace(tab.documentId)))
        : -1
      if (previewIndex >= 0) {
        replaced = this.tabs[previewIndex].documentId
        this.tabs.splice(previewIndex, 1, { documentId, pinned: false })
      } else {
        this.tabs.push({ documentId, pinned: !preview })
      }
    }
    this.activeId = documentId
    return replaced
  }

  pin(documentId: string) {
    const tab = this.tabs.find(tab => tab.documentId === documentId)
    if (tab) tab.pinned = true
  }

  unpin(documentId: string) {
    if (!this.tabs.some(tab => tab.documentId === documentId)) return
    for (const tab of this.tabs) tab.pinned = tab.documentId !== documentId
  }

  close(documentId: string) {
    const index = this.tabs.findIndex(tab => tab.documentId === documentId)
    if (index < 0) return
    this.tabs.splice(index, 1)
    if (this.activeId === documentId) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.documentId || null
  }
}
