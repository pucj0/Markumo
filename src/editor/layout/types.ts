import type { TabGroup } from '../../features/tabs/TabGroup'

export type SplitDirection = 'left' | 'right' | 'top' | 'bottom'
export type SplitOrientation = 'horizontal' | 'vertical' // horizontal = side-by-side columns; vertical = stacked rows

export interface PaneLeafNode {
  type: 'leaf'
  id: string // stable paneId
}

export interface PaneSplitNode {
  type: 'split'
  id: string // splitId
  orientation: SplitOrientation
  ratio: number // 0.05 to 0.95, default 0.5
  first: LayoutNode
  second: LayoutNode
}

export type LayoutNode = PaneLeafNode | PaneSplitNode

export interface EditorPaneModel {
  id: string
  group: TabGroup
}

export type SerializedLayoutNode =
  | { type: 'leaf'; id: string; tabs: { documentId: string; pinned: boolean }[]; activeId: string | null }
  | { type: 'split'; id: string; orientation: SplitOrientation; ratio: number; first: SerializedLayoutNode; second: SerializedLayoutNode }
