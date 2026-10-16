import { Schema, type NodeSpec } from 'prosemirror-model'
import { schema as commonmark } from 'prosemirror-markdown'
import { tableNodes } from 'prosemirror-tables'
import { safeMarkdownURL } from '../links'

const nodes: Record<string, NodeSpec> = {}
commonmark.spec.nodes.forEach((name, spec) => { nodes[name] = name==='text'?spec:{ ...spec, attrs: { ...spec.attrs, sourceId: { default: null } } } })
nodes.code_block.attrs = { ...nodes.code_block.attrs, fence: { default: '```' } }
nodes.heading.content='inline*'
nodes.bullet_list.attrs = { ...nodes.bullet_list.attrs, bullet: { default: '-' } }
nodes.list_item.attrs = { ...nodes.list_item.attrs, checked: { default: null } }
nodes.soft_break = { inline: true, group: 'inline', selectable: false, toDOM: () => ['br', { 'data-soft': 'true' }], parseDOM: [{tag:'br[data-soft]'}] }
nodes.math_inline={inline:true,group:'inline',atom:true,attrs:{latex:{default:''}},toDOM:node=>['span',{'data-math':'true'},node.attrs.latex]}
nodes.footnote_reference={inline:true,group:'inline',atom:true,attrs:{label:{default:''}},toDOM:node=>['sup',{'data-footnote':'true'},node.attrs.label]}
nodes.html_block = {
  group: 'block', atom: true, selectable: true, isolating: true,
  attrs: { sourceId: {default:null}, source: {default:''} },
  toDOM: () => ['div', {'data-html-block':'true', class:'md-html-block-node'}],
}
nodes.html_inline = {
  group: 'inline', inline: true, atom: true, selectable: true,
  attrs: { source: {default:''} },
  toDOM: node => ['span', {'data-html-inline':'true', class:'md-html-inline-node'}, node.attrs.source],
}
nodes.protected_source = {
  group: 'block', atom: true, selectable: true, isolating: true,
  attrs: { sourceId: {default:null}, source: {default:''}, label: {default:'受保护源码'} },
  toDOM: node => ['pre', {'data-protected-source':'true'}, node.attrs.source],
}
Object.assign(nodes, tableNodes({ tableGroup:'block', cellContent:'paragraph', cellAttributes:{
  align: {default:null, getFromDOM: dom => dom.style.textAlign || null, setDOMAttr: (value, attrs) => { if (value) attrs.style = `text-align:${value}` }},
} }))
nodes.table.attrs = { sourceId: { default: null } }
// HTML from the clipboard is parsed by the schema. Image URLs are only assigned
// by our budgeted image NodeView; links never receive executable protocols.
nodes.image.toDOM = node => ['span', { 'data-image-source': node.attrs.src }, node.attrs.alt || '图片']
export const markdownSchema = new Schema({ nodes, marks: commonmark.spec.marks.append({
  strike: {parseDOM:[{tag:'s'},{tag:'del'}], toDOM:()=>['s',0]},
}).update('link', { ...commonmark.spec.marks.get('link')!, toDOM: mark => ['a', {href:safeMarkdownURL(mark.attrs.href) || undefined, 'data-href':mark.attrs.href, title:mark.attrs.title},0] }) })
