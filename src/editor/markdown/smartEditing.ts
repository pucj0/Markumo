import { Prec, EditorSelection, type StateCommand } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { indentMore, indentLess } from '@codemirror/commands'
import { insertNewlineContinueMarkupCommand, deleteMarkupBackward } from '@codemirror/lang-markdown'
// Exit an empty item immediately instead of first converting a tight list to loose.
const continueDefaultMarkup = insertNewlineContinueMarkupCommand({ nonTightLists:false })
export const continueMarkdownMarkup: StateCommand = target => {
  const {state,dispatch}=target
  const emptyQuotes=state.selection.ranges.every(range=>{
    const line=state.doc.lineAt(range.head)
    if(!range.empty||range.head!==line.to||!/^\s*(?:>\s*)+$/.test(line.text))return false
    for(let node=syntaxTree(state).resolveInner(range.head,-1);node;node=node.parent!) {
      if(['FencedCode','CodeBlock'].includes(node.name))return false
      if(node.name==='Blockquote')return true
    }
    return false
  })
  if(emptyQuotes&&!state.readOnly){
    dispatch(state.update(state.changeByRange(range=>{
      const line=state.doc.lineAt(range.head),from=line.from+line.text.lastIndexOf('>')
      return {changes:{from,to:line.to,insert:''},range:EditorSelection.cursor(from)}
    }),{userEvent:'input',scrollIntoView:true}));return true
  }
  return continueDefaultMarkup(target)
}

function inList(view: EditorView, position: number) {
  let node = syntaxTree(view.state).resolveInner(position, -1)
  for (; node; node = node.parent!) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
    if (node.name === 'ListItem') return true
  }
  return false
}
export function indentMarkdownList(view: EditorView, outdent = false) {
  if (view.compositionStarted || view.state.readOnly) return false
  if (!view.state.selection.ranges.every(range => inList(view, range.from) && inList(view, range.to))) return false
  return (outdent ? indentLess : indentMore)(view)
}
export const markdownSmartEditing = Prec.high(keymap.of([
  { key:'Enter', run:view => !view.compositionStarted && !view.state.readOnly && continueMarkdownMarkup(view) },
  { key:'Backspace', run:view => !view.compositionStarted && !view.state.readOnly && deleteMarkupBackward(view) },
  { key:'Tab', run:view => indentMarkdownList(view) },
  { key:'Shift-Tab', run:view => indentMarkdownList(view,true) },
]))
