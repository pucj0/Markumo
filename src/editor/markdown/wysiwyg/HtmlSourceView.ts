import { EditorState as CMState, EditorSelection } from '@codemirror/state'
import { EditorView as CMView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { html, htmlLanguage } from '@codemirror/lang-html'
import { Selection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { markumoSyntax } from '../../core/syntaxTheme'
import { renderSafeHtml, hasUnsupportedHtml, mountHtmlImages, type MountedImageHandle } from '../html/SafeHtmlRenderer'
import type { MarkdownResources } from '../images'

export interface HtmlEditing {
  publish(node:PMNode,pos:number,raw:string):boolean
  range(node:PMNode,pos:number):{from:number;to:number}|null
  selected(anchor:number,head:number):void
  history(forward:boolean):void
  readOnly():boolean
  settled():void
}
export const isHtmlSourceNode=(node:PMNode)=>['html_block','html_inline'].includes(node.type.name)||node.type.name==='protected_source'&&node.attrs.label==='HTML（安全源码）'

/** Local CM is derived from the canonical document, without private history or
 * a deferred draft that could overwrite another pane on blur. */
export class HtmlSourceView implements NodeView {
  readonly dom:HTMLElement
  private preview:HTMLElement
  private editorHost:HTMLElement
  private editButton=document.createElement('button')
  private doneButton=document.createElement('button')
  private images?:MountedImageHandle
  private cm?:CMView
  private applying=false
  private dead=false
  private generation=0
  constructor(private node:PMNode,private view:EditorView,readonly getPos:()=>number|undefined,
    private inline:boolean,private resources:MarkdownResources|undefined,private editing:HtmlEditing) {
    this.dom=document.createElement(inline?'span':'div')
    this.dom.className=inline?'md-html-inline-view':'md-html-block-view'
    this.dom.contentEditable='false';this.dom.tabIndex=0
    this.dom.setAttribute('aria-label',inline?'HTML 行内内容':'HTML 块')
    this.preview=document.createElement(inline?'span':'div')
    this.preview.className=inline?'md-html-inline-content':'md-html-preview'
    this.editorHost=document.createElement(inline?'span':'div')
    this.editorHost.className='md-html-source-editor';this.editorHost.hidden=true
    this.editButton.type='button';this.editButton.className='md-html-edit-trigger'
    this.editButton.textContent='编辑 HTML';this.editButton.title='编辑 HTML 源码 (Enter / F2)'
    this.doneButton.type='button';this.doneButton.className='md-html-done-btn'
    this.doneButton.textContent='完成';this.doneButton.hidden=true
    this.editButton.onclick=e=>{e.stopPropagation();this.startEditing()}
    this.doneButton.onclick=e=>{e.stopPropagation();this.finish(true)}
    this.preview.onclick=e=>{
      if(window.getSelection()?.toString())return
      if(!(e.ctrlKey||e.metaKey)&&(e.target as Element).closest('summary,a,button,input'))return
      e.stopPropagation();this.startEditing()
    }
    this.dom.onkeydown=e=>{
      if(this.cm||e.isComposing||e.defaultPrevented)return
      if(e.key==='Enter'||e.key==='F2'){e.preventDefault();e.stopPropagation();this.startEditing()}
    }
    this.dom.append(this.preview,this.editButton,this.editorHost,this.doneButton)
    this.render()
  }
  get composing(){return !!this.cm?.compositionStarted}
  get sourceSelection(){
    const pos=this.getPos(),range=pos===undefined?null:this.editing.range(this.node,pos)
    const selection=this.cm?.state.selection.main
    return range&&selection?{anchor:range.from+selection.anchor,head:range.from+selection.head}:null
  }
  private current(){const pos=this.getPos();return !this.dead&&pos!==undefined&&this.view.state.doc.nodeAt(pos)===this.node?pos:undefined}
  private render(){
    this.images?.destroy()
    const raw=String(this.node.attrs.source||'')
    renderSafeHtml(this.preview,raw)
    if(hasUnsupportedHtml(raw)||!this.preview.textContent?.trim()&&!this.preview.querySelector('img,svg,hr,br')){
      this.preview.textContent=raw;this.preview.classList.add('md-html-raw-fallback')
    }else this.preview.classList.remove('md-html-raw-fallback')
    const imageEnds:number[]=[]
    htmlLanguage.parser.parse(raw).iterate({enter(node){
      if(!['OpenTag','SelfClosingTag'].includes(node.name))return
      const tag=node.node.getChild('TagName')
      if(tag&&raw.slice(tag.from,tag.to).toLowerCase()==='img')imageEnds.push(node.to)
    }})
    const offsets=new WeakMap<HTMLImageElement,number>()
    this.preview.querySelectorAll('img').forEach((image,index)=>{if(imageEnds[index]!==undefined)offsets.set(image,imageEnds[index])})
    this.images=mountHtmlImages(this.preview,this.resources,image=>this.startEditing(offsets.get(image)))
  }
  startEditing(offset?:number){
    if(this.cm||this.current()===undefined||this.editing.readOnly())return
    const generation=++this.generation
    const source=String(this.node.attrs.source||'')
    this.preview.hidden=true;this.editButton.hidden=true;this.editorHost.hidden=false;this.doneButton.hidden=false
    this.dom.classList.add('md-html-editing')
    this.cm=new CMView({parent:this.editorHost,state:CMState.create({doc:source,selection:EditorSelection.cursor(Math.max(0,Math.min(source.length,offset??source.length))),extensions:[
      html(),markumoSyntax,CMView.lineWrapping,
      CMView.editorAttributes.of({style:'height:auto;min-height:0;width:100%'}),
      CMView.contentAttributes.of({'aria-label':'HTML 局部源码'}),
      keymap.of([
        {key:'Mod-z',run:()=>{this.editing.history(false);return true}},
        {key:'Mod-y',run:()=>{this.editing.history(true);return true}},
        {key:'Mod-Shift-z',run:()=>{this.editing.history(true);return true}},
        {key:'Escape',run:()=>{this.finish(true);return true}},
        {key:'Mod-Enter',run:()=>{this.finish(true);return true}},
        {key:'Enter',run:()=>{this.finish(true,!this.inline);return true}},
        {key:'Shift-Enter',run:view=>{view.dispatch(view.state.replaceSelection('\n'));return true}},
        {key:'ArrowRight',run:view=>this.leaveAtEdge(view,1)},
        {key:'ArrowLeft',run:view=>this.leaveAtEdge(view,-1)},
        indentWithTab,...defaultKeymap,
      ]),
      CMView.updateListener.of(update=>{
        if(this.dead||generation!==this.generation)return
        if(update.docChanged){
          const pos=this.current()
          if(pos===undefined||this.editing.readOnly()){queueMicrotask(()=>this.finish(false));return}
          this.applying=true
          const accepted=this.editing.publish(this.node,pos,update.state.doc.toString())
          this.applying=false
          if(!accepted){queueMicrotask(()=>this.finish(false));return}
        }
        if(update.docChanged||update.selectionSet)this.publishSelection()
      }),
      CMView.domEventHandlers({
        blur:()=>{queueMicrotask(()=>{if(!this.dead&&!this.dom.contains(document.activeElement)&&!this.composing)this.finish(false)})},
        compositionend:()=>{setTimeout(()=>this.editing.settled(),0)},
      }),
    ]})})
    this.cm.focus();this.publishSelection()
  }
  private publishSelection(){const selection=this.sourceSelection;if(selection)this.editing.selected(selection.anchor,selection.head)}
  private leaveAtEdge(view:CMView,direction:number){
    const sel=view.state.selection.main
    if(!sel.empty||sel.head!==(direction<0?0:view.state.doc.length))return false
    this.finish(true,false,direction);return true
  }
  private finish(focus:boolean,nextParagraph=false,direction=1){
    if(!this.cm)return
    const cm=this.cm;this.cm=undefined
    this.generation++
    queueMicrotask(()=>cm.destroy())
    this.editorHost.hidden=true;this.preview.hidden=false;this.editButton.hidden=false;this.doneButton.hidden=true
    this.dom.classList.remove('md-html-editing');this.render()
    const pos=this.current()
    if(focus&&pos!==undefined){
      let tr=this.view.state.tr,at=direction<0?pos:pos+this.node.nodeSize
      if(nextParagraph){
        const paragraph=this.view.state.schema.nodes.paragraph.create(),resolved=tr.doc.resolve(at)
        if(resolved.parent.canReplaceWith(resolved.index(),resolved.index(),paragraph.type)){
          tr=tr.insert(at,paragraph);at++
        }
      }
      tr.setSelection(Selection.near(tr.doc.resolve(at),direction))
      this.view.dispatch(tr.scrollIntoView());this.view.focus()
    }
    this.editing.settled()
  }
  update(node:PMNode){
    if(node.type!==this.node.type||!isHtmlSourceNode(node))return false
    const changed=node.attrs.source!==this.node.attrs.source
    this.node=node
    if(changed&&!this.applying&&this.cm)this.finish(false)
    if(!this.cm)this.render()
    return true
  }
  stopEvent(){return true}
  ignoreMutation(){return true}
  destroy(){this.dead=true;this.generation++;this.cm?.destroy();this.cm=undefined;this.images?.destroy()}
}
