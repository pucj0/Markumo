export interface Tab { documentId: string; pinned: boolean }

// A pane owns a tab group; document state stays in DocumentManager.
export class TabGroup {
  readonly tabs: Tab[] = []
  private currentId: string | null = null
  private recent: string[] = []
  get activeId() { return this.currentId }
  set activeId(id: string | null) {
    if (id === this.currentId) return
    this.currentId = id
    if (id) this.recent = [id, ...this.recent.filter(previous => previous !== id)]
  }
  get recentDocumentIds(): string[] {
    const present = new Set(this.tabs.map(tab => tab.documentId))
    this.recent = this.recent.filter(id => present.has(id))
    return [...this.recent.filter(id => present.delete(id)), ...present]
  }
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
        this.recent = this.recent.filter(id => id !== replaced)
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
    this.recent = this.recent.filter(id => id !== documentId)
    if (this.activeId === documentId) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.documentId || null
  }
}
