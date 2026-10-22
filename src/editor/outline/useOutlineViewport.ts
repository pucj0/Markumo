import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DocumentManager } from '../core/DocumentManager'
import type { OutlineItem } from './outlineService'

/** Scroll observation belongs to the reading UI, never to document transactions. */
export function useOutlineViewport(manager: () => DocumentManager | undefined, documentId: () => string | null | undefined, items: () => readonly OutlineItem[]) {
  const activeId = ref<string | null>(null)
  let frame = 0, disposed = false
  let readingMode: 'viewport' | 'caret' = 'viewport', caretChangedAt = 0
  let lastSelection: { pane: string; id: string | null; anchor: number; head: number } | undefined
  let lastOwner: unknown
  function observeSelection() {
    const current = manager()
    if (!current) return
    const selection = current.activeLiveEditor?.selection ?? current.activeEditorView?.state.selection.main
    const owner = current.activeLiveEditor ?? current.activeEditorView
    const next = { pane: current.activePane, id: current.activeId, anchor: selection?.anchor ?? 0, head: selection?.head ?? 0 }
    if (!lastSelection || owner !== lastOwner || next.pane !== lastSelection.pane || next.id !== lastSelection.id) { readingMode = 'viewport'; caretChangedAt = 0 }
    else if (next.anchor !== lastSelection.anchor || next.head !== lastSelection.head) { readingMode = 'caret'; caretChangedAt = performance.now() }
    lastSelection = next
    lastOwner = owner
  }
  let observer: ResizeObserver | undefined, observedPane: HTMLElement | undefined
  function measure() {
    frame = 0
    const current = manager(), id = documentId()
    if (!current || !id || current.activeId !== id) { activeId.value = null; return }
    if (!items().length) { activeId.value = null; return }
    const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]')).find(element => element.dataset.paneId === current.activePane)
    if (pane !== observedPane) {
      observer?.disconnect(); observedPane = pane
      if (pane) observer?.observe(pane)
    }
    const symbols=items()
    if(symbols.some(item=>item.kind!=='heading')){
      const position=current.activeEditorView?.state.selection.main.head
      let active:OutlineItem|undefined
      if(position!==undefined)for(const item of symbols){
        if((item.scopeFrom??item.from??0)<=position && position<(item.to??0) && (!active||item.level>active.level))active=item
      }
      activeId.value=active?.id??null
      return
    }
    const position = readingMode === 'caret' ? lastSelection?.head ?? null : current.outlineViewportPosition(), state = current.getState(id)
    if (position === null || !state) { activeId.value = null; return }
    let active: string | null = null
    for (const item of items()) {
      if (item.kind !== 'heading') continue
      const from = item.from ?? state.doc.line(Math.min(state.doc.lines, item.lineNumber)).from
      if (from > position) break
      active = item.id
    }
    activeId.value = active
  }
  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(measure)
  }
  function onScroll(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches('.markdown-live,.cm-scroller,.split-preview-content')) return
    const pane = target.closest<HTMLElement>('[data-pane-id]')
    if (pane?.dataset.paneId !== manager()?.activePane) return
    // Ignore nested code editors and scrolls in inactive panes. Split's existing
    // source/preview synchronization finishes before the next animation frame.
    if (target.matches('.cm-scroller') && target.closest('.markdown-live')) return
    if (performance.now() - caretChangedAt > 120) readingMode = 'viewport'
    schedule()
  }
  function onWheel(event: Event) {
    const target = event.target
    if (target instanceof Element && target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId === manager()?.activePane) {
      readingMode = 'viewport'; caretChangedAt = 0; schedule()
    }
  }
  let unsubscribe: (() => void) | undefined
  watch(manager, current => {
    unsubscribe?.()
    lastSelection = undefined
    observeSelection()
    unsubscribe = current?.subscribe(() => { observeSelection(); void nextTick(schedule) })
    void nextTick(schedule)
  }, { immediate: true })
  watch([documentId, items], () => { void nextTick(schedule) })
  onMounted(() => {
    observer = new ResizeObserver(schedule)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    document.addEventListener('load', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()
  })
  onUnmounted(() => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    unsubscribe?.()
    observer?.disconnect()
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('wheel', onWheel, true)
    document.removeEventListener('load', schedule, true)
    window.removeEventListener('resize', schedule)
  })
  return activeId
}
