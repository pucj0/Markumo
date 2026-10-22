import { ViewPlugin, EditorView, type ViewUpdate } from '@codemirror/view'
import { Facet, type Extension } from '@codemirror/state'
import { cancelSmoothScroll, smoothScrollTo, isSmoothScrolling } from './smoothScroll'

export const TYPEWRITER_DEAD_ZONE = 16
export const TYPEWRITER_RATIO = 0.45

export interface CaretCoords {
  top: number
  bottom: number
}

/** Compute vertical scroll target to align the caret around ~45% of the viewport. */
export function calculateTypewriterScroll(
  scroller: HTMLElement,
  caret: CaretCoords,
  ratio = TYPEWRITER_RATIO,
  deadZone = TYPEWRITER_DEAD_ZONE
): { destination: number; delta: number; needed: boolean } {
  const scrollerRect = scroller.getBoundingClientRect()
  const caretCenter = ((caret.top + caret.bottom) / 2) - scrollerRect.top
  const targetY = scrollerRect.height * ratio
  const delta = caretCenter - targetY
  const needed = Math.abs(delta) > deadZone
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const destination = Math.max(0, Math.min(maxScroll, scroller.scrollTop + delta))
  return { destination, delta, needed }
}

export function getCaretCoords(view: EditorView, head: number): CaretCoords | null {
  let coords = view.coordsAtPos(head, view.state.selection.main.assoc || 1)
  if (!coords) {
    try {
      const block = view.lineBlockAt(head)
      const top = block.top + view.documentTop
      coords = { top, bottom: top + block.height, left: 0, right: 0 }
    } catch {
      return null
    }
  }
  return coords
}

export interface TypewriterConfig {
  enabled: boolean
  isPaneActive?: (view: EditorView) => boolean
}

const typewriterFacet = Facet.define<TypewriterConfig, TypewriterConfig>({
  combine: values => values[0] ?? { enabled: false },
})

const typewriterTheme = EditorView.theme({
  '&.cm-typewriter-mode .cm-content': {
    paddingBottom: 'max(320px, calc(50vh - 40px)) !important',
  },
})

class TypewriterPluginValue {
  following = true
  composing = false
  private destroyed = false
  private cleanupListeners: () => void

  constructor(private readonly view: EditorView) {
    const scroller = view.scrollDOM
    const onWheel = () => {
      cancelSmoothScroll(scroller)
      this.following = false
    }

    const onScroll = () => {
      if (isSmoothScrolling(scroller)) return
      this.following = false
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        cancelSmoothScroll(scroller)
        this.following = false
        return
      }
      // Any text editing or cursor navigation key resumes following
      if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        this.following = true
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        this.following = true
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      // Content clicks resume following; scrollbar drag does not
      if (view.contentDOM.contains(event.target as Node)) {
        this.following = true
      } else {
        cancelSmoothScroll(scroller)
        this.following = false
      }
    }

    const onCompStart = () => {
      this.composing = true
      cancelSmoothScroll(scroller)
    }

    const onCompEnd = () => {
      this.composing = false
      this.following = true
      this.requestAlign()
    }

    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('keydown', onKeydown, { capture: true })
    scroller.addEventListener('pointerdown', onPointerDown)
    scroller.addEventListener('compositionstart', onCompStart)
    scroller.addEventListener('compositionend', onCompEnd)

    this.cleanupListeners = () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('keydown', onKeydown, true)
      scroller.removeEventListener('pointerdown', onPointerDown)
      scroller.removeEventListener('compositionstart', onCompStart)
      scroller.removeEventListener('compositionend', onCompEnd)
    }

    this.updateClasses()
    // setState may destroy the previous plugin after constructing this one.
    queueMicrotask(() => {
      if (this.destroyed) return
      this.updateClasses()
      this.requestAlign()
    })
    if (this.isActive()) {
      this.requestAlign()
    }
  }

  private config(): TypewriterConfig {
    return this.view.state.facet(typewriterFacet)
  }

  private isActive(): boolean {
    if (this.destroyed) return false
    const cfg = this.config()
    if (!cfg.enabled) return false
    if (cfg.isPaneActive && !cfg.isPaneActive(this.view)) return false
    return true
  }

  private updateClasses() {
    // Keep padding stable when a pane loses focus; only following is active-pane scoped.
    this.view.dom.classList.toggle('cm-typewriter-mode', !this.destroyed && this.config().enabled)
  }

  update(update: ViewUpdate) {
    this.updateClasses()
    const shouldCheck =
      update.docChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.focusChanged ||
      update.startState.facet(typewriterFacet) !== update.state.facet(typewriterFacet)
    if (shouldCheck && this.isActive() && this.following && !this.composing) {
      this.requestAlign()
    }
  }

  requestAlign() {
    if (!this.isActive() || !this.following || this.composing) return
    const scroller = this.view.scrollDOM

    this.view.requestMeasure({
      key: this,
      read: view => {
        if (!this.isActive() || !this.following || this.composing) return null
        const head = view.state.selection.main.head
        const coords = getCaretCoords(view, head)
        if (!coords) return null
        return calculateTypewriterScroll(scroller, coords)
      },
      write: measurement => {
        if (!measurement || !measurement.needed || this.destroyed || !this.isActive() || !this.following || this.composing) {
          return
        }
        const targetTop = measurement.destination
        smoothScrollTo(
          scroller,
          () => targetTop,
          () => !this.destroyed && this.isActive() && this.following && !this.composing
        )
      },
    })
  }

  destroy() {
    this.destroyed = true
    this.cleanupListeners()
    cancelSmoothScroll(this.view.scrollDOM)
    this.view.dom.classList.remove('cm-typewriter-mode')
  }
}

const typewriterPlugin = ViewPlugin.fromClass(TypewriterPluginValue)

export function typewriterExtension(config: TypewriterConfig): Extension {
  if (!config.enabled) return []
  return [
    typewriterFacet.of(config),
    typewriterTheme,
    typewriterPlugin,
  ]
}
