import { MapMode, RangeSet, RangeValue, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'

type Ending = '\n' | '\r\n' | '\r'
interface Break { at: number; ending: Ending }
class EndingValue extends RangeValue {
  point = true
  startSide = 1
  endSide = 1
  mapMode = MapMode.TrackDel
  constructor(readonly ending: Ending) { super() }
  eq(other: EndingValue) { return this.ending === other.ending }
}
const values = new Map<Ending, EndingValue>(['\n', '\r\n', '\r'].map(ending => [ending as Ending, new EndingValue(ending as Ending)]))
export type LineEndingSnapshot = RangeSet<EndingValue>

// CM stores normalized text. This field maps surviving original line separators
// through transactions (including undo), so mixed EOLs never silently normalize.
export function lineEndings(source: string) {
  const initial: Break[] = []
  let removed = 0
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    initial.push({ at: match.index! - removed, ending: match[0] as Ending })
    removed += match[0].length - 1
  }
  const counts = new Map<Ending, number>()
  for (const item of initial) counts.set(item.ending, (counts.get(item.ending) || 0) + 1)
  const fallback = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '\n'
  const restore = StateEffect.define<RangeSet<EndingValue>>({ map: (value, changes) => value.map(changes) })
  const initialSet = RangeSet.of(initial.map(item => values.get(item.ending)!.range(item.at)))
  const field = StateField.define<RangeSet<EndingValue>>({
    create: () => initialSet,
    update(value, transaction) {
      let restored: RangeSet<EndingValue> | undefined
      // Merged undo events put the earliest snapshot last.
      for (const effect of transaction.effects) if (effect.is(restore)) restored = effect.value
      if (restored) return restored
      if (!transaction.docChanged) return value
      // Persistent RangeSet maps unchanged chunks without copying every line
      // on each keystroke or retaining full arrays in undo history.
      const additions: Range<EndingValue>[] = []
      transaction.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
        let offset = fromB
        for (let line = 1; line < inserted.lines; line++) {
          offset += inserted.line(line).length
          additions.push(values.get(fallback)!.range(offset))
          offset++
        }
      })
      return value.map(transaction.changes).update({ add: additions, sort: true })
    },
  })
  return {
    field,
    history: invertedEffects.of(transaction => transaction.docChanged ? [restore.of(transaction.startState.field(field))] : []),
    snapshot(state: EditorState) { return state.field(field) },
    equal(a: EditorState, b: LineEndingSnapshot) { return RangeSet.eq([a.field(field)], [b]) },
    serialize(state: EditorState) {
      const breaks = state.field(field).iter()
      const parts: string[] = []
      for (let line = 1; line <= state.doc.lines; line++) {
        const current = state.doc.line(line)
        parts.push(current.text)
        if (line < state.doc.lines) {
          while (breaks.value && breaks.from < current.to) breaks.next()
          parts.push(breaks.value && breaks.from === current.to ? breaks.value.ending : fallback)
          if (breaks.value && breaks.from === current.to) breaks.next()
        }
      }
      return parts.join('')
    },
  }
}
