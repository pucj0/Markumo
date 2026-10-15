import { ChangeSet, RangeSet, RangeValue, StateEffect, StateField, type EditorState, type Text, type Transaction } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { invertedEffects } from '@codemirror/commands';
export type LineChange = 'modified' | 'inserted' | 'deleted';
const MAX_CHARS = 128 * 1024, MAX_LINES = 4096, MAX_CELLS = 65536, MAX_HUNKS = 256;
class ChangeMarker extends GutterMarker {
    constructor(readonly kind: LineChange | 'spacer') { super(); }
    eq(other: ChangeMarker) { return this.kind === other.kind; }
    toDOM() {
        const element = document.createElement('span');
        element.className = `cm-change-marker cm-change-${this.kind}`;
        element.title = { modified: '此行尚未保存', inserted: '新插入的行尚未保存', deleted: '此处删除了原有行', spacer: '' }[this.kind];
        return element;
    }
}
const markers = { modified: new ChangeMarker('modified'), inserted: new ChangeMarker('inserted'), deleted: new ChangeMarker('deleted') };
const restoreLineIdentities = StateEffect.define<{
    doc: Text;
    identities: RangeSet<LineIdentity>;
}>();
class LineIdentity extends RangeValue {
    constructor(readonly id: number) { super(); }
}
function initialIdentities(doc: Text) {
    return doc.lines > 200000 ? RangeSet.empty : RangeSet.of(Array.from({ length: doc.lines }, (_, i) => new LineIdentity(i + 1).range(doc.line(i + 1).from)));
}
function identityMap(identities: RangeSet<LineIdentity>, doc: Text) {
    const result = new Map<number, number>();
    identities.between(0, doc.length, (from, _to, value) => { result.set(value.id, doc.lineAt(from).number); });
    return result;
}
function changedWindows(before: Text, after: Text, changes: ChangeSet) {
    const windows: {
        a: number;
        z: number;
        b: number;
        y: number;
        fromA: number;
        toA: number;
    }[] = [];
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const a = before.lineAt(fromA).number, z = before.lineAt(toA).number, b = after.lineAt(fromB).number, y = after.lineAt(toB).number, previous = windows[windows.length - 1];
        if (previous && (a <= previous.z || b <= previous.y)) {
            previous.z = z;
            previous.y = y;
            previous.toA = toA;
        }
        else
            windows.push({ a, z, b, y, fromA, toA });
    });
    return windows;
}
function mapIdentities(value: ChangeGutterState, tr: Transaction) {
    if (tr.newDoc.lines > 200000)
        return { identities: RangeSet.empty as RangeSet<LineIdentity>, nextIdentity: value.nextIdentity, identityLimited: true };
    let identities = value.identities.map(tr.changes), nextIdentity = value.nextIdentity, identityLimited = false;
    for (const window of changedWindows(tr.startState.doc, tr.newDoc, tr.changes)) {
        const first = tr.startState.doc.line(window.a), last = tr.startState.doc.line(window.z), begin = tr.newDoc.line(window.b).from, end = tr.newDoc.line(window.y).to;
        const oldIds = new Map<number, LineIdentity>();
        value.identities.between(first.from, last.to, (from, _to, id) => { oldIds.set(tr.startState.doc.lineAt(from).number, id); });
        const n = window.z - window.a + 1, m = window.y - window.b + 1, assigned: (LineIdentity | undefined)[] = Array(m).fill(undefined);
        if (window.fromA === window.toA && window.fromA === first.from && n === 1 && m > 1)
            assigned[m - 1] = oldIds.get(window.a);
        else if (window.fromA === first.from && window.toA === last.from && n > 1 && m === 1)
            assigned[0] = oldIds.get(window.z);
        else {
            // Retain exact unchanged lines before pairing actual replacements. The
            // bounds protect large pastes; identities then use deterministic pairing.
            const chars = last.to - first.from + end - begin;
            if (chars <= MAX_CHARS && n + m <= MAX_LINES && n * m <= MAX_CELLS) {
                const old = tr.startState.doc.sliceString(first.from, last.to).split('\n'), next = tr.newDoc.sliceString(begin, end).split('\n'), width = m + 1, table = new Uint16Array((n + 1) * width);
                for (let i = n - 1; i >= 0; i--)
                    for (let j = m - 1; j >= 0; j--)
                        table[i * width + j] = old[i] === next[j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
                let i = 0, j = 0, removed: number[] = [], added: number[] = [];
                const flush = () => { for (let k = 0; k < Math.min(removed.length, added.length); k++)
                    assigned[added[k]] = oldIds.get(window.a + removed[k]); removed = []; added = []; };
                while (i < n || j < m) {
                    if (i < n && j < m && old[i] === next[j]) {
                        flush();
                        assigned[j] = oldIds.get(window.a + i);
                        i++;
                        j++;
                    }
                    else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1]))
                        removed.push(i++);
                    else
                        added.push(j++);
                }
                flush();
            }
            else {
                identityLimited = true;
                for (let i = 0; i < Math.min(n, m); i++)
                    assigned[i] = oldIds.get(window.a + i);
            }
        }
        identities = identities.update({ filterFrom: begin, filterTo: end, filter: (from) => from < begin || from > end, add: assigned.map((id, index) => (id || new LineIdentity(nextIdentity++)).range(tr.newDoc.line(window.b + index).from)), sort: true });
    }
    return { identities, nextIdentity, identityLimited };
}
export interface SavedLineBaseline {
    doc: Text;
    origin: Text;
    changes: ChangeSet;
    identities: RangeSet<LineIdentity>;
}
export const savedLineBaseline = StateEffect.define<SavedLineBaseline>();
export interface ChangeGutterState {
    baseline: Text;
    changes: ChangeSet;
    markers: RangeSet<GutterMarker>;
    limited: boolean;
    identities: RangeSet<LineIdentity>;
    baselineIdentities: RangeSet<LineIdentity>;
    baselineLines: Map<number, number>;
    nextIdentity: number;
}
// Diff only the line windows touched by the composed changes since the last
// successful save. Unchanged parts of the document are never scanned per key.
function lineMarkers(baseline: Text, doc: Text, changes: ChangeSet, identities: RangeSet<LineIdentity>, baselineLines: Map<number, number>): Pick<ChangeGutterState, 'markers' | 'limited'> {
    if (changes.empty)
        return { markers: RangeSet.empty, limited: false };
    const windows: {
        a: number;
        z: number;
        b: number;
        y: number;
    }[] = [];
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const a = baseline.lineAt(fromA).number, z = baseline.lineAt(toA).number, b = doc.lineAt(fromB).number, y = doc.lineAt(toB).number;
        const previous = windows[windows.length - 1];
        if (previous && (a <= previous.z || b <= previous.y)) {
            previous.z = z;
            previous.y = y;
        }
        else
            windows.push({ a, z, b, y });
    });
    const result = new Map<number, LineChange>();
    let remainingChars = MAX_CHARS, remainingLines = MAX_LINES, limited = windows.length > MAX_HUNKS;
    for (const window of windows.slice(0, MAX_HUNKS)) {
        const aFrom = baseline.line(window.a).from, aTo = baseline.line(window.z).to, bFrom = doc.line(window.b).from, bTo = doc.line(window.y).to;
        const chars = aTo - aFrom + bTo - bFrom, lines = window.z - window.a + window.y - window.b + 2;
        if (chars > remainingChars || lines > remainingLines) {
            limited = true;
            continue;
        }
        remainingChars -= chars;
        remainingLines -= lines;
        identities.between(bFrom, bTo, (from, _to, id) => {
            const line = doc.lineAt(from), oldLine = baselineLines.get(id.id);
            if (oldLine === undefined || !baseline.length)
                result.set(line.number, 'inserted');
            else {
                const original = baseline.line(oldLine);
                if (original.length + line.length > remainingChars) {
                    limited = true;
                    return;
                }
                remainingChars -= original.length + line.length;
                if (original.text !== line.text)
                    result.set(line.number, 'modified');
            }
        });
        if (window.z - window.a > window.y - window.b && !result.has(window.b))
            result.set(window.b, 'deleted');
    }
    return { markers: RangeSet.of([...result].sort(([a], [b]) => a - b).map(([line, kind]) => markers[kind].range(doc.line(line).from))), limited };
}
export const changeGutterField = StateField.define<ChangeGutterState>({
    create(state) { const identities = initialIdentities(state.doc); return { baseline: state.doc, changes: ChangeSet.empty(state.doc.length), markers: RangeSet.empty, limited: state.doc.lines > 200000, identities, baselineIdentities: identities, baselineLines: identityMap(identities, state.doc), nextIdentity: state.doc.lines + 1 }; },
    update(value, tr) {
        let baseline = value.baseline, changes = tr.docChanged ? value.changes.compose(tr.changes) : value.changes, reset = false;
        let baselineIdentities = value.baselineIdentities, baselineLines = value.baselineLines;
        let { identities, nextIdentity, identityLimited } = tr.docChanged ? mapIdentities(value, tr) : { ...value, identityLimited: false };
        for (const effect of tr.effects)
            if (effect.is(restoreLineIdentities) && tr.newDoc.eq(effect.value.doc))
                identities = effect.value.identities;
        for (const effect of tr.effects)
            if (effect.is(savedLineBaseline)) {
                const saved = effect.value;
                changes = saved.origin === baseline ? saved.changes.invert(baseline).compose(changes) : ChangeSet.of({ from: 0, to: saved.doc.length, insert: tr.newDoc }, saved.doc.length);
                baseline = saved.doc;
                reset = true;
                baselineIdentities = saved.identities;
                baselineLines = identityMap(saved.identities, saved.doc);
            }
        if (!tr.docChanged && !reset)
            return value;
        // Undo back to the exact saved content can restore identities removed by a
        // deletion. CM history preserves source, rather than editor-owned side data.
        if (tr.newDoc.eq(baseline)) {
            changes = ChangeSet.empty(baseline.length);
            identities = baselineIdentities;
        }
        const result = lineMarkers(baseline, tr.newDoc, changes, identities, baselineLines);
        return { baseline, changes, identities, nextIdentity, baselineIdentities, baselineLines, ...result, limited: result.limited || identityLimited };
    },
});
export function captureLineBaseline(state: EditorState): SavedLineBaseline {
    const value = state.field(changeGutterField);
    return { doc: state.doc, origin: value.baseline, changes: value.changes, identities: value.identities };
}
export function changedLines(state: EditorState) {
    const result: {
        line: number;
        kind: LineChange;
    }[] = [];
    state.field(changeGutterField).markers.between(0, state.doc.length, (from, _to, marker) => { result.push({ line: state.doc.lineAt(from).number, kind: (marker as ChangeMarker).kind as LineChange }); });
    return result;
}
export const changeGutter = [changeGutterField, invertedEffects.of(tr => tr.docChanged ? [restoreLineIdentities.of({ doc: tr.startState.doc, identities: tr.startState.field(changeGutterField).identities })] : []), gutter({
        class: 'cm-change-gutter',
        markers: view => view.state.field(changeGutterField).markers,
        initialSpacer: () => new ChangeMarker('spacer'),
    }), EditorView.updateListener.of(update => {
        const element = update.view.dom.querySelector<HTMLElement>('.cm-change-gutter');
        if (element)
            element.title = update.state.field(changeGutterField).limited ? '改动范围超过行标记预算，部分标记已暂停；编辑、保存和撤销不受影响。' : '';
    }), EditorView.baseTheme({
        '.cm-change-gutter .cm-gutterElement': { padding: '0 1px', width: '5px', boxSizing: 'border-box' },
        '.cm-change-marker': { display: 'block', width: '3px', height: '100%', minHeight: '1em' },
        '.cm-change-modified': { backgroundColor: 'var(--change-modified, #ee982e)' },
        '.cm-change-inserted': { backgroundColor: 'var(--change-inserted, #30af70)' },
        '.cm-change-deleted': { borderBottom: '2px solid var(--change-modified, #ee982e)', boxSizing: 'border-box' },
    })];
