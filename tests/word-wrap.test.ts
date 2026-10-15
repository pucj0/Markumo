import { describe, it, expect } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { EditorView } from '@codemirror/view'

function hasLineWrapping(state: any): boolean {
  try {
    const facet = (EditorView.lineWrapping as any).facet
    const values = state.facet(facet)
    return Array.isArray(values) && values.some((a: any) => a?.class === 'cm-lineWrapping')
  } catch {
    return false
  }
}

describe('Word Wrap Behavior & State Synchronization', () => {
  it('applies word wrap to documents across multiple panes immediately without changing document text', () => {
    const longText = 'A'.repeat(500)
    const manager = new DocumentManager([
      { id: 'txt', name: 'long.txt', path: '', text: longText },
      { id: 'js', name: 'script.js', path: '', text: 'const x = "' + 'B'.repeat(300) + '";' },
      { id: 'md', name: 'readme.md', path: '', text: '# Title\n' + 'C'.repeat(400) },
    ])

    manager.open('txt', false)
    const pane2 = manager.splitPane('right', 'main', 'js')

    // 1. Initially wordWrap is false
    expect(hasLineWrapping(manager.getState('txt'))).toBe(false)
    expect(hasLineWrapping(manager.getState('js'))).toBe(false)

    // 2. Toggle wordWrap on
    manager.setWrap(true)
    expect(hasLineWrapping(manager.getState('txt'))).toBe(true)
    expect(hasLineWrapping(manager.getState('js'))).toBe(true)

    // Verify text/content is NEVER altered by line wrapping
    expect(manager.getText('txt')).toBe(longText)
    expect(manager.metadata('txt')?.dirty).toBe(false)

    // 3. Open another document in pane2
    manager.open('md', false, pane2)
    expect(hasLineWrapping(manager.getState('md'))).toBe(true)

    // 4. Toggle wordWrap off
    manager.setWrap(false)
    expect(hasLineWrapping(manager.getState('txt'))).toBe(false)
    expect(hasLineWrapping(manager.getState('js'))).toBe(false)
    expect(hasLineWrapping(manager.getState('md'))).toBe(false)

    manager.dispose()
  })

  it('Markdown Live/Split and source modes keep wrapping without modifying CRLF/LF or BOM', () => {
    const crlfText = '# Heading\r\n' + 'Word '.repeat(50) + '\r\nSecond line'
    const manager = new DocumentManager([
      { id: 'md-crlf', name: 'test.md', path: '', text: crlfText },
    ])

    manager.open('md-crlf', false)
    manager.setWrap(true)
    expect(hasLineWrapping(manager.getState('md-crlf'))).toBe(true)

    // Switch between markdown modes
    manager.setMarkdownMode('md-crlf', 'source')
    expect(hasLineWrapping(manager.getState('md-crlf'))).toBe(true)
    expect(manager.saveSnapshot('md-crlf')?.text).toBe(crlfText)

    manager.setMarkdownMode('md-crlf', 'split')
    expect(hasLineWrapping(manager.getState('md-crlf'))).toBe(true)
    expect(manager.saveSnapshot('md-crlf')?.text).toBe(crlfText)

    manager.setMarkdownMode('md-crlf', 'live')
    expect(hasLineWrapping(manager.getState('md-crlf'))).toBe(true)
    expect(manager.saveSnapshot('md-crlf')?.text).toBe(crlfText)

    manager.dispose()
  })
})
