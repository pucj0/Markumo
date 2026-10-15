import { describe, it, expect } from 'vitest'
import { CommandRegistry, resolveMenu, menuCommand as cmd, separator, type MenuNode } from '../src/features/shell/menuModel'
import { mainMenu, type MainMenuState } from '../src/features/shell/mainMenu'
import { defaultSettings, settingsFrom, validateShortcuts, eventShortcut, shortcutLabel, normalizeShortcut } from '../src/features/shell/editorSettings'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxTree } from '@codemirror/language'
import { history, undo, redo } from '@codemirror/commands'
import { markdownFormatTransaction } from '../src/editor/markdown/formatCommands'
const state:MainMenuState={sidebar:false,outline:false,wrap:false,split:false,focus:false,markdown:true,markdownMode:'live',composing:false,recentFiles:[{name:'相同.md',path:'C:/甲/相同.md'},{name:'相同.md',path:'C:/乙/相同.md'}],recentWorkspaces:['C:/项目 A']}
const walk=(nodes:MenuNode[]):MenuNode[]=>nodes.flatMap(node=>[node,...(node.type==='submenu'?walk(node.children):[])])
const legacy=()=>{const {bold,italic,explorer,'close-current':close,...keys}=defaultSettings().shortcuts;return {...keys,sidebar:'Mod+B',replace:'Mod+H'}}
describe('主菜单结构与命令注册',()=>{
  it('仅四组菜单、所有历史折叠且稳定 ID 与路径关联',()=>{
    const groups=mainMenu(state)
    expect(groups.map(group=>group.title)).toEqual(['文件','编辑','格式','视图'])
    expect(groups[0].items.flatMap(node=>'commandId'in node?[node.commandId]:[])).not.toContain('recent-file:C:/甲/相同.md')
    expect(walk(groups[0].items).find(node=>node.id==='recent-file:C:/乙/相同.md')).toMatchObject({label:'相同.md — 乙'})
    const ids=walk(groups.flatMap(group=>group.items)).map(node=>node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('uppercase');expect(ids).not.toContain('theme');expect(ids).not.toContain('settings')
  })
  it('解析动态状态且不执行禁用/隐藏或缺失的命令',()=>{
    let calls=0
    const registry=new CommandRegistry([{id:'enabled',title:'执行',enabled:true,run:()=>{calls++}},{id:'disabled',title:'禁止',enabled:false,run:()=>{calls++}},{id:'hidden',title:'隐藏',enabled:true,visible:false,run:()=>{calls++}}])
    expect(resolveMenu([separator('first'),cmd('hidden'),separator('gap'),cmd('enabled'),separator('one'),separator('two'),cmd('disabled'),cmd('missing'),separator('last')],registry).map(node=>node.id)).toEqual(['enabled','one','disabled','missing'])
    expect(registry.execute('enabled')).toBe(true)
    expect(registry.execute('disabled')).toBe(false);expect(registry.execute('hidden')).toBe(false);expect(registry.execute('missing')).toBe(false);expect(calls).toBe(1)
    expect(()=>new CommandRegistry([{id:'x',title:'1',enabled:true,run:()=>{}},{id:'x',title:'2',enabled:true,run:()=>{}}])).toThrow('重复命令')
  })
  it('复选、单选与非 Markdown 子菜单禁用状态',()=>{
    const groups=mainMenu({...state,wrap:true,markdown:false})
    expect(groups[3].items.find(node=>node.id==='wrap')).toMatchObject({type:'checkbox',checked:true})
    expect(groups[3].items.find(node=>node.id==='markdown-mode')).toMatchObject({enabled:false})
    expect(groups[2].items.find(node=>node.id==='headings')).toMatchObject({enabled:false})
    const modes=groups[3].items.find(node=>node.id==='markdown-mode')!
    expect(modes.type==='submenu'&&modes.children.filter(node=>node.type==='radio'&&node.checked).length).toBe(1)
  })
})
describe('快捷键迁移与平台匹配',()=>{
  it('旧默认可迁移，新增项无冲突',()=>{
    for(const version of [1,2]){
      const settings=settingsFrom({shortcuts:{...legacy(),replace:version===1?'Mod+H':'Mod+R'},shortcutVersion:version})
      expect(settings.shortcuts.sidebar).toBe('Mod+Alt+B');expect(settings.shortcuts.bold).toBe('Mod+B');expect(settings.shortcuts.replace).toBe('Mod+R');expect(validateShortcuts(settings.shortcuts)).toBeNull()
    }
  })
  it('歧义和显式自定义 Ctrl+B 不被覆盖，新增加粗选择空闲键',()=>{
    for(const raw of [{shortcuts:{...legacy(),find:'Mod+Alt+F'},shortcutVersion:1},{shortcuts:legacy(),shortcutVersion:2,customShortcuts:['sidebar']}]){
      const settings=settingsFrom(raw)
      expect(settings.shortcuts.sidebar).toBe('Mod+B');expect(settings.shortcuts.bold).not.toBe('Mod+B');expect(settings.customShortcuts).toContain('sidebar');expect(validateShortcuts(settings.shortcuts)).toBeNull()
    }
  })
  it('当前自定义保持原样，异常来源元数据安全忽略',()=>{
    const settings=defaultSettings();settings.shortcuts.replace='Mod+H';settings.customShortcuts=['replace']
    expect(settingsFrom(settings).shortcuts.replace).toBe('Mod+H')
    expect(()=>settingsFrom({...settings,customShortcuts:'bad'})).not.toThrow()
  })
  it('Windows Ctrl 与 macOS Command 不混淆，Option 数字使用物理键',()=>{
    const event={key:'b',code:'KeyB',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false} as KeyboardEvent
    expect(eventShortcut(event,'Win32')).toBe('Mod+B');expect(eventShortcut(event,'MacIntel')).toBe('Ctrl+B')
    expect(eventShortcut({...event,ctrlKey:false,metaKey:true} as KeyboardEvent,'MacIntel')).toBe('Mod+B')
    expect(eventShortcut({...event,ctrlKey:false,key:'¡',code:'Digit1',altKey:true} as KeyboardEvent,'MacIntel')).toBe('Alt+1')
    expect(shortcutLabel('Mod+Shift+P','MacIntel')).toBe('⌘ ⇧ P');expect(shortcutLabel('Mod+R','Win32')).toBe('Ctrl+R')
    expect(normalizeShortcut('Alt+1')).toBe('Alt+1');expect(normalizeShortcut('Alt+B')).toBeNull()
  })
})
describe('真实 Markdown 表格插入事务',()=>{
  it.each(['','前段\n\n后段','第一段\n第二段'])('插入合法 GFM 表格、保留源文、支持撤销和重做：%s',source=>{
    let s=EditorState.create({doc:source,selection:{anchor:source?1:0},extensions:[markdown({extensions:[GFM]}),history()]})
    s=s.update(markdownFormatTransaction(s,'table')).state
    const text=s.doc.toString()
    expect(syntaxTree(s).topNode.getChild('Table')).not.toBeNull()
    expect(text).toContain('| 列 1 | 列 2 |');expect(s.sliceDoc(s.selection.main.head,s.selection.main.head+3)).toBe('列 1')
    expect(undo({get state(){return s},dispatch:tr=>{s=tr.state}})).toBe(true);expect(s.doc.toString()).toBe(source)
    expect(redo({get state(){return s},dispatch:tr=>{s=tr.state}})).toBe(true);expect(s.doc.toString()).toBe(text)
  })
})
