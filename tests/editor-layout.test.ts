import { describe, it, expect } from 'vitest'
import { EditorLayoutManager } from '../src/editor/layout/EditorLayoutManager'

describe('EditorLayoutManager (Recursive Split Tree)', () => {
  it('initializes with a single main leaf pane', () => {
    const layout = new EditorLayoutManager()
    expect(layout.root).toEqual({ type: 'leaf', id: 'main' })
    expect(layout.getAllLeafIds()).toEqual(['main'])
    expect(layout.activePaneId).toBe('main')
    expect(layout.getAllPanes().length).toBe(1)
  })

  it('splits horizontally (right) and creates two panes', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('doc-1', false)
    const newPaneId = layout.splitPane('main', 'right', 'doc-2')

    expect(layout.getAllLeafIds()).toEqual(['main', newPaneId])
    expect(layout.root.type).toBe('split')
    if (layout.root.type === 'split') {
      expect(layout.root.orientation).toBe('horizontal')
      expect(layout.root.first).toEqual({ type: 'leaf', id: 'main' })
      expect(layout.root.second).toEqual({ type: 'leaf', id: newPaneId })
    }
    expect(layout.activePaneId).toBe(newPaneId)
    expect(layout.getPane(newPaneId)?.group.activeId).toBe('doc-2')
  })

  it('splits vertically (bottom) and creates nested 3-pane layout', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('doc-1', false)
    const pane2 = layout.splitPane('main', 'right', 'doc-2')
    const pane3 = layout.splitPane(pane2, 'bottom', 'doc-3')

    expect(layout.getAllLeafIds()).toEqual(['main', pane2, pane3])
    expect(layout.root.type).toBe('split')
    if (layout.root.type === 'split') {
      expect(layout.root.first).toEqual({ type: 'leaf', id: 'main' })
      expect(layout.root.second.type).toBe('split')
      const nested = layout.root.second
      if (nested.type === 'split') {
        expect(nested.orientation).toBe('vertical')
        expect(nested.first).toEqual({ type: 'leaf', id: pane2 })
        expect(nested.second).toEqual({ type: 'leaf', id: pane3 })
      }
    }
  })

  it('reorders tabs within the same pane', () => {
    const layout = new EditorLayoutManager()
    const group = layout.getPane('main')!.group
    group.open('a', false)
    group.open('b', false)
    group.open('c', false)

    expect(group.tabs.map(t => t.documentId)).toEqual(['a', 'b', 'c'])
    layout.reorderTab('main', 'c', 0)
    expect(group.tabs.map(t => t.documentId)).toEqual(['c', 'a', 'b'])
  })

  it('moves tabs across panes and collapses source pane if it becomes empty', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    const pane2 = layout.splitPane('main', 'right', 'b', true)

    expect(layout.getAllLeafIds().length).toBe(2)
    // Move 'b' from pane2 to 'main'
    const moved = layout.moveTab('b', pane2, 'main')
    expect(moved).toBe(true)
    expect(layout.getPane('main')?.group.tabs.map(t => t.documentId)).toEqual(['a', 'b'])

    // pane2 became empty, so it should be auto-reclaimed!
    expect(layout.getAllLeafIds()).toEqual(['main'])
    expect(layout.root).toEqual({ type: 'leaf', id: 'main' })
    expect(layout.panes.has(pane2)).toBe(false)
  })

  it('closing tab in non-unique pane auto-reclaims empty pane', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    const pane2 = layout.splitPane('main', 'right', 'b', true)
    const pane3 = layout.splitPane(pane2, 'bottom', 'c', true)

    expect(layout.getAllLeafIds()).toEqual(['main', pane2, pane3])

    // Close 'c' in pane3 -> pane3 becomes empty and is reclaimed
    const res = layout.closeTab(pane3, 'c')
    expect(res.paneRemoved).toBe(true)
    expect(layout.getAllLeafIds()).toEqual(['main', pane2])
    expect(layout.panes.has(pane3)).toBe(false)

    // Close 'b' in pane2 -> pane2 becomes empty and is reclaimed, leaving only 'main'
    const res2 = layout.closeTab(pane2, 'b')
    expect(res2.paneRemoved).toBe(true)
    expect(layout.getAllLeafIds()).toEqual(['main'])
    expect(layout.root).toEqual({ type: 'leaf', id: 'main' })
  })

  it('closing the last tab in the only remaining pane leaves single empty pane', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    const res = layout.closeTab('main', 'a')
    expect(res.closed).toBe(true)
    expect(res.paneRemoved).toBe(false)
    expect(layout.getAllLeafIds()).toEqual(['main'])
    expect(layout.getPane('main')?.group.tabs.length).toBe(0)
  })

  it('resizes split and clamps between 0.05 and 0.95', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    layout.splitPane('main', 'right', 'b')

    const splitId = layout.root.id
    expect(layout.resizeSplit(splitId, 0.7)).toBe(true)
    if (layout.root.type === 'split') {
      expect(layout.root.ratio).toBe(0.7)
    }

    // Clamping
    layout.resizeSplit(splitId, 0.01)
    if (layout.root.type === 'split') {
      expect(layout.root.ratio).toBe(0.05)
    }
  })

  it('maximizes a pane and restores it', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    const pane2 = layout.splitPane('main', 'right', 'b')

    layout.maximizePane(pane2)
    expect(layout.maximizedPaneId).toBe(pane2)

    layout.restoreMaximized()
    expect(layout.maximizedPaneId).toBeNull()
  })

  it('merges all panes into primary pane', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    const pane2 = layout.splitPane('main', 'right', 'b')
    layout.splitPane(pane2, 'bottom', 'c')

    layout.mergeAllPanes()
    expect(layout.getAllLeafIds()).toEqual(['main'])
    expect(layout.root).toEqual({ type: 'leaf', id: 'main' })
    expect(layout.getPane('main')?.group.tabs.map(t => t.documentId)).toEqual(['a', 'b', 'c'])
  })

  it('navigates focus directionally (left, right, up, down)', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('doc-1', false)
    const rightPane = layout.splitPane('main', 'right', 'doc-2')
    const bottomPane = layout.splitPane(rightPane, 'bottom', 'doc-3')

    // Tree: main | (rightPane / bottomPane)
    layout.focusPane('main')
    expect(layout.activePaneId).toBe('main')

    layout.focusDirection('right')
    expect(layout.activePaneId).toBe(rightPane)

    layout.focusDirection('down')
    expect(layout.activePaneId).toBe(bottomPane)

    layout.focusDirection('up')
    expect(layout.activePaneId).toBe(rightPane)

    layout.focusDirection('left')
    expect(layout.activePaneId).toBe('main')
  })

  it('serializes and deserializes split tree and handles legacy format', () => {
    const layout = new EditorLayoutManager()
    layout.getPane('main')!.group.open('a', false)
    const pane2 = layout.splitPane('main', 'right', 'b')
    const json = layout.serialize()

    const restored = new EditorLayoutManager()
    expect(restored.deserialize(json)).toBe(true)
    expect(restored.getAllLeafIds()).toEqual(['main', pane2])
    expect(restored.getPane('main')?.group.tabs[0]?.documentId).toBe('a')
    expect(restored.getPane(pane2)?.group.tabs[0]?.documentId).toBe('b')

    // Legacy migration test
    const legacy = new EditorLayoutManager()
    expect(legacy.deserialize({ isSplit: true, ratio: 0.4 })).toBe(true)
    expect(legacy.getAllLeafIds()).toEqual(['main', 'secondary'])
    if (legacy.root.type === 'split') {
      expect(legacy.root.ratio).toBe(0.4)
    }
  })
})
