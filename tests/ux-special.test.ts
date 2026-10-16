import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxTree } from '@codemirror/language'
import { tableModel, editTableCell, editTable } from '../src/editor/markdown/tableModel'
import { tableField } from '../src/editor/markdown/tableField'
import { defaultSettings, settingsFrom } from '../src/features/shell/editorSettings'
import { readablePath, displayFilePath } from '../src/features/shell/pathDisplay'

const source = '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| **中文** | a\\|b | `x` |\n\n尾段'
const state = (doc = source) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ extensions: [GFM] }), tableField] })
const model = (s: EditorState) => { const node = syntaxTree(s).topNode.getChild('Table'); return node ? tableModel(s, node) : null }

describe('编辑体验专项：源码与 UI 展示的边界', () => {
  it('从真实 AST 解析表格并保留单元格位置与行内节点', () => {
    const s = state(), m = model(s)!
    expect(m.align).toEqual(['left','center','right'])
    expect(m.rows[1].cells[0].inline?.some(node => node.name === 'StrongEmphasis')).toBe(true)
    for (const row of m.rows) for (const cell of row.cells) expect(s.sliceDoc(cell.from, cell.to)).toBe(cell.text)
  })
  it('代码块、不完整和嵌套表格保持安全源码', () => {
    for (const text of ['```\n'+source+'\n```', '|a|b|\n|bad|---|', source.split('\n').map(line => '> '+line).join('\n')]) expect(model(state(text))).toBeNull()
  })
  it('块 Decoration 直接来自 StateField，选择仅展开局部源码', () => {
    const s = state(), m = model(s)!
    let blocks = 0
    s.field(tableField).decorations.between(0,s.doc.length,(_f,_t,decoration) => { if (decoration.spec.block) blocks++ })
    expect(blocks).toBe(1)
    const active = s.update({selection:{anchor:m.rows[1].cells[0].from}}).state
    blocks = 0
    active.field(tableField).decorations.between(0,active.doc.length,(_f,_t,decoration) => { if (decoration.spec.block) blocks++ })
    expect(blocks).toBe(0)
    expect(active.doc.toString()).toBe(source)
  })
  it('单元格输入转义偶数反斜杠后的管道，拒绝结构换行', () => {
    const s = state(), m = model(s)!
    for (const text of ['a|b','a\\|b','a\\\\|b']) {
      const edited = s.update(editTableCell(m,1,0,text)!).state
      expect(model(edited)!.rows[1].cells.length).toBe(3)
      expect(edited.sliceDoc(edited.doc.length-2)).toBe('尾段')
    }
    expect(editTableCell(m,1,0,'break\nrow')).toBeNull()
  })
  it('行列操作不触碰表格外内容，防止删除表头和最后一列', () => {
    const s = state(), m = model(s)!
    for (const operation of ['row-add','row-delete','column-add','column-delete'] as const) {
      const edited = s.update(editTable(m,operation,1,1)!).state
      expect(model(edited)).not.toBeNull()
      expect(edited.sliceDoc(edited.doc.length-2)).toBe('尾段')
    }
    expect(editTable(m,'row-delete',0,0)).toBeNull()
    const one = model(state('|a|\n|-|\n|b|\n\nend'))!
    expect(editTable(one,'column-delete',1,0)).toBeNull()
  })
  it('超过百万字符保护保留表格源码', () => {
    const s = state(source+'\n'+'x'.repeat(1024*1024))
    expect(s.field(tableField).decorations.size).toBe(0)
    expect(s.doc.toString()).toContain(source)
  })
  it('路径显示处理驱动器、UNC 和根边界，保留操作路径', () => {
    const raw = '\\\\?\\UNC\\服务器\\共享\\中文 文件.md'
    expect(readablePath(raw)).toBe('\\\\服务器\\共享\\中文 文件.md')
    expect(displayFilePath(raw,{rootPath:'\\\\服务器\\共享',name:'共享'},true)).toBe('共享/中文 文件.md')
    expect(raw.startsWith('\\\\?\\')).toBe(true)
    expect(displayFilePath('C:\\root2\\a',{rootPath:'C:\\root',name:'root'})).toBe('C:\\root2\\a')
  })
  it('快捷键迁移只改变可识别的旧默认，保存明确自定义', () => {
    const {bold,italic,explorer,'close-current':close,...oldKeys} = defaultSettings().shortcuts
    const legacy = { shortcuts:{...oldKeys,sidebar:'Mod+B',replace:'Mod+H'} as Record<string, string>,shortcutVersion:1 }
    expect(settingsFrom(legacy).shortcuts.replace).toBe('Mod+R')
    expect(settingsFrom({...legacy,shortcutVersion:3,customShortcuts:['replace','sidebar']}).shortcuts.replace).toBe('Mod+H')
    legacy.shortcuts.find = 'Mod+Alt+F'
    expect(settingsFrom(legacy).shortcuts.replace).toBe('Mod+H')
  })
})
