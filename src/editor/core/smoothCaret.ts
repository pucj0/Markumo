import { Facet, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { CaretEnvironment, CaretOverlay, measureCaret } from './caretOverlay'
import type { CaretAnimation } from './caretMotion'

const animationMode = Facet.define<CaretAnimation, CaretAnimation>({ combine: values => values[0] ?? 'smooth' })
const caretPlugin = ViewPlugin.fromClass(class {
  private overlay: CaretOverlay
  private environment: CaretEnvironment
  private dead = false
  private snap = true
  private activity = true
  constructor(private view: EditorView) {
    this.overlay = new CaretOverlay(view.dom, view.dom)
    this.environment = new CaretEnvironment(view.dom, view.contentDOM, this.overlay, snap => this.refresh(snap))
    this.refresh(true)
  }
  private eligible() {
    return !this.dead && !this.environment.suspended && this.view.hasFocus && !this.view.compositionStarted &&
      !this.view.state.readOnly && this.view.state.facet(EditorView.editable) && this.view.inView &&
      this.view.state.selection.ranges.length === 1 && this.view.state.selection.main.empty && this.view.state.facet(animationMode) !== 'off'
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) this.activity = true
    if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged || update.focusChanged ||
      update.startState.facet(animationMode) !== update.state.facet(animationMode)) this.refresh(false)
  }
  private refresh(snap: boolean) {
    if (!this.eligible()) { this.overlay.hide(); return }
    this.snap ||= snap
    this.view.requestMeasure({ key: this,
      read: view => {
        if (!this.eligible()) return null
        try { return measureCaret(view.dom, view.coordsAtPos(view.state.selection.main.head, view.state.selection.main.assoc || 1), view.scrollDOM) }
        catch { return null }
      },
      write: measurement => {
        if (this.dead) return
        this.overlay.show(this.eligible() ? measurement : null, this.view.state.facet(animationMode), this.environment.reduced.matches, this.snap, this.activity)
        this.snap = this.activity = false
      },
    })
  }
  destroy() { this.dead = true; this.environment.destroy(); this.overlay.destroy() }
})

/** Keep this extension in a Compartment: mode changes preserve editor state and undo. */
export function smoothCaret(mode: CaretAnimation = 'smooth'): Extension {
  return mode === 'off' ? [] : [animationMode.of(mode), caretPlugin]
}
