import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { CaretEnvironment, CaretOverlay, measureCaret } from '../../../core/caretOverlay'
import type { CaretAnimation } from '../../../core/caretMotion'

export function createSmoothCaretPlugin(host: HTMLElement, mode: () => CaretAnimation) {
  return new Plugin({
    view: view => new SmoothCaretView(view, host, mode),
  })
}

class SmoothCaretView {
  private overlay: CaretOverlay
  private environment: CaretEnvironment
  private mutations: MutationObserver
  private frame = 0
  private snap = true
  private activity = true
  private dead = false
  constructor(private view: EditorView, host: HTMLElement, private mode: () => CaretAnimation) {
    this.overlay = new CaretOverlay(host, view.dom)
    this.environment = new CaretEnvironment(host, view.dom, this.overlay, snap => this.refresh(snap))
    this.mutations = new MutationObserver(records => {
      if (records.some(record => (record.type !== 'attributes' || record.target !== view.dom || record.attributeName !== 'class') && !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.smooth-caret-layer'))) this.refresh(!this.activity)
    })
    this.mutations.observe(view.dom, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden'] })
    // Typography can change glyph metrics while the short document remains at
    // its min-height, so ResizeObserver alone cannot detect that change.
    this.mutations.observe(host, { attributes: true, attributeFilter: ['style', 'class', 'data-image-border'] })
    this.refresh(true)
  }
  private eligible() {
    const selection = this.view.state.selection
    return !this.dead && !this.environment.suspended && !this.view.composing && this.view.editable &&
      this.view.hasFocus() && document.activeElement === this.view.dom && this.mode() !== 'off' &&
      selection instanceof TextSelection && selection.empty && selection.$head.parent.isTextblock &&
      !selection.$head.parent.type.spec.code
  }
  update(view: EditorView, previous: EditorView['state']) {
    this.activity ||= !view.state.selection.eq(previous.selection) || view.state.doc !== previous.doc
    this.refresh(false)
  }
  private refresh(snap: boolean) {
    if (!this.eligible()) { this.overlay.hide(); cancelAnimationFrame(this.frame); this.frame = 0; return }
    this.snap ||= snap
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.eligible()) { this.overlay.hide(); return }
      try {
        const rect = this.view.coordsAtPos(this.view.state.selection.head)
        this.overlay.show(measureCaret(this.overlay.layer.parentElement!, rect), this.mode(), this.environment.reduced.matches, this.snap, this.activity)
      } catch { this.overlay.hide() }
      this.snap = this.activity = false
    })
  }
  destroy() {
    this.dead = true; cancelAnimationFrame(this.frame); this.frame = 0
    this.mutations.disconnect(); this.environment.destroy(); this.overlay.destroy()
  }
}
