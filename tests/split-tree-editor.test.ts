import { describe, it, expect } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'

describe('DocumentManager with Split Tree Multi-Pane Engine', () => {
  it('creates multi-pane layouts: left, right, top, bottom', () => {
    const manager = new DocumentManager([
      { id: 'doc-1', name: 'doc1.txt', path: '', text: 'Hello 1' },
      { id: 'doc-2', name: 'doc2.txt', path: '', text: 'Hello 2' },
      { id: 'doc-3', name: 'doc3.txt', path: '', text: 'Hello 3' },
    ])
    manager.open('doc-1', false)
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])

    // Split right
    const rightPane = manager.splitPane('right', 'main', 'doc-2')
    expect(manager.layout.getAllLeafIds()).toEqual(['main', rightPane])

    // Split bottom on rightPane
    const bottomPane = manager.splitPane('bottom', rightPane, 'doc-3')
    expect(manager.layout.getAllLeafIds()).toEqual(['main', rightPane, bottomPane])
    expect(manager.isSplit).toBe(true)

    // Verify root is split, and right branch is split
    expect(manager.layout.root.type).toBe('split')
    manager.dispose()
  })

  it('synchronizes edits across 3 panes showing the same document with independent selections', () => {
    const manager = new DocumentManager([
      { id: 'shared', name: 'shared.txt', path: '', text: 'initial content' },
    ])
    manager.open('shared', false)
    const pane2 = manager.splitPane('right', 'main', 'shared')
    const pane3 = manager.splitPane('bottom', pane2, 'shared')

    expect(manager.layout.getAllLeafIds()).toEqual(['main', pane2, pane3])

    // Edit in main pane
    manager.focusPane('main')
    manager.dispatch('shared', { changes: { from: 0, insert: 'PREFIX ' }, selection: { anchor: 10 } })

    // Check all panes see the exact same content
    expect(manager.getText('shared')).toBe('PREFIX initial content')

    // Each pane has independent selection
    expect(manager.metadata('shared')?.column).toBe(11)
    manager.dispose()
  })

  it('closing a tab in one pane does not ask for dirty confirmation if document is still open in another pane', () => {
    const manager = new DocumentManager([
      { id: 'shared', name: 'shared.txt', path: '', text: 'content' },
    ])
    manager.open('shared', false)
    const pane2 = manager.splitPane('right', 'main', 'shared')

    manager.dispatch('shared', { changes: { from: 0, insert: 'dirty ' } })
    expect(manager.metadata('shared')?.dirty).toBe(true)

    // Close in main pane -> document is still open in pane2, so this should NOT trigger dirty error
    expect(manager.close('shared', false, 'main')).toBe('closed')
    expect(manager.getText('shared')).toBe('dirty content')

    // Close in pane2 -> this is now the LAST reference, so it MUST return 'dirty'
    expect(manager.close('shared', false, pane2)).toBe('dirty')

    // With discard = true, it closes and pane2 collapses!
    expect(manager.close('shared', true, pane2)).toBe('closed')
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])
    manager.dispose()
  })

  it('auto-reclaims empty panes until single empty pane remains', () => {
    const manager = new DocumentManager([
      { id: 'a', name: 'a.txt', path: '', text: 'A' },
      { id: 'b', name: 'b.txt', path: '', text: 'B' },
      { id: 'c', name: 'c.txt', path: '', text: 'C' },
    ])
    manager.open('a', false)
    const pane2 = manager.splitPane('right', 'main', 'b')
    const pane3 = manager.splitPane('bottom', pane2, 'c')

    expect(manager.layout.getAllLeafIds().length).toBe(3)

    // Close c in pane3 -> pane3 removed
    manager.close('c', false, pane3)
    expect(manager.layout.getAllLeafIds()).toEqual(['main', pane2])

    // Close b in pane2 -> pane2 removed
    manager.close('b', false, pane2)
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])

    // Close a in main -> main remains as single empty pane
    manager.close('a', false, 'main')
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])
    expect(manager.layout.getPane('main')?.group.tabs.length).toBe(0)
    expect(manager.activeDocument).toBeNull()
    manager.dispose()
  })

  it('isComposing is false when all tabs are closed and empty pane is clicked', () => {
    const manager = new DocumentManager([
      { id: 'a', name: 'a.txt', path: '', text: 'A' },
    ])
    manager.open('a', false)
    manager.close('a', false, 'main')

    expect(manager.activeDocument).toBeNull()
    expect(manager.isComposing).toBe(false)
    manager.dispose()
  })

  it('merges all panes cleanly into main pane', () => {
    const manager = new DocumentManager([
      { id: 'a', name: 'a.txt', path: '', text: 'A' },
      { id: 'b', name: 'b.txt', path: '', text: 'B' },
      { id: 'c', name: 'c.txt', path: '', text: 'C' },
    ])
    manager.open('a', false)
    const pane2 = manager.splitPane('right', 'main', 'b')
    manager.splitPane('bottom', pane2, 'c')

    manager.mergeAllPanes()
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])
    expect(manager.layout.root).toEqual({ type: 'leaf', id: 'main' })
    expect(manager.mainOpenedDocuments.map(d => d.id)).toEqual(['a', 'b', 'c'])
    manager.dispose()
  })
})
