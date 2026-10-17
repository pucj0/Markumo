import { TabGroup } from '../../features/tabs/TabGroup'
import type { LayoutNode, PaneLeafNode, PaneSplitNode, EditorPaneModel, SplitDirection, SplitOrientation, SerializedLayoutNode } from './types'

export class EditorLayoutManager {
  root: LayoutNode = { type: 'leaf', id: 'main' }
  readonly panes = new Map<string, EditorPaneModel>()
  activePaneId = 'main'
  maximizedPaneId: string | null = null

  private nextPaneSeq = 1
  private nextSplitSeq = 1
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.panes.set('main', { id: 'main', group: new TabGroup('main') })
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify() {
    for (const listener of this.listeners) listener()
  }

  getPane(paneId: string): EditorPaneModel | undefined {
    return this.panes.get(paneId)
  }

  getAllPanes(): EditorPaneModel[] {
    return [...this.panes.values()]
  }

  getPrimaryPane(): EditorPaneModel {
    return this.panes.get('main') || this.panes.values().next().value!
  }

  getAllLeafIds(node: LayoutNode = this.root): string[] {
    if (node.type === 'leaf') return [node.id]
    return [...this.getAllLeafIds(node.first), ...this.getAllLeafIds(node.second)]
  }

  findLeafNode(paneId: string, node: LayoutNode = this.root): PaneLeafNode | null {
    if (node.type === 'leaf') return node.id === paneId ? node : null
    return this.findLeafNode(paneId, node.first) || this.findLeafNode(paneId, node.second)
  }

  findParentSplit(targetId: string, node: LayoutNode = this.root): { parent: PaneSplitNode; isFirst: boolean } | null {
    if (node.type === 'leaf') return null
    if (node.first.id === targetId) return { parent: node, isFirst: true }
    if (node.second.id === targetId) return { parent: node, isFirst: false }
    return this.findParentSplit(targetId, node.first) || this.findParentSplit(targetId, node.second)
  }

  findSplitNode(splitId: string, node: LayoutNode = this.root): PaneSplitNode | null {
    if (node.type === 'leaf') return null
    if (node.id === splitId) return node
    return this.findSplitNode(splitId, node.first) || this.findSplitNode(splitId, node.second)
  }

  focusPane(paneId: string) {
    if (this.panes.has(paneId)) {
      if (this.activePaneId !== paneId) {
        this.activePaneId = paneId
        this.notify()
      }
    }
  }

  splitPane(targetPaneId: string, direction: SplitDirection, openDocId?: string, pinned = false): string {
    const targetLeaf = this.findLeafNode(targetPaneId)
    if (!targetLeaf) return targetPaneId

    const newPaneId = !this.panes.has('secondary') ? 'secondary' : `pane-${Date.now()}-${++this.nextPaneSeq}`
    const newGroup = new TabGroup(newPaneId)
    if (openDocId) {
      newGroup.open(openDocId, !pinned)
    }
    this.panes.set(newPaneId, { id: newPaneId, group: newGroup })

    const newLeaf: PaneLeafNode = { type: 'leaf', id: newPaneId }
    const orientation: SplitOrientation = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical'
    const isFirstNew = direction === 'left' || direction === 'top'
    const first = isFirstNew ? newLeaf : targetLeaf
    const second = isFirstNew ? targetLeaf : newLeaf

    const splitNode: PaneSplitNode = {
      type: 'split',
      id: `split-${Date.now()}-${++this.nextSplitSeq}`,
      orientation,
      ratio: 0.5,
      first,
      second,
    }

    this.replaceNodeInTree(targetPaneId, splitNode)
    this.maximizedPaneId = null
    this.activePaneId = newPaneId
    this.notify()
    return newPaneId
  }

  private replaceNodeInTree(targetId: string, replacement: LayoutNode) {
    if (this.root.id === targetId) {
      this.root = replacement
      return
    }
    const parentInfo = this.findParentSplit(targetId)
    if (parentInfo) {
      if (parentInfo.isFirst) parentInfo.parent.first = replacement
      else parentInfo.parent.second = replacement
    }
  }

  resizeSplit(splitId: string, ratio: number): boolean {
    const split = this.findSplitNode(splitId)
    if (!split) return false
    const clamped = Math.max(0.05, Math.min(0.95, ratio))
    if (Math.abs(split.ratio - clamped) > 0.001) {
      split.ratio = clamped
      this.notify()
      return true
    }
    return false
  }

  closeTab(paneId: string, documentId: string): { closed: boolean; paneRemoved: boolean; nextActiveId: string | null } {
    const pane = this.panes.get(paneId)
    if (!pane) return { closed: false, paneRemoved: false, nextActiveId: null }
    pane.group.close(documentId)

    if (pane.group.tabs.length === 0) {
      if (this.getAllLeafIds().length > 1) {
        this.closePane(paneId)
        return { closed: true, paneRemoved: true, nextActiveId: null }
      } else {
        this.collapseEmptyPanes()
      }
    }
    this.notify()
    return { closed: true, paneRemoved: false, nextActiveId: pane.group.activeId }
  }

  closePane(paneId: string): boolean {
    const leaves = this.getAllLeafIds()
    if (leaves.length <= 1) {
      return false
    }
    const parentInfo = this.findParentSplit(paneId)
    if (!parentInfo) return false

    const sibling = parentInfo.isFirst ? parentInfo.parent.second : parentInfo.parent.first
    this.replaceNodeInTree(parentInfo.parent.id, sibling)
    this.panes.delete(paneId)

    if (this.maximizedPaneId === paneId) {
      this.maximizedPaneId = null
    }

    if (this.activePaneId === paneId) {
      const remaining = this.getAllLeafIds()
      this.activePaneId = remaining[0] || 'main'
    }

    this.collapseEmptyPanes()
    this.notify()
    return true
  }

  collapseEmptyPanes(): boolean {
    let changed = false
    while (true) {
      const leaves = this.getAllLeafIds()
      if (leaves.length <= 1) {
        const soleId = leaves[0]
        if (soleId && soleId !== 'main' && this.panes.get(soleId)?.group.tabs.length === 0) {
          const solePane = this.panes.get(soleId)!
          this.panes.delete(soleId)
          const newGroup = new TabGroup('main')
          newGroup.tabs.push(...solePane.group.tabs)
          newGroup.activeId = solePane.group.activeId
          this.panes.set('main', { id: 'main', group: newGroup })
          this.root = { type: 'leaf', id: 'main' }
          this.activePaneId = 'main'
          changed = true
        }
        break
      }
      let removedAny = false
      for (const leafId of leaves) {
        const pane = this.panes.get(leafId)
        if (pane && pane.group.tabs.length === 0) {
          const parentInfo = this.findParentSplit(leafId)
          if (parentInfo) {
            const sibling = parentInfo.isFirst ? parentInfo.parent.second : parentInfo.parent.first
            this.replaceNodeInTree(parentInfo.parent.id, sibling)
            this.panes.delete(leafId)
            if (this.activePaneId === leafId) {
              this.activePaneId = this.getAllLeafIds()[0] || 'main'
            }
            removedAny = true
            changed = true
            break
          }
        }
      }
      if (!removedAny) break
    }
    if (changed) this.notify()
    return changed
  }

  moveTab(documentId: string, fromPaneId: string, toPaneId: string, targetIndex?: number): boolean {
    const fromPane = this.panes.get(fromPaneId)
    const toPane = this.panes.get(toPaneId)
    if (!fromPane || !toPane) return false

    const fromTabIdx = fromPane.group.tabs.findIndex(t => t.documentId === documentId)
    if (fromTabIdx < 0) return false

    if (fromPaneId === toPaneId) {
      // targetIndex is an insertion slot in the original list, before removal.
      const slot = targetIndex ?? fromPane.group.tabs.length
      fromPane.group.pin(documentId)
      fromPane.group.activeId = documentId
      this.activePaneId = toPaneId
      return this.reorderTab(fromPaneId, documentId, slot > fromTabIdx ? slot - 1 : slot)
    }

    const [tab] = fromPane.group.tabs.splice(fromTabIdx, 1)
    if (fromPane.group.activeId === documentId) {
      fromPane.group.activeId = fromPane.group.tabs[Math.min(fromTabIdx, fromPane.group.tabs.length - 1)]?.documentId || null
    }

    let slot = targetIndex ?? toPane.group.tabs.length
    const existingInTo = toPane.group.tabs.findIndex(t => t.documentId === documentId)
    if (existingInTo >= 0) {
      toPane.group.tabs.splice(existingInTo, 1)
      if (existingInTo < slot) slot--
    }

    tab.pinned = true
    toPane.group.tabs.splice(Math.max(0, Math.min(toPane.group.tabs.length, slot)), 0, tab)
    toPane.group.activeId = documentId
    this.activePaneId = toPaneId

    if (fromPane.group.tabs.length === 0 && this.getAllLeafIds().length > 1) {
      this.closePane(fromPaneId)
    }

    this.notify()
    return true
  }

  reorderTab(paneId: string, documentId: string, targetIndex: number): boolean {
    const pane = this.panes.get(paneId)
    if (!pane) return false
    const currentIndex = pane.group.tabs.findIndex(t => t.documentId === documentId)
    if (currentIndex < 0) return false
    const [tab] = pane.group.tabs.splice(currentIndex, 1)
    const safeIndex = Math.max(0, Math.min(pane.group.tabs.length, targetIndex))
    pane.group.tabs.splice(safeIndex, 0, tab)
    this.notify()
    return true
  }

  maximizePane(paneId: string) {
    if (this.panes.has(paneId)) {
      this.maximizedPaneId = paneId
      this.activePaneId = paneId
      this.notify()
    }
  }

  restoreMaximized() {
    if (this.maximizedPaneId !== null) {
      this.maximizedPaneId = null
      this.notify()
    }
  }

  toggleMaximize(paneId: string = this.activePaneId) {
    if (this.maximizedPaneId === paneId) {
      this.restoreMaximized()
    } else {
      this.maximizePane(paneId)
    }
  }

  mergeAllPanes() {
    const leaves = this.getAllLeafIds()
    if (leaves.length <= 1) return

    const primaryPane = this.panes.get('main') || this.panes.get(leaves[0])!
    const targetPaneId = primaryPane.id

    for (const leafId of leaves) {
      if (leafId === targetPaneId) continue
      const pane = this.panes.get(leafId)
      if (pane) {
        for (const tab of pane.group.tabs) {
          if (!primaryPane.group.tabs.some(t => t.documentId === tab.documentId)) {
            primaryPane.group.tabs.push({ ...tab, pinned: true })
          }
        }
      }
      this.panes.delete(leafId)
    }

    this.root = { type: 'leaf', id: targetPaneId }
    this.activePaneId = targetPaneId
    this.maximizedPaneId = null
    this.notify()
  }

  focusNextPane() {
    const leaves = this.getAllLeafIds()
    if (leaves.length <= 1) return
    const currentIdx = leaves.indexOf(this.activePaneId)
    const nextIdx = (currentIdx + 1) % leaves.length
    this.focusPane(leaves[nextIdx])
  }

  focusDirection(direction: 'left' | 'right' | 'up' | 'down'): boolean {
    const leaves = this.getAllLeafIds()
    if (leaves.length <= 1) return false

    const targetOrientation: SplitOrientation = (direction === 'left' || direction === 'right') ? 'horizontal' : 'vertical'
    const wantFirst = (direction === 'left' || direction === 'up')

    let currentId = this.activePaneId
    let targetSubtree: LayoutNode | null = null

    while (currentId !== this.root.id) {
      const parentInfo = this.findParentSplit(currentId)
      if (!parentInfo) break
      const parent = parentInfo.parent
      if (parent.orientation === targetOrientation) {
        if (wantFirst && !parentInfo.isFirst) {
          targetSubtree = parent.first
          break
        } else if (!wantFirst && parentInfo.isFirst) {
          targetSubtree = parent.second
          break
        }
      }
      currentId = parent.id
    }

    if (targetSubtree) {
      const subLeaves = this.getAllLeafIds(targetSubtree)
      const targetLeaf = wantFirst ? subLeaves[subLeaves.length - 1] : subLeaves[0]
      if (targetLeaf) {
        this.focusPane(targetLeaf)
        return true
      }
    }

    const currentIdx = leaves.indexOf(this.activePaneId)
    if (currentIdx < 0) return false
    const offset = wantFirst ? -1 : 1
    const nextIdx = (currentIdx + offset + leaves.length) % leaves.length
    this.focusPane(leaves[nextIdx])
    return true
  }

  serialize(): SerializedLayoutNode {
    const serializeNode = (node: LayoutNode): SerializedLayoutNode => {
      if (node.type === 'leaf') {
        const pane = this.panes.get(node.id)
        return {
          type: 'leaf',
          id: node.id,
          tabs: pane ? pane.group.tabs.map(t => ({ documentId: t.documentId, pinned: t.pinned })) : [],
          activeId: pane?.group.activeId || null,
        }
      }
      return {
        type: 'split',
        id: node.id,
        orientation: node.orientation,
        ratio: node.ratio,
        first: serializeNode(node.first),
        second: serializeNode(node.second),
      }
    }
    return serializeNode(this.root)
  }

  deserialize(data: any): boolean {
    try {
      if (!data || typeof data !== 'object') return false

      // Handle legacy main/secondary format
      if ('isSplit' in data && typeof data.isSplit === 'boolean') {
        this.panes.clear()
        const main = { id: 'main', group: new TabGroup('main') }
        this.panes.set('main', main)
        if (data.isSplit) {
          const secondary = { id: 'secondary', group: new TabGroup('secondary') }
          this.panes.set('secondary', secondary)
          this.root = {
            type: 'split',
            id: 'split-legacy',
            orientation: 'horizontal',
            ratio: typeof data.ratio === 'number' ? data.ratio : 0.5,
            first: { type: 'leaf', id: 'main' },
            second: { type: 'leaf', id: 'secondary' },
          }
        } else {
          this.root = { type: 'leaf', id: 'main' }
        }
        this.activePaneId = 'main'
        this.notify()
        return true
      }

      const parseNode = (raw: any): LayoutNode => {
        if (raw.type === 'leaf' && typeof raw.id === 'string') {
          let pane = this.panes.get(raw.id)
          if (!pane) {
            pane = { id: raw.id, group: new TabGroup(raw.id) }
            this.panes.set(raw.id, pane)
          }
          if (Array.isArray(raw.tabs)) {
            pane.group.tabs.length = 0
            for (const t of raw.tabs) {
              if (t && typeof t.documentId === 'string') {
                pane.group.tabs.push({ documentId: t.documentId, pinned: !!t.pinned })
              }
            }
            pane.group.activeId = typeof raw.activeId === 'string' ? raw.activeId : (pane.group.tabs[0]?.documentId || null)
          }
          return { type: 'leaf', id: raw.id }
        }
        if (raw.type === 'split' && raw.first && raw.second) {
          return {
            type: 'split',
            id: typeof raw.id === 'string' ? raw.id : `split-${++this.nextSplitSeq}`,
            orientation: raw.orientation === 'vertical' ? 'vertical' : 'horizontal',
            ratio: typeof raw.ratio === 'number' ? Math.max(0.05, Math.min(0.95, raw.ratio)) : 0.5,
            first: parseNode(raw.first),
            second: parseNode(raw.second),
          }
        }
        throw new Error('Invalid layout node')
      }

      this.panes.clear()
      this.root = parseNode(data)
      const leaves = this.getAllLeafIds()
      if (leaves.length === 0) {
        this.root = { type: 'leaf', id: 'main' }
        this.panes.set('main', { id: 'main', group: new TabGroup('main') })
        this.activePaneId = 'main'
      } else {
        this.activePaneId = leaves[0]
      }
      this.notify()
      return true
    } catch {
      return false
    }
  }

  cleanupMissingDocuments(validDocIds: Set<string>) {
    for (const pane of this.panes.values()) {
      for (let i = pane.group.tabs.length - 1; i >= 0; i--) {
        if (!validDocIds.has(pane.group.tabs[i].documentId)) {
          pane.group.tabs.splice(i, 1)
        }
      }
      if (pane.group.activeId && !validDocIds.has(pane.group.activeId)) {
        pane.group.activeId = pane.group.tabs[0]?.documentId || null
      }
    }
    this.collapseEmptyPanes()
    this.notify()
  }
}
