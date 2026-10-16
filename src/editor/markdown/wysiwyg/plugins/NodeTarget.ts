import { Plugin, PluginKey } from 'prosemirror-state'
import type { Node } from 'prosemirror-model'

export interface NodeTarget { token: object; pos: number; node: Node }
export const nodeTargetKey = new PluginKey<NodeTarget | null>('propertyNodeTarget')

// Keep the exact immutable node, not only its attributes: replacing an image
// with an identical neighbour must still invalidate the old property editor.
export function createNodeTargetPlugin() {
  return new Plugin<NodeTarget | null>({
    key: nodeTargetKey,
    state: {
      init: () => null,
      apply(tr, target) {
        const action = tr.getMeta(nodeTargetKey) as { target: NodeTarget | null } | undefined
        if (action) return action.target
        if (!target || !tr.docChanged) return target
        const mapped = tr.mapping.mapResult(target.pos, 1)
        if (mapped.deleted || tr.doc.nodeAt(mapped.pos) !== target.node) return null
        return { ...target, pos: mapped.pos }
      },
    },
  })
}
