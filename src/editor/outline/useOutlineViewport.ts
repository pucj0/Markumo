import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DocumentManager } from '../core/DocumentManager'
import type { OutlineItem } from './outlineService'

/** Scroll observation belongs to the reading UI, never to document transactions. */
export function useOutlineViewport(manager: () => DocumentManager | undefined, documentId: () => string | null | undefined, items: () => readonly OutlineItem[]) {
  const activeId = ref<string | null>(null)
  let frame = 0, disposed = false
  let observer: ResizeObserver | undefined, observedPane: HTMLElement | undefined
  function measure() {
    frame = 0
    const current = manager(), id = documentId()
    if (!current || !id || current.activeId !== id) { activeId.value = null; return }
    const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]')).find(element => element.dataset.paneId === current.activePane)
    if (pane !== observedPane) {
      observer?.disconnect(); observedPane = pane
      if (pane) observer?.observe(pane)
    }
    const position = current.outlineViewportPosition(), state = current.getState(id)
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
    schedule()
  }
  let unsubscribe: (() => void) | undefined
  watch(manager, current => {
    unsubscribe?.()
    unsubscribe = current?.subscribe(() => { void nextTick(schedule) })
    void nextTick(schedule)
  }, { immediate: true })
  watch([documentId, items], () => { void nextTick(schedule) })
  onMounted(() => {
    observer = new ResizeObserver(schedule)
    document.addEventListener('scroll', onScroll, true)
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
    document.removeEventListener('load', schedule, true)
    window.removeEventListener('resize', schedule)
  })
  return activeId
}
