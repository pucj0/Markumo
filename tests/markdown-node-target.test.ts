import { describe, it, expect } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { markdownSchema as s } from '../src/editor/markdown/wysiwyg/MarkdownSchema'
import { createNodeTargetPlugin, nodeTargetKey } from '../src/editor/markdown/wysiwyg/plugins/NodeTarget'

describe('property target identity and transaction mapping', () => {
  function fixture() {
    const image = s.nodes.image.create({ src: './same.png', alt: 'same' })
    const doc = s.nodes.doc.create(null, s.nodes.paragraph.create(null, [s.text('before'), image, image]))
    let state = EditorState.create({ doc, plugins: [createNodeTargetPlugin()] })
    state = state.apply(state.tr.setMeta(nodeTargetKey, { target: { token: {}, pos: 7, node: image } }))
    return state
  }
  it('maps an insertion before the image, including replayed pane transactions', () => {
    let state = fixture()
    state = state.apply(state.tr.insertText('中文', 1))
    const target = nodeTargetKey.getState(state)!
    expect(target.pos).toBe(9)
    expect(state.doc.nodeAt(target.pos)).toBe(target.node)
    state = state.apply(state.tr.insertText('after', 11))
    expect(nodeTargetKey.getState(state)?.pos).toBe(9)
  })
  it('invalidates deletion even if an identical neighbour takes its position', () => {
    let state = fixture()
    state = state.apply(state.tr.delete(7, 8))
    expect(state.doc.nodeAt(7)?.type.name).toBe('image')
    expect(nodeTargetKey.getState(state)).toBeNull()
  })
  it('invalidates attribute changes and identical replacements', () => {
    let state = fixture()
    state = state.apply(state.tr.setNodeMarkup(7, undefined, { src: './other.png' }))
    expect(nodeTargetKey.getState(state)).toBeNull()
    state = fixture()
    state = state.apply(state.tr.replaceWith(7, 8, state.doc.nodeAt(7)!))
    expect(nodeTargetKey.getState(state)).toBeNull()
  })
})
