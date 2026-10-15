import { EditorState, Plugin, TextSelection, Selection, NodeSelection, type Transaction, type Command } from 'prosemirror-state'
import { EditorView, type NodeView } from 'prosemirror-view'
import type { Node } from 'prosemirror-model'
import { baseKeymap, chainCommands, exitCode, liftEmptyBlock, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { inputRules, textblockTypeInputRule, wrappingInputRule, InputRule } from 'prosemirror-inputrules'
import { wrapInList, splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list'
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, goToNextCell, tableEditing, isInTable, selectedRect } from 'prosemirror-tables'
import { gapCursor } from 'prosemirror-gapcursor'
import { markdownSchema as s } from './MarkdownSchema'
import { MarkdownSourceBridge } from './MarkdownSourceBridge'
import { CodeBlockView } from './CodeBlockView'
import { mountMarkdownImage } from '../images'
import { openMarkdownLink, safeMarkdownURL } from '../links'
import { textClipboard } from '../../../features/shell/clipboard'
import type { MarkdownFormat } from '../formatCommands'
import type { LiveEditor, LiveOptions, MarkdownTypography } from './contracts'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-tables/style/tables.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import './MarkdownTheme.css'

interface LiveUpdate { bridge:MarkdownSourceBridge; transactions:readonly Transaction[] }
let nodeIdentity=0
function notice(error:unknown){window.dispatchEvent(new CustomEvent('editor-notice',{detail:String(error)}))}
export class MarkdownEditorController implements LiveEditor {
  readonly view:EditorView; bridge:MarkdownSourceBridge
  readonly dom=document.createElement('div')
  private tableTools=document.createElement('div');private properties=document.createElement('div')
  private codeViews=new Set<CodeBlockView>();private images=new Set<()=>void>()
  private extensionViews=new Set<()=>void>()
  private compositionActive=false
  private onCompositionStart=()=>{this.compositionActive=true}
  private settings:MarkdownTypography;private disposed=false;private pendingSource:string|null=null
  private wasReadOnly=false
  private onCompositionEnd=()=>{this.compositionActive=false;setTimeout(()=>{if(!this.disposed&&this.pendingSource!==null){const source=this.pendingSource;this.pendingSource=null;this.sync(source)}},0)}
  constructor(parent:HTMLElement,private options:LiveOptions){
    this.settings=options.typography;this.bridge=new MarkdownSourceBridge(options.source)
    this.wasReadOnly=options.readOnly?.()??false
    this.dom.className='markdown-live';this.dom.setAttribute('aria-label','Markdown 所见即所得编辑器')
    this.tableTools.className='md-table-tools';this.tableTools.setAttribute('role','toolbar');this.tableTools.setAttribute('aria-label','表格工具')
    this.properties.className='md-properties';this.properties.hidden=true
    const mount=document.createElement('div');mount.className='md-document'
    this.dom.append(this.tableTools,this.properties,mount);parent.append(this.dom)
    const tableCommands:[string,Command][]=[['前插行',addRowBefore],['后插行',addRowAfter],['删除行',deleteRow],['前插列',addColumnBefore],['后插列',addColumnAfter],['删除列',deleteColumn],['左对齐',this.align('left')],['居中对齐',this.align('center')],['右对齐',this.align('right')],['删除表格',deleteTable]]
    for(const [label,command]of tableCommands){const button=document.createElement('button');button.type='button';button.textContent=label;button.onmousedown=event=>event.preventDefault();button.onclick=()=>this.run(command,true);this.tableTools.append(button)}
    this.tableTools.hidden=true
    const rules=inputRules({rules:[
      textblockTypeInputRule(/^(#{1,6})\s$/,s.nodes.heading,match=>({level:match[1].length})),
      textblockTypeInputRule(/^```([^`\s]*)\s$/,s.nodes.code_block,match=>({params:match[1]})),
      wrappingInputRule(/^\s*>\s$/,s.nodes.blockquote),wrappingInputRule(/^\s*([-+*])\s$/,s.nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/,s.nodes.ordered_list,match=>({order:+match[1]})),
      new InputRule(/^\[([ xX])\] $/,(state,match,start,end)=>{const $from=state.doc.resolve(start);for(let depth=$from.depth;depth>0;depth--)if($from.node(depth).type===s.nodes.list_item)return state.tr.delete(start,end).setNodeMarkup($from.before(depth),undefined,{...$from.node(depth).attrs,checked:match[1]!==' '});return null}),
    ]})
    this.view=new EditorView(mount,{
      state:EditorState.create({schema:s,doc:this.bridge.doc,plugins:[
        new Plugin({appendTransaction:(_transactions,_before,state)=>{
          const seen=new Set<string>(),tr=state.tr
          state.doc.forEach((node,pos)=>{const id=node.attrs.sourceId as string;if(!id||seen.has(id))tr.setNodeMarkup(pos,undefined,{...node.attrs,sourceId:`live-${++nodeIdentity}`});else seen.add(id)})
          return tr.steps.length?tr:null
        }}),rules,keymap({
          'Mod-z':()=>{options.history(false);return true},'Mod-y':()=>{options.history(true);return true},'Mod-Shift-z':()=>{options.history(true);return true},
          'Mod-b':toggleMark(s.marks.strong),'Mod-i':toggleMark(s.marks.em),'Mod-Shift-x':toggleMark(s.marks.strike),'Mod-`':toggleMark(s.marks.code),
          'Enter':chainCommands(splitListItem(s.nodes.list_item,{checked:null}),liftEmptyBlock,baseKeymap.Enter),
          'Tab':chainCommands(this.nextCell(1),sinkListItem(s.nodes.list_item)),
          'Shift-Tab':chainCommands(this.nextCell(-1),liftListItem(s.nodes.list_item)),
          'Shift-Enter':(state,dispatch)=>{dispatch?.(state.tr.replaceSelectionWith(s.nodes.hard_break.create()).scrollIntoView());return true},
          'Mod-Enter':exitCode,
          ...Object.fromEntries([1,2,3,4,5,6].map(level=>[`Mod-Alt-${level}`,setBlockType(s.nodes.heading,{level})])),
        }),keymap(baseKeymap),gapCursor(),new Plugin({props:{
          handleDOMEvents:{focus:()=>{options.focus();return false},beforeinput:(_view,event)=>{const e=event as InputEvent;if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();options.history(e.inputType==='historyRedo');return true}return false},
            contextmenu:(view,event)=>{if(!(event.target as Element).closest('td,th'))return false;const pos=view.posAtCoords({left:event.clientX,top:event.clientY});if(pos)view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));event.preventDefault();this.updateTools();this.tableTools.querySelector('button')?.focus();return true}},
          handleClick:(view,_pos,event)=>{const a=(event.target as Element).closest('a');if(!a)return false;event.preventDefault();if(event.ctrlKey||event.metaKey)this.openLink(a.getAttribute('data-href')||'');else{const at=view.posAtDOM(a,0);view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,at)));this.linkProperties(a.getAttribute('data-href')||'')}return true},
          transformPastedHTML:html=>{
            const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach(el=>el.remove())
            for(const el of doc.body.querySelectorAll('*'))for(const attr of [...el.attributes])if(attr.name.startsWith('on')||['style','src','srcset'].includes(attr.name)||attr.name==='href'&&!safeMarkdownURL(attr.value)&&!attr.value.startsWith('#'))el.removeAttribute(attr.name)
            return doc.body.innerHTML
          },
        }}),tableEditing(),
      ]}),
      nodeViews:{
        code_block:(node,view,getPos)=>{const code=new CodeBlockView(node,view,getPos,this.settings,options.history);this.codeViews.add(code);const destroy=code.destroy.bind(code);code.destroy=()=>{this.codeViews.delete(code);destroy()};return code},
        protected_source:(node,view,getPos)=>this.protectedView(node,view,getPos),
        image:(node,view,getPos)=>this.imageView(node,view,getPos),
        math_inline:(node,view,getPos)=>this.mathView(node,view,getPos),
        footnote_reference:(node,view)=>{const dom=document.createElement('sup');dom.className='md-footnote';dom.contentEditable='false';dom.textContent=node.attrs.label;dom.title='查看脚注';dom.onclick=()=>{view.state.doc.forEach((block,pos)=>{if(block.type===s.nodes.protected_source&&String(block.attrs.source).includes(`[^${node.attrs.label}]:`)){view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,pos)).scrollIntoView());const target=this.dom.querySelectorAll<HTMLDetailsElement>('.md-protected');for(const item of target)if(item.textContent?.includes(`[^${node.attrs.label}]`))item.open=true}})};return {dom,stopEvent:()=>true}},
        list_item:(node,view,getPos)=>this.listView(node,view,getPos),
      },
      attributes:{class:'md-prose',spellcheck:'false','aria-label':'Markdown 正文'},
      editable:()=>!options.readOnly?.(),
      dispatchTransaction:tr=>this.dispatch(tr),
    })
    this.dom.addEventListener('compositionend',this.onCompositionEnd)
    this.dom.addEventListener('compositionstart',this.onCompositionStart,true)
    this.typography(options.typography)
    this.reveal(options.head);this.updateTools()
  }
  get composing(){return this.compositionActive||this.view.composing||[...this.codeViews].some(code=>code.cm.compositionStarted)}
  get selection(){const sel=this.view.state.selection;return {anchor:this.bridge.sourcePosition(sel.anchor),head:this.bridge.sourcePosition(sel.head)}}
  private dispatch(tr:Transaction){
    if(this.disposed)return
    try{
      const applied=this.view.state.applyTransaction(tr),before=this.bridge.source
      if(applied.state.doc.eq(this.view.state.doc)){this.view.updateState(applied.state);this.updateTools();const sel=this.selection;this.options.selected(sel.anchor,sel.head);return}
      const prepared=this.bridge.prepare(applied.state.doc)
      const previous={source:this.bridge.source,doc:this.bridge.doc,blocks:this.bridge.blocks}
      prepared.commit()
      const update:LiveUpdate={bridge:this.bridge,transactions:applied.transactions}
      if(prepared.patch&&!this.options.publish(before,prepared.patch,update,!!tr.getMeta('isolated'))){Object.assign(this.bridge,previous);this.view.updateState(this.view.state);notice('文档版本已变化或为只读；已拒绝 Markdown 修改。');return}
      this.view.updateState(applied.state);this.updateTools();const sel=this.selection;this.options.selected(sel.anchor,sel.head)
    }catch(error){notice(`Markdown 修改未应用：${String(error)}`)}
  }
  sync(source:string,update?:unknown){
    if(this.disposed||source===this.bridge.source)return
    if(this.composing){this.pendingSource=source;return}
    const remote=update as LiveUpdate|undefined
    if(remote&&remote.transactions[0]?.before.eq(this.view.state.doc)){
      let state=this.view.state
      for(const transaction of remote.transactions){const tr=state.tr;for(const step of transaction.steps)tr.step(step);state=state.apply(tr)}
      this.bridge=new MarkdownSourceBridge('');Object.assign(this.bridge,{source,doc:remote.bridge.doc,blocks:remote.bridge.blocks,tail:remote.bridge.tail})
      this.view.updateState(state)
    }else{
      const sel=this.selection,bridge=new MarkdownSourceBridge(source),state=this.view.state
      // Preserve structurally unchanged nodes/NodeViews during Source edits and undo.
      const start=state.doc.content.findDiffStart(bridge.doc.content),end=state.doc.content.findDiffEnd(bridge.doc.content)
      let tr=state.tr
      if(start!==null&&end){const overlap=start-Math.min(end.a,end.b);tr=tr.replace(start,end.a+Math.max(0,overlap),bridge.doc.slice(start,end.b+Math.max(0,overlap)))}
      this.bridge=bridge
      if(!tr.doc.eq(bridge.doc))tr=state.tr.replaceWith(0,state.doc.content.size,bridge.doc.content)
      const head=Math.min(tr.doc.content.size,bridge.documentPosition(sel.head));tr.setSelection(Selection.near(tr.doc.resolve(head)))
      this.view.updateState(state.apply(tr))
    }
    this.updateTools()
  }
  focus(){this.view.focus()}
  reveal(position:number){const at=Math.min(this.view.state.doc.content.size,this.bridge.documentPosition(position));this.view.dispatch(this.view.state.tr.setSelection(Selection.near(this.view.state.doc.resolve(at))).scrollIntoView())}
  typography(settings:MarkdownTypography){this.settings=settings;const style=this.dom.style;style.setProperty('--md-content-width',`${settings.width}px`);style.setProperty('--md-font-size',`${settings.fontSize}px`);style.setProperty('--md-line-height',String(settings.lineHeight));style.setProperty('--md-font-family',settings.fontFamily==='system'?'"Segoe UI", "Microsoft YaHei", system-ui, sans-serif':settings.fontFamily==='serif'?'Georgia, "Noto Serif CJK SC", "SimSun", serif':'"Cascadia Code", Consolas, monospace');for(const code of this.codeViews)code.typography(settings)}
  private run(command:Command,isolated=false){const result=command(this.view.state,tr=>this.view.dispatch(isolated?tr.setMeta('isolated',true):tr),this.view);this.view.focus();return result}
  format(format:MarkdownFormat):boolean{
    const marks={bold:'strong',italic:'em',strike:'strike','inline-code':'code'} as const
    if(format in marks)return this.run(toggleMark(s.marks[marks[format as keyof typeof marks]]),true)
    if(format.startsWith('heading-'))return this.run(setBlockType(s.nodes.heading,{level:+format.slice(-1)}),true)
    if(format==='quote')return this.run(wrapIn(s.nodes.blockquote),true)
    if(format==='bullet'||format==='task'||format==='ordered'){
      const result=this.run(wrapInList(format==='ordered'?s.nodes.ordered_list:s.nodes.bullet_list),true)
      if(format==='task')this.view.state.doc.nodesBetween(this.view.state.selection.from,this.view.state.selection.to,(node,pos)=>{if(node.type===s.nodes.list_item)this.view.dispatch(this.view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,checked:false}))})
      return result
    }
    if(format==='code-block')return this.run(setBlockType(s.nodes.code_block),true)
    if(format==='table'){
      const cell=(header:boolean)=> (header?s.nodes.table_header:s.nodes.table_cell).createAndFill()!
      const table=s.nodes.table.create(null,[s.nodes.table_row.create(null,[cell(true),cell(true)]),s.nodes.table_row.create(null,[cell(false),cell(false)])])
      this.view.dispatch(this.view.state.tr.replaceSelectionWith(table).setMeta('isolated',true));return true
    }
    if(format==='rule'){this.view.dispatch(this.view.state.tr.replaceSelectionWith(s.nodes.horizontal_rule.create()).setMeta('isolated',true));return true}
    if(format==='link'){this.linkProperties('https://');return true}
    if(format==='image'){this.view.dispatch(this.view.state.tr.replaceSelectionWith(s.nodes.image.create({src:'',alt:''})).setMeta('isolated',true));return true}
    return false
  }
  private nextCell(direction:1|-1):Command{return (state,dispatch,view)=>{if(!isInTable(state))return false;if(goToNextCell(direction)(state,dispatch,view))return true;if(direction>0){return addRowAfter(state,tr=>{dispatch?.(tr);goToNextCell(1)(this.view.state,dispatch,view)})}return false}}
  private align(value:string):Command{return (state,dispatch)=>{if(!isInTable(state))return false;const rect=selectedRect(state),tr=state.tr;for(let row=0;row<rect.map.height;row++){const pos=rect.tableStart+rect.map.positionAt(row,rect.left,rect.table);tr.setNodeMarkup(pos,undefined,{...tr.doc.nodeAt(pos)!.attrs,align:value})}dispatch?.(tr);return true}}
  private updateTools(){this.tableTools.hidden=!isInTable(this.view.state);for(const refresh of this.extensionViews)refresh()}
  private field(label:string,value:string){const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('input');input.setAttribute('aria-label',label);input.value=value;wrapper.append(input);this.properties.append(wrapper);return input}
  private propertyButton(label:string,action:()=>void){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;this.properties.append(button)}
  private linkProperties(href:string){
    this.properties.replaceChildren();this.properties.hidden=false
    const selection=this.view.state.selection;let from=selection.from,to=selection.to
    const $pos=this.view.state.doc.resolve(from),link=s.marks.link.isInSet($pos.marks())||s.marks.link.isInSet($pos.nodeAfter?.marks||[])
    if(link){const parent=$pos.parent,start=$pos.start();parent.forEach((node,offset)=>{if(s.marks.link.isInSet(node.marks)?.eq(link)&&start+offset<=from&&start+offset+node.nodeSize>=from){from=start+offset;to=from+node.nodeSize}})}
    const text=this.field('链接文字',this.view.state.doc.textBetween(from,to)),url=this.field('链接 URL',href)
    const expected=this.view.state.doc.slice(from,to).content
    const current=()=>to<=this.view.state.doc.content.size&&this.view.state.doc.slice(from,to).content.eq(expected)
    this.propertyButton('应用链接',()=>{if(!current()){notice('链接内容已变化，请重新选择链接。');this.properties.hidden=true;return}const mark=s.marks.link.create({href:url.value});const tr=this.view.state.tr;if(text.value)tr.replaceWith(from,to,s.text(text.value,[mark]));else tr.addMark(from,to,mark);this.view.dispatch(tr.setMeta('isolated',true));this.properties.hidden=true;this.focus()})
    this.propertyButton('打开链接',()=>this.openLink(url.value));this.propertyButton('移除链接',()=>{if(current())this.view.dispatch(this.view.state.tr.removeMark(from,to,s.marks.link).setMeta('isolated',true));this.properties.hidden=true;this.focus()})
  }
  private openLink(href:string){if(href.startsWith('#')){let slug:string;try{slug=decodeURIComponent(href.slice(1))}catch{return}let target:number|undefined;this.view.state.doc.descendants((node,pos)=>{if(node.type===s.nodes.heading&&node.textContent.toLowerCase().replace(/\s+/g,'-')===slug)target=pos+1});if(target!==undefined){this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc,target)).scrollIntoView());this.focus()}return}if(safeMarkdownURL(href)){void openMarkdownLink(href);return}if(!/^[/\\]|:|[\0\r\n]/.test(href)){this.options.openRelative?.(href);return}notice('链接协议或路径未获允许。')}
  private protectedView(node:Node,view:EditorView,getPos:()=>number|undefined):NodeView{
    const dom=document.createElement('div'),details=document.createElement('details'),summary=document.createElement('summary'),input=document.createElement('textarea'),preview=document.createElement('div');details.className='md-protected';dom.className='md-extension';dom.contentEditable='false';summary.textContent=node.attrs.label;input.value=node.attrs.source;input.setAttribute('aria-label',node.attrs.label);input.spellcheck=false;details.append(summary,input);dom.append(preview,details)
    let previous=''
    const refresh=()=>{
      const source=String(node.attrs.source),toc=/^\[toc\]$/i.test(source.trim())
      const key=toc?view.state.doc.textContent:source
      if(key===previous)return;previous=key;preview.replaceChildren()
      if(toc){summary.textContent='目录源码';preview.className='md-toc';view.state.doc.descendants((heading,pos)=>{if(heading.type!==s.nodes.heading)return;const button=document.createElement('button');button.type='button';button.textContent=heading.textContent;button.style.paddingLeft=`${(heading.attrs.level-1)*14+8}px`;button.onclick=()=>{view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,pos+1)).scrollIntoView());view.focus()};preview.append(button)})}
      else if(/^\$\$[\s\S]*\$\$$/.test(source.trim())){summary.textContent='数学公式源码';const button=document.createElement('button');button.type='button';button.textContent='渲染公式';const output=document.createElement('div');output.className='md-math-output';button.onclick=async()=>{button.disabled=true;try{await (await import('./renderers')).renderMath(output,source.trim().slice(2,-2).trim(),true)}catch(error){output.textContent=String(error)}finally{button.disabled=false}};preview.append(button,output)}
      else if(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(source)){summary.textContent='Callout 源码';preview.className='md-callout';const lines=source.split('\n'),title=document.createElement('strong');title.textContent=lines[0].replace(/^>\s*\[!|\]$/g,'');const body=document.createElement('p');body.textContent=lines.slice(1).map(line=>line.replace(/^>\s?/, '')).join('\n');preview.append(title,body)}
      else if(/^\s*\[\^/.test(source)){summary.textContent='脚注定义源码';preview.className='md-footnote-definition';preview.textContent=source}
    };refresh();this.extensionViews.add(refresh)
    input.oninput=()=>{const pos=getPos();if(pos!==undefined)view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,source:input.value}))}
    return {dom,stopEvent:()=>true,ignoreMutation:()=>true,update:next=>{if(next.type!==node.type)return false;node=next;if(input.value!==next.attrs.source)input.value=next.attrs.source;refresh();return true},destroy:()=>{input.oninput=null;this.extensionViews.delete(refresh)}}
  }
  private mathView(node:Node,view:EditorView,getPos:()=>number|undefined):NodeView{
    const dom=document.createElement('span');dom.className='md-inline-math';dom.contentEditable='false';dom.textContent=node.attrs.latex;dom.title='点击编辑或渲染公式'
    dom.onclick=()=>{const pos=getPos();if(pos===undefined)return;this.properties.replaceChildren();this.properties.hidden=false;const input=this.field('公式源码',node.attrs.latex);this.propertyButton('应用公式',()=>{const at=getPos();if(at!==undefined)view.dispatch(view.state.tr.setNodeMarkup(at,undefined,{latex:input.value}).setMeta('isolated',true));this.properties.hidden=true});this.propertyButton('渲染公式',()=>{void import('./renderers').then(renderer=>renderer.renderMath(dom,node.attrs.latex)).catch(notice)})}
    return {dom,stopEvent:()=>true,ignoreMutation:()=>true,update:next=>{if(next.type!==node.type)return false;if(next.attrs.latex!==node.attrs.latex)dom.textContent=next.attrs.latex;node=next;return true}}
  }
  private listView(node:Node,view:EditorView,getPos:()=>number|undefined):NodeView{
    const dom=document.createElement('li'),contentDOM=document.createElement('div'),box=document.createElement('input');box.type='checkbox';box.contentEditable='false';box.setAttribute('aria-label','任务完成状态');box.checked=!!node.attrs.checked;box.hidden=node.attrs.checked===null;dom.className=node.attrs.checked===null?'':'md-task';dom.append(box,contentDOM)
    box.onchange=()=>{const pos=getPos();if(pos!==undefined)view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,checked:box.checked}).setMeta('isolated',true));box.checked=!!node.attrs.checked}
    return {dom,contentDOM,stopEvent:event=>event.target===box,update:next=>{if(next.type!==node.type)return false;node=next;box.checked=!!node.attrs.checked;box.hidden=node.attrs.checked===null;dom.className=node.attrs.checked===null?'':'md-task';return true},destroy:()=>{box.onchange=null}}
  }
  private imageView(node:Node,view:EditorView,getPos:()=>number|undefined):NodeView{
    const dom=document.createElement('span');dom.contentEditable='false';let identity=this.options.resources.identity()
    const edit=()=>{const pos=getPos();if(pos===undefined)return;view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,pos)));this.properties.replaceChildren();this.properties.hidden=false;const src=this.field('图片路径',node.attrs.src),alt=this.field('图片替代文字',node.attrs.alt||'');const doc=view.state.doc;this.propertyButton('应用图片',()=>{const at=getPos();if(at!==undefined&&view.state.doc===doc)view.dispatch(view.state.tr.setNodeMarkup(at,undefined,{...node.attrs,src:src.value,alt:alt.value}).setMeta('isolated',true));this.properties.hidden=true});this.propertyButton('删除图片',()=>{const at=getPos();if(at!==undefined&&view.state.doc===doc)view.dispatch(view.state.tr.delete(at,at+node.nodeSize).setMeta('isolated',true));this.properties.hidden=true})}
    let mounted=mountMarkdownImage(dom,node.attrs.src,node.attrs.alt||'',this.options.resources,edit)
    const refresh=()=>{const next=this.options.resources.identity();if(next!==identity){identity=next;mounted.destroy();mounted=mountMarkdownImage(dom,node.attrs.src,node.attrs.alt||'',this.options.resources,edit)}};this.images.add(refresh)
    return {dom,stopEvent:()=>true,ignoreMutation:()=>true,update:next=>{if(next.type!==node.type)return false;if(next.attrs.src!==node.attrs.src||next.attrs.alt!==node.attrs.alt){node=next;mounted.destroy();mounted=mountMarkdownImage(dom,node.attrs.src,node.attrs.alt||'',this.options.resources,edit)}return true},destroy:()=>{this.images.delete(refresh);mounted.destroy()}}
  }
  refreshResources(){for(const refresh of this.images)refresh();const readOnly=this.options.readOnly?.()??false;if(readOnly!==this.wasReadOnly){this.wasReadOnly=readOnly;this.view.setProps({editable:()=>!this.options.readOnly?.()})}}
  async clipboard(operation:'copy'|'cut'|'paste'|'select-all'){
    const state=this.view.state,{from,to}=state.selection
    if(operation==='select-all'){this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc,0,state.doc.content.size)));return}
    if(operation==='paste'){const text=await textClipboard.readText();if(this.view.state!==state)throw new Error('读取剪贴板期间选区变化，已取消粘贴');this.view.dispatch(state.tr.insertText(text).setMeta('isolated',true))}
    else{await textClipboard.writeText(state.doc.textBetween(from,to,'\n'));if(operation==='cut'&&this.view.state===state)this.view.dispatch(state.tr.deleteSelection().setMeta('isolated',true))}
  }
  destroy(){this.disposed=true;this.dom.removeEventListener('compositionend',this.onCompositionEnd);this.dom.removeEventListener('compositionstart',this.onCompositionStart,true);this.view.destroy();this.dom.remove();this.codeViews.clear();this.images.clear();this.extensionViews.clear()}
}
