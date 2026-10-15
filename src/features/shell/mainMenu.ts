import { menuCommand as cmd, separator as sep, recentFileCommand, recentWorkspaceCommand, type MenuNode, type MenuGroup } from './menuModel'
import { readablePath } from './pathDisplay'
import type { MarkdownMode } from '../../types'
export interface MainMenuState {
  sidebar: boolean; outline: boolean; wrap: boolean; split: boolean; focus: boolean
  markdown: boolean; markdownMode?: MarkdownMode; composing: boolean
  recentFiles: { path:string; name:string }[]; recentWorkspaces: string[]
}
export function mainMenu(state: MainMenuState): MenuGroup[] {
  const submenu = (id: string, label: string, children: MenuNode[], enabled = true): MenuNode => ({type:'submenu',id,label,children,enabled})
  const checkbox = (id: string, label: string, checked: boolean): MenuNode => ({type:'checkbox',id,commandId:id,label,checked})
  const format = (id: string, label?: string) => cmd(id === 'bold' || id === 'italic' ? id : `format-${id}`,label)
  return [
    {id:'file',title:'文件',items:[cmd('new','新建文件'),cmd('new-markdown','新建 Markdown'),cmd('open','打开文件…'),
      submenu('recent-files','最近打开',state.recentFiles.map(file => cmd(recentFileCommand(file.path), file.name + (state.recentFiles.filter(other => other.name === file.name).length > 1 ? ` — ${readablePath(file.path).split(/[\\/]/).slice(-2,-1)[0]}` : '')))),
      submenu('workspace-menu','工作区',[cmd('open-workspace','打开文件夹…'),cmd('add-workspace','添加文件夹…'),
        submenu('recent-workspaces','最近工作区',state.recentWorkspaces.map(path => cmd(recentWorkspaceCommand(path),readablePath(path).split(/[\\/]/).pop()))),
        sep('workspace-search-section'),cmd('workspace-search'),cmd('refresh-workspace')]),
      sep('save-section'),cmd('save','保存'),cmd('save-as','另存为…'),sep('close-section'),cmd('close-current','关闭文件'),cmd('quit','退出')]},
    {id:'edit',title:'编辑',items:[cmd('undo'),cmd('redo'),sep('clipboard-section'),cmd('cut'),cmd('copy'),cmd('paste'),cmd('select-all'),
      sep('search-section'),cmd('find','查找'),cmd('replace','替换'),cmd('goto-line','跳转行…')]},
    {id:'format',title:'格式',items:[format('bold'),format('italic'),format('strike'),format('inline-code'),sep('structure-section'),
      submenu('headings','标题',Array.from({length:6},(_,i) => format(`heading-${i+1}`,`H${i+1} · ${['一级','二级','三级','四级','五级','六级'][i]}标题`)),state.markdown && !state.composing),
      submenu('lists','列表',[format('bullet'),format('ordered'),format('task')],state.markdown && !state.composing),
      submenu('blocks','块级元素',[format('quote'),format('code-block'),format('rule')],state.markdown && !state.composing),
      sep('insert-section'),format('link','插入链接'),format('image','插入图片'),format('table','插入表格')]},
    {id:'view',title:'视图',items:[checkbox('sidebar','显示侧边栏',state.sidebar),checkbox('outline','显示文档大纲',state.outline),checkbox('wrap','自动换行',state.wrap),
      sep('mode-section'),submenu('markdown-mode','Markdown 编辑模式',(['live','source','split'] as const).map(mode => ({type:'radio',id:`mode-${mode}`,commandId:`md-${mode}`,group:'markdown-mode',checked:state.markdownMode === mode,label:{live:'实时排版',source:'源码编辑',split:'双栏预览'}[mode]})),state.markdown),
      submenu('editor-layout','编辑器布局',[
        cmd('split-right','向右拆分'),
        cmd('split-down','向下拆分'),
        cmd('maximize-pane','最大化当前编辑器'),
        cmd('restore-pane','恢复编辑器布局'),
        cmd('merge-panes','合并所有分栏'),
      ]),
      checkbox('focus','专注模式',state.focus)]},
  ]
}
