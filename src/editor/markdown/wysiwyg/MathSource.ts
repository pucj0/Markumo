import { textPatch, type SourcePatch } from './MarkdownSourceBridge'

/** Strip only delimiter-adjacent line breaks. Spaces belong to the source. */
export { mathBlockParts } from '../mathSemantics'

export interface MathSelection { start: number; end: number; direction: 'forward' | 'backward' | 'none' }

export function mapMathSelection(selection: MathSelection, patch: SourcePatch | null): MathSelection {
  if (!patch) return selection
  const map = (pos: number, assoc: number) => {
    if (pos < patch.from || pos === patch.from && assoc < 0) return pos
    if (pos > patch.to || pos === patch.to && assoc > 0) return pos + patch.insert.length - (patch.to - patch.from)
    return patch.from + (assoc > 0 ? patch.insert.length : 0)
  }
  const start = map(selection.start, 1)
  const end = map(selection.end, selection.start === selection.end ? 1 : -1)
  return { start: Math.min(start, end), end: Math.max(start, end), direction: selection.direction }
}

/** Rebase a completed composition over disjoint remote edits. On overlap the
 * completed local composition wins this formula, with an explicit notice. */
export function mergeMathComposition(base: string, draft: string, remote: string, selection: MathSelection) {
  const local = textPatch(base, draft), external = textPatch(base, remote)
  if (!local) return { value: remote, selection: mapMathSelection(selection, external), conflict: false }
  if (!external || draft === remote) return { value: draft, selection, conflict: false }
  const sameInsertion = local.from === local.to && external.from === external.to && local.from === external.from
  if (!sameInsertion && (local.to <= external.from || external.to <= local.from)) {
    const delta = local.to <= external.from ? local.insert.length - (local.to - local.from) : 0
    const mapped = { ...external, from: external.from + delta, to: external.to + delta }
    return { value: draft.slice(0, mapped.from) + mapped.insert + draft.slice(mapped.to), selection: mapMathSelection(selection, mapped), conflict: false }
  }
  return { value: draft, selection, conflict: true }
}
