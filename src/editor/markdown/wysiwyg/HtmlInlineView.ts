import { HtmlSourceView, type HtmlEditing } from './HtmlSourceView'
import type { Node } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import type { MarkdownResources } from '../images'
export class HtmlInlineView extends HtmlSourceView {
  constructor(node:Node,view:EditorView,getPos:()=>number|undefined,resources:MarkdownResources|undefined,editing:HtmlEditing){
    super(node,view,getPos,true,resources,editing)
  }
}
