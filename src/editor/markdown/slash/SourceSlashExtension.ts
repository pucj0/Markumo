import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { markdownSelectionInCodeBlock } from '../formatCommands'
import {
  type SlashCommand,
  type SlashCommandContext,
  SLASH_COMMANDS,
  filterSlashCommands,
} from './SlashCommandRegistry'
import { SlashCommandMenu } from './SlashCommandMenu'

class SourceSlashPluginValue {
  readonly menu: SlashCommandMenu

  constructor(private view: EditorView) {
    this.menu = new SlashCommandMenu(view.dom.parentElement || document.body)
  }

  destroy() {
    this.menu.destroy()
  }

  close() {
    this.menu.close()
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    return this.menu.handleKeyDown(event)
  }

  update(update: ViewUpdate) {
    if (update.view.composing || update.state.readOnly) {
      this.close()
      return
    }

    if (!update.docChanged && !update.selectionSet) {
      return
    }

    const { state } = update.view
    const selection = state.selection.main
    if (!selection.empty) {
      this.close()
      return
    }

    // Do not trigger inside code blocks
    if (markdownSelectionInCodeBlock(state)) {
      this.close()
      return
    }

    const line = state.doc.lineAt(selection.head)
    const textBefore = line.text.slice(0, selection.head - line.from)
    const slashIndex = textBefore.lastIndexOf('/')
    if (slashIndex === -1) {
      this.close()
      return
    }

    // Boundary check before slash
    if (slashIndex > 0) {
      const charBefore = textBefore[slashIndex - 1]
      if (!/\s/.test(charBefore) || charBefore === '\\') {
        this.close()
        return
      }
    }

    const query = textBefore.slice(slashIndex + 1)
    if (/\s|\//.test(query)) {
      this.close()
      return
    }

    const from = line.from + slashIndex
    const to = selection.head

    try {
      const coords = update.view.coordsAtPos(from)
      if (!coords) {
        this.close()
        return
      }

      const hasYaml = state.doc.line(1).text.trim() === '---'
      const context: SlashCommandContext = {
        mode: 'source',
        inTable: false,
        inCodeBlock: false,
        readOnly: state.readOnly,
        hasYaml,
        from,
        to,
        query,
        sourceView: update.view,
      }

      const filtered = filterSlashCommands(SLASH_COMMANDS, query, context)

      this.menu.show(coords, filtered, {
        onSelect: (cmd, tableDim) => {
          this.execute(cmd, context, tableDim)
        },
        onClose: () => {},
      })
    } catch {
      this.close()
    }
  }

  private execute(
    command: SlashCommand,
    context: SlashCommandContext,
    tableDim?: { rows: number; columns: number }
  ) {
    const view = this.view
    const { state } = view
    const { from, to } = context
    const line = state.doc.lineAt(from)

    switch (command.id) {
      case 'heading-0':
      case 'heading-1':
      case 'heading-2':
      case 'heading-3':
      case 'heading-4':
      case 'heading-5':
      case 'heading-6': {
        const level = command.id === 'heading-0' ? 0 : Number(command.id.slice(-1))
        const prefix = level === 0 ? '' : '#'.repeat(level) + ' '
        const indent = /^[ \t]*/.exec(line.text)![0].length
        const oldPrefixMatch = /^(?:#{1,6}\s+|>\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/.exec(
          line.text.slice(indent)
        )?.[0] || ''

        // Delete /query from the line and update prefix
        const changes = [
          { from, to, insert: '' },
          { from: line.from + indent, to: line.from + indent + oldPrefixMatch.length, insert: prefix },
        ]
        const tr = state.update({
          changes,
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'bullet':
      case 'ordered':
      case 'task':
      case 'quote': {
        const prefix =
          command.id === 'quote'
            ? '> '
            : command.id === 'bullet'
            ? '- '
            : command.id === 'ordered'
            ? '1. '
            : '- [ ] '
        const indent = /^[ \t]*/.exec(line.text)![0].length
        const oldPrefixMatch = /^(?:#{1,6}\s+|>\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/.exec(
          line.text.slice(indent)
        )?.[0] || ''

        const changes = [
          { from, to, insert: '' },
          { from: line.from + indent, to: line.from + indent + oldPrefixMatch.length, insert: prefix },
        ]
        const tr = state.update({
          changes,
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'callout-note':
      case 'callout-tip':
      case 'callout-important':
      case 'callout-warning':
      case 'callout-caution': {
        const type = command.id.replace('callout-', '').toUpperCase()
        const text = `> [!${type}]\n> `
        const tr = state.update({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          annotations: isolateHistory.of('full'),
          userEvent: 'input.callout',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'table': {
        const rows = Math.max(1, Math.min(8, tableDim?.rows ?? 3))
        const cols = Math.max(1, Math.min(8, tableDim?.columns ?? 3))
        const header = `| ${Array.from({ length: cols }, (_, i) => `列 ${i + 1}`).join(' | ')} |`
        const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
        const body = Array.from({ length: rows - 1 }, () => `| ${Array.from({ length: cols }, () => '内容').join(' | ')} |`)
        const tableText = [header, sep, ...body].join('\n') + '\n\n'

        // Check if current line had text other than /query
        const remainingLineText = line.text.slice(0, from - line.from) + line.text.slice(to - line.from)
        const isLineEmpty = !remainingLineText.trim()

        let insertFrom: number
        let insertTo: number
        let textToInsert: string
        let targetCursor: number

        if (isLineEmpty) {
          insertFrom = line.from
          insertTo = line.to
          textToInsert = tableText
          targetCursor = insertFrom + 2 // In first header cell
        } else {
          insertFrom = from
          insertTo = to
          textToInsert = '\n\n' + tableText
          targetCursor = from + 4
        }

        const tr = state.update({
          changes: { from: insertFrom, to: insertTo, insert: textToInsert },
          selection: EditorSelection.cursor(targetCursor),
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format.table',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'code-block': {
        const insertText = '```\n\n```\n'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.cursor(from + 4), // Middle line
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'mermaid': {
        const insertText = '```mermaid\ngraph TD\n    A[开始] --> B[结束]\n```\n'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.cursor(from + 11), // After ```mermaid\n
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'image': {
        const insertText = '![图片描述](image.png)'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.range(from + 2, from + 6), // Select '图片描述'
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'link': {
        const insertText = '[链接文字](https://example.com)'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.range(from + 1, from + 5), // Select '链接文字'
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'rule': {
        const insertText = '\n---\n\n'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.cursor(from + insertText.length),
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'math': {
        const insertText = '$$\nx^2\n$$\n\n'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.cursor(from + 3), // At 'x^2'
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'toc': {
        const insertText = '[TOC]\n\n'
        const tr = state.update({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.cursor(from + insertText.length),
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'footnote': {
        const docEnd = state.doc.length
        const footnoteRef = '[^1]'
        const footnoteDef = '\n\n[^1]: 脚注内容'
        const changes = [
          { from, to, insert: footnoteRef },
          { from: docEnd, to: docEnd, insert: footnoteDef },
        ]
        const tr = state.update({
          changes,
          selection: EditorSelection.cursor(from + footnoteRef.length),
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'link-reference': {
        const docEnd = state.doc.length
        const ref = '[1]'
        const refDef = '\n\n[1]: https://example.com'
        const changes = [
          { from, to, insert: ref },
          { from: docEnd, to: docEnd, insert: refDef },
        ]
        const tr = state.update({
          changes,
          selection: EditorSelection.cursor(from + ref.length),
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }

      case 'yaml': {
        if (state.doc.line(1).text.trim() === '---') return
        const yamlText = '---\ntitle: ""\n---\n\n'
        const changes = [
          { from, to, insert: '' },
          { from: 0, to: 0, insert: yamlText },
        ]
        const tr = state.update({
          changes,
          selection: EditorSelection.cursor(yamlText.length),
          annotations: isolateHistory.of('full'),
          userEvent: 'input.format',
        })
        view.dispatch(tr)
        view.focus()
        return
      }
    }
  }
}

export const sourceSlashPlugin = ViewPlugin.fromClass(SourceSlashPluginValue)

export function sourceSlashExtension(): Extension {
  return [
    sourceSlashPlugin,
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          const plugin = view.plugin(sourceSlashPlugin)
          if (plugin && plugin.handleKeyDown(event)) {
            return true
          }
          return false
        },
      })
    ),
  ]
}
