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
            <div ref="treeContainer" class="workspace-tree-container" role="tree" :tabindex="flatTree.length ? -1 : 0" aria-label="工作区目录树" @scroll="onTreeScroll" @wheel.passive="treeInteraction" @pointerdown="treeInteraction" @keydown="handleTreeKeydown">
              <div role="presentation" :style="{ height: `${treeStart * rowHeight}px` }"></div>
              <template v-for="row in visibleTree" :key="row.node.path">
              <div v-if="row.root" class="treenode folder root-folder" role="treeitem" :data-tree-path="row.root.rootPath" :aria-level="1" :aria-expanded="!collapsedRoots.includes(row.root.rootPath)" :aria-selected="isTreeSelected(row.root.rootPath)" :tabindex="isTabStop(row.root.rootPath) ? 0 : -1" :class="{ selected: isTreeSelected(row.root.rootPath) }" :title="`${row.root.name}\n${readablePath(row.root.rootPath)}`" @focus.self="selectTreePath(row.root.rootPath)" @click="handleRootClick($event,row.root.rootPath)" @dblclick="handleRootDblClick(row.root.rootPath)" @contextmenu.prevent.stop="rootMenu($event,row.root)" @keydown.shift.f10.prevent.stop="rootMenu($event,row.root)">
                <div class="root-toggle"><span class="twisty" @click.stop="handleRootTwisty($event,row.root.rootPath)" @dblclick.stop>{{ collapsedRoots.includes(row.root.rootPath) ? '▸' : '▾' }}</span><Icon name="folder" size="small" /><span class="label">{{ row.root.name }}</span></div>
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
                :compact-chain="row.compactChain"
                flat
                :active-file-path="activeFilePath"
                :selected-tree-path="selectedTreePath"
                :tab-stop="isTabStop(row.node.path)"
                :highlighted="highlightedPath === row.node.path"
                :tree-click-mode="treeClickMode"
                :dirty-paths="dirtyDocPaths"
                :desktop="desktop"
                @locate-node="handleLocateNode"
                @select-file="handleFileSelect"
                @open-file="handleFileOpen"
                @pin-file="handleFileOpen"
                @toggle-folder="handleToggleFolder"
                @toggle-compact="handleToggleCompact"
                @create-file="handleCreateFile"
                @rename-node="handleRenameNode"
                @delete-node="handleDeleteNode"
                @move-node="handleMoveNode"
                @copy-path="copyPath"
                @reveal-node="workspace.revealNode($event)"
              />
              </template>
              <div role="presentation" :style="{ height: `${Math.max(0, flatTree.length - treeStart - visibleTree.length) * rowHeight}px` }"></div>
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
                :disabled="workspace.replaceApplying"
                type="text"
                placeholder="搜索整个工作区 (回车或输入检索)…"
                class="search-input"
                @input="triggerSearchDebounced"
                @keydown.enter="triggerSearchNow"
              />
              <button
                v-if="searchQueryText"
                :disabled="workspace.replaceApplying"
                class="clear-btn"
                title="清除"
                @click="clearSearch"
              >
                ✕
              </button>
            </div>

            <button class="replace-toggle" :disabled="workspace.replaceApplying" :aria-expanded="workspace.replaceExpanded" @click="workspace.replaceExpanded = !workspace.replaceExpanded">
              {{ workspace.replaceExpanded ? '▾' : '▸' }} 替换 (Ctrl+Shift+R)
            </button>
            <div v-if="workspace.replaceExpanded" class="replace-controls">
              <input ref="replaceInputRef" v-model="workspace.replacementText" :disabled="workspace.replaceApplying" class="search-input" aria-label="替换为" placeholder="替换为（留空则删除）" @input="workspace.invalidateReplace()" />
              <span v-if="workspace.isRegex" class="tip">捕获组：$1、${name}；$$ 表示 $。按行匹配。</span>
              <button :disabled="workspace.replaceBusy || workspace.searching || !workspace.searchQuery || searchQueryText !== workspace.searchQuery" @click="workspace.previewReplace()">预览全部替换</button>
            </div>
            <input v-model="workspace.searchDirectory" :disabled="workspace.replaceApplying" class="search-input search-directory" aria-label="搜索目录范围" placeholder="搜索目录（绝对路径，留空为全部工作区）" @input="triggerSearchDebounced" @keydown.enter="triggerSearchNow" />

            <!-- 搜索修饰选项 -->
            <div class="search-options" :class="{ 'replace-locked': workspace.replaceApplying }">
              <button
                class="opt-btn"
                :class="{ on: workspace.isCaseSensitive }"
                :disabled="workspace.replaceApplying"
                title="区分大小写"
                @click="workspace.isCaseSensitive = !workspace.isCaseSensitive; triggerSearchNow()"
              >
                Aa
              </button>
              <button
                class="opt-btn"
                :class="{ on: workspace.isWholeWord }"
                :disabled="workspace.replaceApplying"
                title="全词匹配"
                @click="workspace.isWholeWord = !workspace.isWholeWord; triggerSearchNow()"
              >
                \b
              </button>
              <button
                class="opt-btn"
                :class="{ on: workspace.isRegex }"
                :disabled="workspace.replaceApplying"
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

          <div v-if="workspace.replaceExpanded && (workspace.replaceMessage || workspace.replaceFiles.length)" class="replace-preview" aria-label="替换预览">
            <p role="status">{{ workspace.replaceMessage }}</p>
            <div class="replace-actions">
              <button :disabled="workspace.replaceBusy" @click="workspace.selectReplacements(true)">全选</button>
              <button :disabled="workspace.replaceBusy" @click="workspace.selectReplacements(false)">取消全选</button>
              <button :disabled="workspace.replaceBusy || !workspace.replaceFiles.some(file => file.selected.size && !file.status)" @click="workspace.applyReplacements()">应用已选择的替换</button>
              <button v-if="workspace.replaceBusy" @click="workspace.cancelReplace()">取消未执行部分</button>
            </div>
            <p v-if="workspace.replaceApplying">进度：{{ workspace.replaceProgress }} / {{ workspace.replaceFiles.filter(file => file.selected.size).length }} 文件</p>
            <p class="tip">打开文件修改缓冲区，可 Undo/Redo，需保存；关闭文件逐个保存，无跨文件全局撤销。</p>
            <div class="replace-preview-files">
              <div v-for="file in workspace.replaceFiles" :key="file.path" class="replace-preview-file">
                <div class="replace-file-header">
                  <button :aria-expanded="file.expanded" @click="file.expanded = !file.expanded">{{ file.expanded ? '▾' : '▸' }}</button>
                  <input type="checkbox" :aria-label="`选择文件 ${file.path}`" :disabled="workspace.replaceBusy || !!file.status" :checked="file.selected.size === file.edits.length" :indeterminate="file.selected.size > 0 && file.selected.size < file.edits.length" @change="workspace.selectReplacements(($event.target as HTMLInputElement).checked, file.path)" />
                  <span :title="readablePath(file.path)">{{ readablePath(file.path).split(/[\\/]/).pop() }} · {{ file.edits.length }} 处</span>
                </div>
                <p v-if="file.status" role="status">{{ file.status }}</p>
                <div v-if="file.expanded">
                  <label v-for="(edit, index) in file.edits" :key="index" class="replace-match">
                    <input type="checkbox" :disabled="workspace.replaceBusy || !!file.status" :checked="file.selected.has(index)" :aria-label="`选择 ${edit.line}:${edit.column}`" @change="workspace.toggleReplacement(file, index)" />
                    <span class="replace-diff"><small>{{ edit.line }}:{{ edit.column }} · {{ edit.context }}</small><del>− {{ edit.before.slice(0, 500) || '∅（零宽）' }}{{ edit.before.length > 500 ? '…（显示前 500 字符）' : '' }}</del><ins>+ {{ edit.insert.slice(0, 500) || '∅（删除）' }}{{ edit.insert.length > 500 ? '…（显示前 500 字符）' : '' }}</ins></span>
                  </label>
                </div>
              </div>
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
                <button v-if="workspace.replaceExpanded" :disabled="workspace.replaceBusy || workspace.searching || searchQueryText !== workspace.searchQuery" title="预览此文件全部替换" @click.stop="workspace.previewReplace(group.path)">替换</button>
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
                  <button v-if="workspace.replaceExpanded" :disabled="workspace.replaceBusy || workspace.searching || searchQueryText !== workspace.searchQuery" title="预览替换此匹配" @click.stop="workspace.previewReplace(group.path, match)">替换</button>
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
            :manager="manager"
            :document-id="activeDocId"
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
import { treeWindow, buildFlatTree, type TreeRow } from '../../features/workspace/virtualTree'
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
  autoFollowActiveFile?: boolean
  smartExpand?: boolean
  compactFolders?: boolean
}>(), {
  treeClickMode: 'single',
  autoFollowActiveFile: false,
  smartExpand: true,
  compactFolders: false,
})

watch(() => props.smartExpand, v => { props.workspace.smartExpand = v ?? true }, { immediate: true })
watch(() => props.compactFolders, v => { props.workspace.compactFolders = v ?? false }, { immediate: true })

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
const replaceInputRef = ref<HTMLInputElement | null>(null)
const operationDialog = ref<InstanceType<typeof WorkspaceOperationDialog> | null>(null)
const contextMenu = ref<InstanceType<typeof ContextMenu> | null>(null)
async function copyPath(path: string) {
  try { await textClipboard.writeText(path) }
  catch (error) { window.dispatchEvent(new CustomEvent('editor-notice',{detail:`复制失败：${String(error)}`})) }
}
function rootMenu(event: MouseEvent | KeyboardEvent, root: WorkspaceInfo) {
  selectTreePath(root.rootPath)
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
  const parent=(activeFilePath.value&&props.workspace.rootForPath(activeFilePath.value))||props.workspace.rootPath
  if(!parent)return
  const registry=new CommandRegistry([
    {id:'new-file',title:'新建文件',enabled:true,run:()=>handleCreateFile(parent)},
    {id:'new-folder',title:'新建文件夹',enabled:true,run:()=>handleCreateDir(parent)},
  ])
  contextMenu.value?.open(event,[cmd('new-file'),cmd('new-folder')],registry,'新建',true)
}
function expandAll() {treeInteraction();if(props.workspace.expanding){props.workspace.cancelExpand();return}collapsedRoots.value=[];void props.workspace.expandAll()}
function collapseAll() {treeInteraction();props.workspace.collapseAll();collapsedRoots.value=props.workspace.roots.map(root=>root.rootPath)}
function notice(message:string){window.dispatchEvent(new CustomEvent('editor-notice',{detail:message}))}
async function locateCurrentFile() {
  const path=activeFilePath.value
  if(!path||!props.workspace.rootForPath(path)){notice('当前文件不在工作区内。');return}
  await revealPath(path, true)
}
const selectedTreePath = computed({get: () => props.workspace.selectedTreePath, set: path => props.workspace.selectTreePath(path)})
const highlightedPath = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined
let locationSequence = 0, userTreeUntil = 0, expectedScrollTop: number | null = null
function cancelLocation() { locationSequence++; props.workspace.cancelReveal() }
function treeInteraction() { cancelLocation(); userTreeUntil = performance.now() + 800 }
function selectTreePath(path: string) { treeInteraction(); selectedTreePath.value = path }
function isTreeSelected(path: string) { return !!selectedTreePath.value && displayPathKey(selectedTreePath.value) === displayPathKey(path) }
function isRowSelected(row: TreeRow) {
  if (!selectedTreePath.value) return false
  const target = displayPathKey(selectedTreePath.value)
  if (displayPathKey(row.node.path) === target) return true
  if (row.compactChain?.some(n => displayPathKey(n.path) === target)) return true
  return false
}
const treeTabStopPath = computed(() => (visibleTree.value.find(row => isRowSelected(row)) || visibleTree.value[0])?.node.path)
function isTabStop(path: string) {
  return displayPathKey(treeTabStopPath.value || '') === displayPathKey(path)
}
function onTreeScroll(event: Event) {
  const top = (event.target as HTMLElement).scrollTop
  if (expectedScrollTop === null || Math.abs(top - expectedScrollTop) > 1) treeInteraction()
  expectedScrollTop = null
  treeScrollTop.value = top
}
function scrollPathIntoView(path: string, center = false) {
  const element = treeContainer.value, target = displayPathKey(path)
  const index = flatTree.value.findIndex(row => {
    if (displayPathKey(row.node.path) === target) return true
    if (row.compactChain?.some(n => displayPathKey(n.path) === target)) return true
    return false
  })
  if (!element || index < 0) return
  const top = index * rowHeight.value, bottom = top + rowHeight.value
  if (top >= element.scrollTop && bottom <= element.scrollTop + element.clientHeight) return
  const next = center ? top - (element.clientHeight - rowHeight.value) / 2 : top < element.scrollTop ? top : bottom - element.clientHeight
  element.scrollTop = Math.max(0, next)
  expectedScrollTop = element.scrollTop
  treeScrollTop.value = element.scrollTop
}
async function revealPath(path: string, explicit: boolean) {
  cancelLocation()
  if (!explicit && (performance.now() < userTreeUntil || treeContainer.value?.contains(document.activeElement))) return
  const sequence = locationSequence
  const found = await props.workspace.revealFileInTree(path)
  if (sequence !== locationSequence || activeFilePath.value !== path) return
  if (!found) { if (explicit) notice('无法定位当前文件：文件不存在、被忽略或目录无法读取。'); return }
  const root = props.workspace.rootForPath(path)
  collapsedRoots.value = collapsedRoots.value.filter(item => item !== root)
  if (explicit) selectedTreePath.value = path
  await nextTick()
  if (sequence !== locationSequence) return
  scrollPathIntoView(path, explicit)
  if (explicit) {
    clearTimeout(highlightTimer); highlightedPath.value = null
    await nextTick()
    if (sequence !== locationSequence) return
    highlightedPath.value = path
    highlightTimer = setTimeout(() => { highlightedPath.value = null }, 1200)
  }
}
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
function toggleRoot(path: string) { treeInteraction();props.workspace.cancelExpand();selectedTreePath.value=path;collapsedRoots.value = collapsedRoots.value.includes(path) ? collapsedRoots.value.filter(item => item !== path) : [...collapsedRoots.value, path] }
const flatTree = computed(() => {
  return buildFlatTree(props.workspace.roots, collapsedRoots.value, props.compactFolders ?? false)
})
const rowHeight = ref((props.uiFontSize ?? 14) + 14)
async function measureTreeRows() {
  await nextTick()
  const height = treeContainer.value?.querySelector<HTMLElement>('.treenode')?.getBoundingClientRect().height
  if (height) rowHeight.value = height
}
watch(() => props.uiFontSize, measureTreeRows, {flush:'post'})
watch(treeContainer, measureTreeRows, {flush:'post'})
const virtualWindow = computed(() => treeWindow(flatTree.value.length, treeScrollTop.value, treeHeight.value, rowHeight.value))
const treeStart = computed(() => virtualWindow.value.start)
const visibleTree = computed(() => flatTree.value.slice(treeStart.value, treeStart.value + virtualWindow.value.count))
watch(() => props.workspace.openRevision, () => {
  cancelLocation(); highlightedPath.value = null
  collapsedRoots.value = collapsedRoots.value.filter(path => props.workspace.roots.some(root => root.rootPath === path))
  treeScrollTop.value = 0
  if (treeContainer.value) { treeContainer.value.scrollTop = 0; expectedScrollTop = 0 }
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

const activeFilePath = computed(() => {
  return props.openDocs.find(d => d.id === props.activeDocId)?.path
})
watch([activeFilePath, () => props.autoFollowActiveFile], ([path]) => {
  cancelLocation()
  if (path && props.autoFollowActiveFile && props.activePanel === 'files') void revealPath(path, false)
})
watch(flatTree, async () => { await nextTick(); if (treeContainer.value) treeScrollTop.value = treeContainer.value.scrollTop })
watch(() => props.activePanel, async panel => {
  cancelLocation()
  if (panel === 'files') {
    await nextTick()
    if (treeContainer.value) { treeContainer.value.scrollTop = treeScrollTop.value; expectedScrollTop = treeContainer.value.scrollTop }
  }
})

async function focusTreeRow(index: number) {
  const row = flatTree.value[index]
  if (!row) return
  selectedTreePath.value = row.node.path
  scrollPathIntoView(row.node.path)
  await nextTick()
  const target = Array.from(treeContainer.value?.querySelectorAll<HTMLElement>('[data-tree-path], [data-segment-path]') || [])
    .find(element => {
      const p = element.dataset.treePath || element.dataset.segmentPath
      return p && (displayPathKey(p) === displayPathKey(row.node.path) || (row.compactChain && row.compactChain.some(n => displayPathKey(n.path) === displayPathKey(p))))
    })
  target?.focus({preventScroll:true})
}
async function handleTreeKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('button,[role=menu]') || event.altKey || event.ctrlKey || event.metaKey) return
  if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)) return
  event.preventDefault(); event.stopPropagation(); treeInteraction()
  const element = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-path], [data-segment-path]')
  const path = element?.dataset.segmentPath || element?.dataset.treePath || selectedTreePath.value || ''
  const target = displayPathKey(path)
  const index = flatTree.value.findIndex(row => {
    if (displayPathKey(row.node.path) === target) return true
    if (row.compactChain?.some(n => displayPathKey(n.path) === target)) return true
    return false
  })
  const row = flatTree.value[index]
  if (!row) { await focusTreeRow(0); return }
  selectedTreePath.value = row.node.path
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? flatTree.value.length - 1 : Math.max(0, Math.min(flatTree.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    await focusTreeRow(next); return
  }
  const isCompact = !!(row.compactChain && row.compactChain.length > 1)
  const expanded = row.root ? !collapsedRoots.value.includes(row.root.rootPath) : (isCompact ? row.compactChain!.some(n => n.isExpanded) : !!row.node.isExpanded)
  const toggle = async () => {
    if (row.root) toggleRoot(row.root.rootPath)
    else if (isCompact) handleToggleCompact(row.compactChain!)
    else await props.workspace.toggleFolder(row.node)
  }
  if (event.key === 'ArrowRight') {
    if (row.node.isDirectory && !expanded) await toggle()
    else if (row.node.isDirectory && flatTree.value[index + 1]?.depth > row.depth) await focusTreeRow(index + 1)
  } else if (event.key === 'ArrowLeft') {
    if (row.node.isDirectory && expanded) await toggle()
    else { for (let parent = index - 1; parent >= 0; parent--) if (flatTree.value[parent].depth < row.depth) { await focusTreeRow(parent); break } }
  } else if (event.key === 'Enter') {
    if (row.node.isDirectory) await toggle()
    else await props.workspace.openFile(row.node, false)
  } else if (!row.node.isDirectory) {
    // Space previews a file; for folders it only selects, without toggling.
    await props.workspace.openFile(row.node)
  }
}

const dirtyDocPaths = computed(() => {
  return props.openDocs.filter(d => d.dirty).map(d => d.path)
})

function handleLocateNode(node: WorkspaceNode) {
  selectTreePath(node.path)
}

function handleFileSelect(node: WorkspaceNode) {
  selectTreePath(node.path)
  void props.workspace.openFile(node)
}

function handleFileOpen(node: WorkspaceNode) {
  selectTreePath(node.path)
  void props.workspace.openFile(node, false)
}

function handleToggleFolder(node: WorkspaceNode) {
  selectTreePath(node.path)
  void props.workspace.toggleFolder(node)
}

function handleToggleCompact(chain: WorkspaceNode[]) {
  treeInteraction()
  const isExpanded = chain.some(item => item.isExpanded)
  if (isExpanded) {
    props.workspace.collapseCompactChain(chain)
  } else {
    void props.workspace.expandCompactChain(chain)
  }
}

function handleRootClick(event: MouseEvent, rootPath: string) {
  selectTreePath(rootPath)
  if (props.treeClickMode === 'single' && event.detail <= 1) toggleRoot(rootPath)
}
function handleRootTwisty(event: MouseEvent, rootPath: string) {
  selectTreePath(rootPath)
  if (event.detail <= 1) toggleRoot(rootPath)
}

function handleRootDblClick(rootPath: string) {
  selectTreePath(rootPath)
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
  if (!props.workspace.replaceApplying) props.workspace.invalidateReplace()
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
watch(() => [props.activePanel, props.workspace.searchFocusRevision], () => {
  if (props.activePanel === 'search') nextTick(() => {
    if (props.workspace.searchFocusReplace) replaceInputRef.value?.focus()
    else searchInputRef.value?.focus()
  })
}, { immediate: true })

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
  cancelLocation(); clearTimeout(highlightTimer)
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

.treenode.selected {
  background: var(--accentbg);
  color: var(--bright);
}
.treenode:focus-visible { outline:2px solid var(--accent);outline-offset:-2px }

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
.replace-controls { display: grid; gap: 6px; }
.replace-toggle { text-align: left; margin: 6px 0; }
.search-directory { margin-top: 8px; width: 100%; box-sizing: border-box; }
.replace-preview { flex: 0 1 auto; min-height: 90px; max-height: 55%; overflow: auto; padding: 8px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
.replace-preview p { margin: 5px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.replace-actions { display: flex; flex-wrap: wrap; gap: 5px; }
.replace-actions button, .replace-controls button { padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px; }
.replace-file-header { display: flex; align-items: center; gap: 5px; margin-top: 8px; }
.replace-file-header span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.replace-match { display: flex; align-items: flex-start; gap: 4px; padding: 5px 0; }
.replace-diff { display: grid; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-family: monospace; }
.replace-diff del { color: var(--text-primary); background: rgba(220, 60, 60, .16); text-decoration: none; }
.replace-diff ins { color: var(--text-primary); background: rgba(40, 180, 80, .16); text-decoration: none; }
.replace-locked { pointer-events: none; opacity: .5; }

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
