<template>
  <aside
    class="sidebar-wrapper"
    :style="{ width: `${width}px` }"
  >
    <div class="explorer">
      <!-- 侧边栏头部 -->
      <div class="panelhead">
        <span class="panel-title">{{ panelTitle }}</span>
        <div v-if="activePanel === 'files'" class="headbtns" role="toolbar" aria-label="工作区工具栏">
          <button class="ib tree-tool" :disabled="!workspace.rootPath" :title="workspace.expanding ? '停止全部展开' : '全部展开'" :aria-label="workspace.expanding ? '停止全部展开' : '全部展开'" @click="expandAll"><Icon name="expand-all" size="small" /></button>
          <button class="ib tree-tool" :disabled="!workspace.rootPath" title="全部收起" aria-label="全部收起" @click="collapseAll"><Icon name="collapse-all" size="small" /></button>
          <button class="ib tree-tool" :disabled="!workspace.rootPath" title="新建" aria-label="新建" aria-haspopup="menu" @click="newMenu"><Icon name="plus" size="small" /></button>
          <button class="ib tree-tool" title="定位当前文件" aria-label="定位当前文件" @click="locateCurrentFile"><Icon name="locate" size="small" /></button>
          <button class="ib tree-tool" :disabled="!workspace.rootPath" title="刷新目录树" aria-label="刷新目录树" @click="workspace.refreshDirectory()"><Icon name="refresh" size="small" /></button>
        </div>
      </div>

      <!-- 侧边栏内容体 -->
      <div class="panel-body" :class="{ 'files-body': activePanel === 'files' }">
        <!-- 1. 资源管理器面板 -->
        <div v-if="activePanel === 'files'" class="treelist">
          <!-- 已打开真实工作区 -->
          <template v-if="workspace.rootPath">
            <div ref="treeContainer" class="workspace-tree-container" tabindex="0" aria-label="工作区目录树" @scroll="treeScrollTop = ($event.target as HTMLElement).scrollTop">
              <div :style="{ height: `${treeStart * rowHeight}px` }"></div>
              <template v-for="row in visibleTree" :key="row.node.path">
              <div v-if="row.root" class="treenode folder root-folder" :class="{ active: selectedPath && displayPathKey(selectedPath) === displayPathKey(row.root.rootPath) }" :title="`${row.root.name}\n${readablePath(row.root.rootPath)}`" @click="handleRootClick(row.root.rootPath)" @dblclick="handleRootDblClick(row.root.rootPath)" @contextmenu.prevent.stop="rootMenu($event,row.root)" @keydown.shift.f10.prevent.stop="rootMenu($event,row.root)">
                <div class="root-toggle"><span class="twisty" @click.stop="toggleRoot(row.root.rootPath)">{{ collapsedRoots.includes(row.root.rootPath) ? '▸' : '▾' }}</span><Icon name="folder" size="small" /><span class="label">{{ row.root.name }}</span></div>
                <div class="root-actions">
                <button class="ib small" :aria-label="`在 ${row.root.name} 中新建文件`" title="在此文件夹中新建文件" @click.stop="handleCreateFile(row.root.rootPath)">+</button>
                <button class="ib small" :aria-label="`在 ${row.root.name} 中新建文件夹`" title="在此文件夹中新建文件夹" @click.stop="handleCreateDir(row.root.rootPath)"><Icon name="open" size="small" /></button>
                <button class="ib small" :aria-label="`从工作区移除 ${row.root.name}`" title="从工作区移除（不删除文件）" @click.stop="workspace.removeFolder(row.root.rootPath)">×</button>
                </div>
              </div>
              <TreeNodeItem v-else
                :key="row.node.path"
                :node="row.node"
                :depth="row.depth"
                flat
                :active-path="activeDocPath"
                :selected-path="selectedPath"
                :tree-click-mode="treeClickMode"
                :dirty-paths="dirtyDocPaths"
                :desktop="desktop"
                @locate-node="handleLocateNode"
                @select-file="handleFileSelect"
                @open-file="handleFileOpen"
                @pin-file="workspace.openFile($event, false)"
                @toggle-folder="handleToggleFolder"
                @create-file="handleCreateFile"
                @rename-node="handleRenameNode"
                @delete-node="handleDeleteNode"
                @move-node="handleMoveNode"
                @copy-path="copyPath"
                @reveal-node="workspace.revealNode($event)"
              />
              </template>
              <div :style="{ height: `${Math.max(0, flatTree.length - treeStart - visibleTree.length) * rowHeight}px` }"></div>
            </div>
          </template>

          <!-- 未打开工作区：提供打开入口和最近历史 -->
          <template v-else>
            <div class="empty-workspace-box">
              <p class="empty-ws-tip">当前尚未打开任何工作区目录</p>
              <button class="open-folder-btn" :disabled="!desktop" @click="workspace.openWorkspaceDialog()">
                打开工作区文件夹…
              </button>
            </div>

          </template>

        </div>

        <!-- 2. 全文搜索面板 (Phase 4 真实实现) -->
        <div v-else-if="activePanel === 'search'" class="search-panel">
          <div class="search-input-wrapper">
            <div class="search-box">
              <input
                ref="searchInputRef"
                v-model="searchQueryText"
                type="text"
                placeholder="搜索整个工作区 (回车或输入检索)…"
                class="search-input"
                @input="triggerSearchDebounced"
                @keydown.enter="triggerSearchNow"
              />
              <button
                v-if="searchQueryText"
                class="clear-btn"
                title="清除"
                @click="clearSearch"
              >
                ✕
              </button>
            </div>

            <!-- 搜索修饰选项 -->
            <div class="search-options">
              <button
                class="opt-btn"
                :class="{ on: workspace.isCaseSensitive }"
                title="区分大小写"
                @click="workspace.isCaseSensitive = !workspace.isCaseSensitive; triggerSearchNow()"
              >
                Aa
              </button>
              <button
                class="opt-btn"
                :class="{ on: workspace.isWholeWord }"
                title="全词匹配"
                @click="workspace.isWholeWord = !workspace.isWholeWord; triggerSearchNow()"
              >
                \b
              </button>
              <button
                class="opt-btn"
                :class="{ on: workspace.isRegex }"
                title="正则表达式"
                @click="workspace.isRegex = !workspace.isRegex; triggerSearchNow()"
              >
                .*
              </button>

              <button
                v-if="workspace.searching"
                class="cancel-btn"
                title="取消当前搜索"
                @click="workspace.cancelSearch()"
              >
                取消
              </button>
            </div>
          </div>

          <!-- 搜索状态与结果数 -->
          <div class="search-status-bar">
            <span class="tip" title="搜索 UTF-8 与带 BOM 的 UTF-16 文本；跳过二进制及大于 10 MiB 的文件，最多 1000 处匹配，遍历限 10 秒/10 万条目。">ⓘ</span>
            <span v-if="workspace.searching" class="searching-spin">
              正在检索中…
            </span>
            <span v-else-if="workspace.searchQuery">
              找到 {{ workspace.searchTotal }} 处结果 ({{ workspace.searchResults.length }} 个文件)
            </span>
            <span v-else class="tip">
              {{ workspace.rootPath ? '输入关键词开始工作区全文检索' : '请先打开工作区' }}
            </span>
          </div>

          <!-- 搜索结果列表 -->
          <div class="search-results-list">
            <div
              v-for="group in workspace.searchResults"
              :key="group.path"
              class="search-file-group"
            >
              <div
                class="group-header"
                @click="group.isExpanded = !group.isExpanded"
              >
                <span class="twisty">{{ group.isExpanded ? '▾' : '▸' }}</span>
                <FileIcon :name="group.relativePath" />
                <span class="group-file-name">{{ group.relativePath }}</span>
                <span class="group-count">{{ group.matches.length }}</span>
              </div>

              <div v-if="group.isExpanded" class="group-matches">
                <div
                  v-for="(match, mIdx) in group.matches"
                  :key="`${match.path}-${match.line_number}-${mIdx}`"
                  class="match-row"
                  @click="workspace.locateMatch(match)"
                >
                  <span class="match-line-num">{{ match.line_number }}</span>
                  <span class="match-text">{{ match.line_text.trim() }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. 大纲面板 (Phase 6 真实 Lezer AST 接入) -->
        <div v-else-if="activePanel === 'outline'" class="outline-wrapper">
          <OutlineView
            :items="outlineItems"
            :is-markdown="isMarkdownDoc"
            @select-item="$emit('select-outline', $event)"
          />
        </div>
      </div>

    </div>

    <!-- 侧边栏调整拉条 -->
    <div
      class="resize-handle"
      role="separator"
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      tabindex="0"
      :aria-valuenow="width"
      :aria-valuemin="190"
      :aria-valuemax="420"
      @keydown.left.prevent="$emit('update:width', Math.max(190, width - 10))"
      @keydown.right.prevent="$emit('update:width', Math.min(420, width + 10))"
      @mousedown.prevent="startResize"
    ></div>
    <WorkspaceOperationDialog ref="operationDialog" />
    <ContextMenu ref="contextMenu" />
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick, watch } from 'vue'
import FileIcon from '../common/FileIcon.vue'
import Icon from '../common/Icon.vue'
import TreeNodeItem from './TreeNodeItem.vue'
import WorkspaceOperationDialog from '../modals/WorkspaceOperationDialog.vue'
import OutlineView from './OutlineView.vue'
import { extractOutline, type OutlineItem } from '../../editor/outline/outlineService'
import type { SidebarPanel, EditorDocument } from '../../types'
import type { WorkspaceController } from '../../features/workspace/WorkspaceController'
import type { WorkspaceNode, WorkspaceInfo } from '../../features/workspace/contracts'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { treeWindow } from '../../features/workspace/virtualTree'
import { readablePath, displayPathKey } from '../../features/shell/pathDisplay'
import ContextMenu from '../common/ContextMenu.vue'
import { CommandRegistry, menuCommand as cmd, separator } from '../../features/shell/menuModel'
import { textClipboard } from '../../features/shell/clipboard'

const props = withDefaults(defineProps<{
  width: number
  uiFontSize?: number
  activePanel: SidebarPanel
  activeDocId: string | null
  openDocs: EditorDocument[]
  recentFiles: { path: string; name: string }[]
  workspace: WorkspaceController
  desktop: boolean
  manager?: DocumentManager
  treeClickMode?: 'double' | 'single'
}>(), {
  treeClickMode: 'double',
})

const emit = defineEmits<{
  (e: 'update:width', w: number): void
  (e: 'toggle-side'): void
  (e: 'new-doc'): void
  (e: 'select-doc', id: string, preview?: boolean): void
  (e: 'open-recent', path: string): void
  (e: 'select-outline', item: OutlineItem): void
}>()

const activeDoc = computed(() => {
  return props.openDocs.find(d => d.id === props.activeDocId) || null
})

const isMarkdownDoc = computed(() => {
  return (!activeDoc.value?.kind || activeDoc.value.kind === 'text') && /\.(md|markdown)$/i.test(activeDoc.value?.name || '')
})

const outlineItems = computed<OutlineItem[]>(() => {
  if (!activeDoc.value || !props.manager) return []
  const state = props.manager.getState(activeDoc.value.id)
  return extractOutline(activeDoc.value, state)
})

const searchInputRef = ref<HTMLInputElement | null>(null)
const operationDialog = ref<InstanceType<typeof WorkspaceOperationDialog> | null>(null)
const contextMenu = ref<InstanceType<typeof ContextMenu> | null>(null)
async function copyPath(path: string) {
  try { await textClipboard.writeText(path) }
  catch (error) { window.dispatchEvent(new CustomEvent('editor-notice',{detail:`复制失败：${String(error)}`})) }
}
function rootMenu(event: MouseEvent | KeyboardEvent, root: WorkspaceInfo) {
  const registry = new CommandRegistry([
    {id:'root-new-file',title:'新建文件…',enabled:true,run:()=>handleCreateFile(root.rootPath)},
    {id:'root-new-folder',title:'新建文件夹…',enabled:true,run:()=>handleCreateDir(root.rootPath)},
    {id:'root-copy-path',title:'复制文件夹路径',enabled:true,run:()=>copyPath(root.rootPath)},
    {id:'root-reveal',title:'在文件管理器中显示',enabled:props.desktop,run:()=>props.workspace.revealNode(root.rootPath)},
    {id:'root-remove',title:'移除工作区根目录',enabled:true,run:()=>props.workspace.removeFolder(root.rootPath)},
    {id:'root-ignored',title:'显示忽略文件',enabled:props.desktop,run:()=>props.workspace.toggleIgnored()},
  ])
  contextMenu.value?.open(event,[cmd('root-new-file'),cmd('root-new-folder'),separator('root-path-section'),cmd('root-copy-path'),cmd('root-reveal'),{type:'checkbox',id:'root-ignored',commandId:'root-ignored',checked:props.workspace.showIgnored},separator('root-remove-section'),cmd('root-remove')],registry,'工作区根目录操作')
}
function newMenu(event:MouseEvent) {
  const parent=(activeDocPath.value&&props.workspace.rootForPath(activeDocPath.value))||props.workspace.rootPath
  if(!parent)return
  const registry=new CommandRegistry([
    {id:'new-file',title:'新建文件',enabled:true,run:()=>handleCreateFile(parent)},
    {id:'new-folder',title:'新建文件夹',enabled:true,run:()=>handleCreateDir(parent)},
  ])
  contextMenu.value?.open(event,[cmd('new-file'),cmd('new-folder')],registry,'新建',true)
}
function expandAll() {if(props.workspace.expanding){props.workspace.cancelExpand();return}collapsedRoots.value=[];void props.workspace.expandAll()}
function collapseAll() {props.workspace.collapseAll();collapsedRoots.value=props.workspace.roots.map(root=>root.rootPath)}
function notice(message:string){window.dispatchEvent(new CustomEvent('editor-notice',{detail:message}))}
async function locateCurrentFile() {
  const path=activeDocPath.value
  if(!path||!props.workspace.rootForPath(path)){notice('当前文件不在工作区内。');return}
  const found=await props.workspace.revealFileInTree(path,true)
  if(activeDocPath.value!==path)return
  if(!found){notice('无法定位当前文件：文件不存在、被忽略或目录无法读取。');return}
  const root=props.workspace.rootForPath(path)
  collapsedRoots.value=collapsedRoots.value.filter(item=>item!==root)
  selectedPath.value = path
  await nextTick();scrollActiveIntoView()
}
const selectedPath = ref<string | null>(null)
const treeScrollTop = ref(0)
const treeContainer = ref<HTMLElement | null>(null), treeHeight = ref(0)
let treeObserver: ResizeObserver | undefined
watch(treeContainer, element => {
  treeObserver?.disconnect()
  if (!element) return
  treeHeight.value = element.clientHeight
  treeObserver = new ResizeObserver(() => { treeHeight.value = element.clientHeight; treeScrollTop.value = element.scrollTop })
  treeObserver.observe(element)
}, { flush: 'post' })
const collapsedRoots = ref<string[]>([])
function toggleRoot(path: string) { props.workspace.cancelExpand();collapsedRoots.value = collapsedRoots.value.includes(path) ? collapsedRoots.value.filter(item => item !== path) : [...collapsedRoots.value, path] }
const flatTree = computed(() => {
  const rows: { node: WorkspaceNode; depth: number; root?: WorkspaceInfo }[] = []
  const visit = (nodes: WorkspaceNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth })
      if (node.isDirectory && node.isExpanded && node.children) visit(node.children, depth + 1)
    }
  }
  for (const root of props.workspace.roots) {
    rows.push({ root, depth: 0, node: { id: root.rootPath, name: root.name, path: root.rootPath, relativePath: '', isDirectory: true, isSymlink: false, isReadOnly: false, size: 0, mtime: null, hasChildren: true } })
    if (!collapsedRoots.value.includes(root.rootPath)) visit(root.entries, 1)
  }
  return rows
})
const rowHeight = computed(() => (props.uiFontSize ?? 14) + 14)
const virtualWindow = computed(() => treeWindow(flatTree.value.length, treeScrollTop.value, treeHeight.value, rowHeight.value))
const treeStart = computed(() => virtualWindow.value.start)
const visibleTree = computed(() => flatTree.value.slice(treeStart.value, treeStart.value + virtualWindow.value.count))
watch(() => props.workspace.openRevision, () => {
  treeScrollTop.value = 0
  searchQueryText.value = ''
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})
const searchQueryText = ref(props.workspace.searchQuery)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const panelTitle = computed(() => {
  switch (props.activePanel) {
    case 'files': return '工作区'
    case 'search': return '全文搜索'
    case 'outline': return '文档大纲'
  }
})

const activeDocPath = computed(() => {
  return props.openDocs.find(d => d.id === props.activeDocId)?.path
})
function scrollActiveIntoView() {
  const targetPath = selectedPath.value || activeDocPath.value
  const element = treeContainer.value, index = flatTree.value.findIndex(row => targetPath && displayPathKey(row.node.path) === displayPathKey(targetPath))
  if (!element || index < 0) return
  const top = index * rowHeight.value, bottom = top + rowHeight.value
  if (top < element.scrollTop) element.scrollTop = top
  else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight
  treeScrollTop.value = element.scrollTop
}
watch([activeDocPath, () => props.workspace.openRevision], async ([path]) => {
  if (!path || props.activePanel !== 'files') return
  selectedPath.value = path
  const root = props.workspace.rootForPath(path)
  collapsedRoots.value = collapsedRoots.value.filter(item => item !== root)
  await props.workspace.revealFileInTree(path)
  if (activeDocPath.value !== path) return
  await nextTick(); scrollActiveIntoView()
}, { immediate:true })
watch(flatTree, async () => { await nextTick(); if (treeContainer.value) treeScrollTop.value = treeContainer.value.scrollTop })
watch(() => props.activePanel, async panel => { if (panel === 'files') { await nextTick(); scrollActiveIntoView() } })

const dirtyDocPaths = computed(() => {
  return props.openDocs.filter(d => d.dirty).map(d => d.path)
})

function handleLocateNode(node: WorkspaceNode) {
  selectedPath.value = node.path
}

function handleFileSelect(node: WorkspaceNode) {
  selectedPath.value = node.path
  void props.workspace.openFile(node)
}

function handleFileOpen(node: WorkspaceNode) {
  selectedPath.value = node.path
  void props.workspace.openFile(node, false)
}

function handleToggleFolder(node: WorkspaceNode) {
  selectedPath.value = node.path
  void props.workspace.toggleFolder(node)
}

let lastRootClickTime = 0
function handleRootClick(rootPath: string) {
  selectedPath.value = rootPath
  if (props.treeClickMode === 'single') {
    const now = Date.now()
    if (now - lastRootClickTime > 250) {
      lastRootClickTime = now
      toggleRoot(rootPath)
    }
  }
}

function handleRootDblClick(rootPath: string) {
  selectedPath.value = rootPath
  if (props.treeClickMode === 'double') {
    toggleRoot(rootPath)
  }
}

async function handleCreateFile(parentDir: string) {
  const name = await operationDialog.value?.ask({ title: '新建文件', description: '', confirmLabel: '创建', initialValue: '' })
  if (name && name.trim()) {
    void props.workspace.createFile(parentDir, name.trim())
  }
}

async function handleCreateDir(parentDir: string) {
  const name = await operationDialog.value?.ask({ title: '新建文件夹', description: '', confirmLabel: '创建', initialValue: '' })
  if (name && name.trim()) {
    void props.workspace.createDirectory(parentDir, name.trim())
  }
}

async function handleDeleteNode(node: WorkspaceNode) {
  const result = await operationDialog.value?.ask({ title: '删除条目', description: `确定删除 ${node.isDirectory ? '目录及其全部内容' : '文件'} "${node.name}"？此操作无法撤销。`, confirmLabel: '删除' })
  if (result !== null && result !== undefined) {
    void props.workspace.deleteNode(node)
  }
}

async function handleMoveNode(node: WorkspaceNode) {
  const destination = await operationDialog.value?.ask({ title: '移动条目', description: `将 "${node.name}" 移动到工作区内目录（绝对路径）：`, confirmLabel: '移动', initialValue: props.workspace.rootPath || '' })
  if (destination?.trim()) {
    void props.workspace.moveNode(node, destination.trim())
  }
}

async function handleRenameNode(node: WorkspaceNode) {
  const name = await operationDialog.value?.ask({ title: '重命名条目', description: node.path, confirmLabel: '重命名', initialValue: node.name })
  if (name?.trim()) void props.workspace.renameNode(node, name.trim())
}

function triggerSearchDebounced() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    void props.workspace.search(searchQueryText.value)
  }, 250)
}

function triggerSearchNow() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  void props.workspace.search(searchQueryText.value)
}

function clearSearch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchQueryText.value = ''
  props.workspace.cancelSearch()
  void props.workspace.search('')
}

function focusSearchInput() {
  nextTick(() => {
    searchInputRef.value?.focus()
  })
}

defineExpose({ focusSearchInput })
watch(() => props.activePanel, panel => { if (panel === 'search') focusSearchInput() }, { immediate: true })

// --- 拖拽调宽 ---
let resizing = false
let startX = 0
let startW = 0

function startResize(e: MouseEvent) {
  resizing = true
  startX = e.clientX
  startW = props.width
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!resizing) return
  const w = Math.max(190, Math.min(420, startW + (e.clientX - startX)))
  emit('update:width', w)
}

function onMouseUp() {
  if (!resizing) return
  resizing = false
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

onUnmounted(() => {
  treeObserver?.disconnect()
  if (resizing) document.body.style.cursor = ''
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})
</script>

<style scoped>
.root-toggle { display:flex;align-items:center;gap:5px;flex:1;min-width:0;text-align:left;height:var(--ui-tree-row-height);color:var(--sub) }
.root-actions { display:none;position:absolute;right:4px;top:1px;align-items:center;background:var(--sidebar) }
.root-folder { position:relative }
.root-folder:hover .root-actions,.root-folder:focus-within .root-actions { display:flex;background:var(--hover) }
.root-folder:hover .root-toggle,.root-folder:focus-within .root-toggle { padding-right:76px }
.root-toggle .label { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
.sidebar-wrapper {
  min-height:0;
  flex: none;
  display: flex;
  position: relative;
  height: 100%;
}

.explorer {
  min-height:0;
  flex: 1;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.panelhead {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  border-bottom: 1px solid var(--line);
  flex: none;
}

.panel-title {
  font-size: var(--ui-font-size);
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.8px;
}

.headbtns {
  display: flex;
  gap: 1px;
  flex:none;
}

.tree-tool { width:var(--ui-row-height);height:var(--ui-row-height) }
.tree-tool:disabled { opacity:.4;cursor:default }
.panel-title { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
.ib.small {
  width: var(--ui-row-height);
  height: var(--ui-row-height);
}

.panel-body {
  flex: 1;
  min-height:0;
  overflow-y: auto;
  padding: 6px 0;
}
.panel-body.files-body { overflow:hidden;display:flex;flex-direction:column;padding:0 }
.files-body .treelist { flex:1;min-height:0;display:flex;flex-direction:column }
.workspace-tree-container { flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain }

.treelist {
  font-size: var(--ui-font-size);
}

.treenode {
  height: var(--ui-tree-row-height);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  cursor: pointer;
  color: var(--ink);
  transition: background 0.1s;
}

.treenode:hover {
  background: var(--hover);
}

.treenode.active {
  background: var(--soft);
  color: var(--bright);
  font-weight: 500;
}

.root-folder {
  color: var(--muted);
  font-weight: 600;
  padding-left: 10px;
}

.twisty {
  flex: none;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  border-radius: 3px;
  user-select: none;
  transition: color 0.1s, background-color 0.1s;
}

.root-folder .twisty {
  cursor: pointer;
}

.root-folder .twisty:hover {
  color: var(--bright);
  background: var(--hover);
}

.label {
  min-width:0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-dot {
  font-size: var(--ui-small-font-size);
  color: var(--yellow);
}

.empty-workspace-box {
  padding: 16px 12px;
  text-align: center;
}

.empty-ws-tip {
  font-size: var(--ui-small-font-size);
  color: var(--muted);
  margin-bottom: 10px;
}

.open-folder-btn {
  background: var(--soft);
  border: 1px solid var(--line);
  color: var(--bright);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: var(--ui-font-size);
  cursor: pointer;
}

.open-folder-btn:hover {
  background: var(--hover);
  border-color: var(--accent);
}

.tree-divider {
  border-top: 1px solid var(--line);
  margin: 12px 10px 8px;
}

.sub-header {
  font-size: var(--ui-small-font-size);
  font-weight: 700;
  color: var(--muted);
  padding: 0 12px 6px;
  letter-spacing: 0.8px;
}

.resize-handle {
  width: 4px;
  cursor: col-resize;
  position: absolute;
  top: 0;
  right: -2px;
  bottom: 0;
  z-index: 10;
}

.resize-handle:hover {
  background: var(--accent);
}

/* 搜索面板样式 */
.search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.search-input-wrapper {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--line);
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input {
  width: 100%;
  background: var(--editor);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 24px 6px 8px;
  font-size: var(--ui-font-size);
  color: var(--bright);
  outline: none;
}

.search-input:focus {
  border-color: var(--accent);
}

.clear-btn {
  position: absolute;
  right: 6px;
  color: var(--muted);
  font-size: var(--ui-small-font-size);
  cursor: pointer;
}

.search-options {
  display: flex;
  align-items: center;
  gap: 4px;
}

.opt-btn {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: var(--ui-small-font-size);
  font-family: var(--font-mono);
  background: var(--soft);
  color: var(--muted);
  border: 1px solid transparent;
}

.opt-btn.on {
  background: var(--accentbg);
  color: var(--accent);
  border-color: var(--accent);
}

.cancel-btn {
  margin-left: auto;
  font-size: var(--ui-small-font-size);
  color: var(--yellow);
  padding: 2px 6px;
}

.search-status-bar {
  padding: 6px 12px;
  font-size: var(--ui-small-font-size);
  color: var(--muted);
}

.search-results-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.search-file-group {
  margin-bottom: 6px;
}

.group-header {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  cursor: pointer;
  background: var(--bar);
  font-size: var(--ui-small-font-size);
  color: var(--ink);
  font-weight: 600;
}

.group-header:hover {
  background: var(--hover);
}

.group-file-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-count {
  font-size: var(--ui-small-font-size);
  background: var(--soft);
  padding: 1px 5px;
  border-radius: 10px;
  color: var(--muted);
}

.group-matches {
  display: flex;
  flex-direction: column;
}

.match-row {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 24px;
  cursor: pointer;
  font-size: var(--ui-small-font-size);
  font-family: var(--font-mono);
  color: var(--muted);
}

.match-row:hover {
  background: var(--hover);
  color: var(--bright);
}

.match-line-num {
  color: var(--accent);
  font-weight: 500;
  width: 24px;
  text-align: right;
  flex: none;
}

.match-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
