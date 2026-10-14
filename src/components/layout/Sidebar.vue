<template>
  <aside
    class="sidebar-wrapper"
    :style="{ width: `${width}px` }"
  >
    <div class="explorer">
      <!-- 侧边栏头部 -->
      <div class="panelhead">
        <span class="panel-title">{{ panelTitle }}</span>
        <div class="headbtns">
          <template v-if="activePanel === 'files' && workspace.rootPath">
            <button class="ib small" :aria-pressed="workspace.showIgnored" title="显示/隐藏被忽略的文件" @click="workspace.toggleIgnored()">◉</button>
            <button
              class="ib small"
              title="新建文件"
              @click="handleCreateFile(workspace.rootPath)"
            >
              <Icon name="plus" size="small" />
            </button>
            <button
              class="ib small"
              title="新建文件夹"
              @click="handleCreateDir(workspace.rootPath)"
            >
              <Icon name="open" size="small" />
            </button>
            <button
              class="ib small"
              title="刷新目录树"
              @click="workspace.refreshDirectory()"
            >
              <span style="font-size: 11px;">↻</span>
            </button>
          </template>
          <button
            class="ib small"
            title="隐藏侧边栏 (Ctrl+B)"
            @click="$emit('toggle-side')"
          >
            <Icon name="panel" size="small" />
          </button>
        </div>
      </div>

      <!-- 侧边栏内容体 -->
      <div class="panel-body">
        <!-- 1. 资源管理器面板 -->
        <div v-if="activePanel === 'files'" class="treelist">
          <!-- 已打开真实工作区 -->
          <template v-if="workspace.rootPath">
            <div class="workspace-tree-container" tabindex="0" aria-label="工作区目录树" :style="{ height: `${Math.min(flatTree.length * 26, 380)}px`, overflow: 'auto' }" @scroll="treeScrollTop = ($event.target as HTMLElement).scrollTop">
              <div :style="{ height: `${treeStart * 26}px` }"></div>
              <template v-for="row in visibleTree" :key="row.node.path">
              <div v-if="row.root" class="treenode folder root-folder" :title="row.root.rootPath">
                <button class="root-toggle" @click="toggleRoot(row.root.rootPath)"><span class="twisty">{{ collapsedRoots.includes(row.root.rootPath) ? '▸' : '▾' }}</span><Icon name="open" size="small" /><span class="label">{{ row.root.name }}</span></button>
                <button class="ib small" :aria-label="`在 ${row.root.name} 中新建文件`" title="在此文件夹中新建文件" @click="handleCreateFile(row.root.rootPath)">+</button>
                <button class="ib small" :aria-label="`在 ${row.root.name} 中新建文件夹`" title="在此文件夹中新建文件夹" @click="handleCreateDir(row.root.rootPath)"><Icon name="open" size="small" /></button>
                <button class="ib small" :aria-label="`从工作区移除 ${row.root.name}`" title="从工作区移除（不删除文件）" @click="workspace.removeFolder(row.root.rootPath)">×</button>
              </div>
              <TreeNodeItem v-else
                :key="row.node.path"
                :node="row.node"
                :depth="row.depth"
                flat
                :active-path="activeDocPath"
                :dirty-paths="dirtyDocPaths"
                @select-file="workspace.openFile($event)"
                @pin-file="workspace.openFile($event, false)"
                @toggle-folder="workspace.toggleFolder($event)"
                @create-file="handleCreateFile"
                @rename-node="handleRenameNode"
                @delete-node="handleDeleteNode"
                @move-node="handleMoveNode"
              />
              </template>
              <div :style="{ height: `${Math.max(0, flatTree.length - treeStart - visibleTree.length) * 26}px` }"></div>
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
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick, watch } from 'vue'
import Icon from '../common/Icon.vue'
import TreeNodeItem from './TreeNodeItem.vue'
import WorkspaceOperationDialog from '../modals/WorkspaceOperationDialog.vue'
import OutlineView from './OutlineView.vue'
import { extractOutline, type OutlineItem } from '../../editor/outline/outlineService'
import type { SidebarPanel, EditorDocument } from '../../types'
import type { WorkspaceController } from '../../features/workspace/WorkspaceController'
import type { WorkspaceNode, WorkspaceInfo } from '../../features/workspace/contracts'
import type { DocumentManager } from '../../editor/core/DocumentManager'

const props = defineProps<{
  width: number
  activePanel: SidebarPanel
  activeDocId: string | null
  openDocs: EditorDocument[]
  recentFiles: { path: string; name: string }[]
  workspace: WorkspaceController
  desktop: boolean
  manager?: DocumentManager
}>()

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
  return /\.(md|markdown)$/i.test(activeDoc.value?.name || '')
})

const outlineItems = computed<OutlineItem[]>(() => {
  if (!activeDoc.value || !props.manager) return []
  const state = props.manager.getState(activeDoc.value.id)
  return extractOutline(activeDoc.value, state)
})

const searchInputRef = ref<HTMLInputElement | null>(null)
const operationDialog = ref<InstanceType<typeof WorkspaceOperationDialog> | null>(null)
const treeScrollTop = ref(0)
const collapsedRoots = ref<string[]>([])
function toggleRoot(path: string) { collapsedRoots.value = collapsedRoots.value.includes(path) ? collapsedRoots.value.filter(item => item !== path) : [...collapsedRoots.value, path] }
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
const treeStart = computed(() => Math.max(0, Math.min(Math.floor(treeScrollTop.value / 26) - 5, flatTree.value.length - 30)))
const visibleTree = computed(() => flatTree.value.slice(treeStart.value, treeStart.value + 30))
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

const dirtyDocPaths = computed(() => {
  return props.openDocs.filter(d => d.dirty).map(d => d.path)
})

async function handleCreateFile(parentDir: string) {
  const name = await operationDialog.value?.ask({ title: '新建文件', description: parentDir, confirmLabel: '创建', initialValue: '' })
  if (name && name.trim()) {
    void props.workspace.createFile(parentDir, name.trim())
  }
}

async function handleCreateDir(parentDir: string) {
  const name = await operationDialog.value?.ask({ title: '新建文件夹', description: parentDir, confirmLabel: '创建', initialValue: '' })
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
  if (resizing) document.body.style.cursor = ''
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})
</script>

<style scoped>
.root-toggle { display:flex;align-items:center;gap:5px;flex:1;min-width:0;text-align:left;height:26px;color:var(--sub) }
.root-toggle .label { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
.sidebar-wrapper {
  flex: none;
  display: flex;
  position: relative;
  height: 100%;
}

.explorer {
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
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--line);
  flex: none;
}

.panel-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.8px;
}

.headbtns {
  display: flex;
  gap: 3px;
}

.ib.small {
  width: 24px;
  height: 24px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.treelist {
  font-size: 12px;
}

.treenode {
  height: 26px;
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
  width: 12px;
  text-align: center;
  color: var(--muted);
  font-size: 10px;
}

.label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-dot {
  font-size: 8px;
  color: var(--yellow);
}

.empty-workspace-box {
  padding: 16px 12px;
  text-align: center;
}

.empty-ws-tip {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 10px;
}

.open-folder-btn {
  background: var(--soft);
  border: 1px solid var(--line);
  color: var(--bright);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
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
  font-size: 10px;
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
  font-size: 12px;
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
  font-size: 11px;
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
  font-size: 11px;
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
  font-size: 11px;
  color: var(--yellow);
  padding: 2px 6px;
}

.search-status-bar {
  padding: 6px 12px;
  font-size: 11px;
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
  font-size: 11px;
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
  font-size: 10px;
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
  font-size: 11px;
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
