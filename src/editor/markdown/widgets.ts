import { WidgetType, type EditorView } from '@codemirror/view'
import { EditorState, Transaction } from '@codemirror/state'

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.className = 'cm-md-checkbox'
    input.setAttribute('aria-label', this.checked ? '已完成任务' : '待办任务')

    // 阻止点击抢夺光标焦点
    input.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation() })

    input.addEventListener('change', e => {
      e.stopPropagation()
      e.preventDefault()
      if (view.compositionStarted || view.state.facet(EditorState.readOnly)) { input.checked = this.checked; return }
      const pos = view.posAtDOM(input)
      const marker = view.state.sliceDoc(pos, pos + 3)
      if (!/^\[[ xX]\]$/.test(marker)) return
      const newChecked = !/\[[xX]\]/.test(marker)
      const replacement = newChecked ? '[x]' : '[ ]'
      view.dispatch({
        changes: { from: pos, to: pos + 3, insert: replacement },
        annotations: Transaction.userEvent.of('input.task'),
      })
    })

    return input
  }

  ignoreEvent(): boolean {
    return true
  }
}

export class ListMarkerWidget extends WidgetType {
  constructor(readonly label: string) { super() }
  eq(other: ListMarkerWidget) { return this.label === other.label }
  toDOM() { const marker = document.createElement('span'); marker.className = 'cm-md-list-marker'; marker.textContent = this.label; return marker }
}

export class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('span')
    hr.className = 'cm-md-hr'
    return hr
  }

  eq(): boolean {
    return true
  }
}
