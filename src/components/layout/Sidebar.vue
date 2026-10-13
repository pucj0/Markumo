<template>
  <aside
    class="sidebar-wrapper"
    :style="{ width: `${width}px` }"
  >
    <div class="explorer">
      <div class="panelhead">
        <span class="panel-title">{{ panelTitle }}</span>
        <div class="headbtns">
          <button
            class="ib small"
            title="新建文件 (Ctrl+N)"
            @click="$emit('new-doc')"
          >
            <Icon name="plus" size="small" />
          </button>
          <button
            class="ib small"
            title="隐藏侧边栏"
            @click="$emit('toggle-side')"
          >
            <Icon name="panel" size="small" />
          </button>
        </div>
      </div>

      <div class="panel-body">
        <!-- 资源管理器面板 -->
        <div v-if="activePanel === 'files'" class="treelist">
          <div class="treenode folder root-folder">
            <span class="twisty">▾</span>
            <Icon name="open" size="small" />
            <span class="label">示例工作区（内存）</span>
          </div>

          <div
            v-for="item in visibleTree"
            :key="item.path"
            class="treenode"
            role="button"
            tabindex="0"
            :aria-label="item.name"
            :aria-expanded="item.isFolder ? openFolders.has(item.path) : undefined"
            @keydown.enter.prevent="handleItemClick(item)"
            @keydown.space.prevent="handleItemClick(item)"
            :class="[
              item.isFolder ? 'folder' : 'file',
              `depth-${item.depth}`,
              { active: !item.isFolder && activeDocId === item.id }
            ]"
            @click="handleItemClick(item)"
            @dblclick="handleItemDblClick(item)"
          >
            <template v-if="item.isFolder">
              <span class="twisty">{{ openFolders.has(item.path) ? '▾' : '▸' }}</span>
              <Icon name="open" size="small" />
              <span class="label">{{ item.name }}</span>
            </template>
            <template v-else>
              <span class="fileext" :class="getExt(item.name)">
                {{ getExt(item.name).slice(0, 2) }}
              </span>
              <span class="label">{{ item.name }}</span>
              <span v-if="isDocDirty(item.id)" class="dirty-dot">●</span>
            </template>
          </div>

          <div class="tree-divider"></div>
          <div class="sub-header">OPEN EDITORS</div>

          <div
            v-for="doc in openDocs"
            :key="`opened-${doc.id}`"
            class="treenode file depth-0"
            role="button"
            tabindex="0"
            @keydown.enter.prevent="$emit('select-doc', doc.id, true)"
            :class="{ active: activeDocId === doc.id }"
            @click="$emit('select-doc', doc.id, true)"
          >
            <span class="fileext" :class="getExt(doc.name)">
              {{ getExt(doc.name).slice(0, 2) }}
            </span>
            <span class="label">{{ doc.name }}</span>
            <span v-if="doc.dirty" class="dirty-dot">●</span>
          </div>
        </div>

        <!-- 搜索面板占位（待 Phase 4 实现） -->
        <div v-else-if="activePanel === 'search'" class="placeholder-pane">
          <div class="search-input-box">
            <input
              type="text"
              placeholder="在工作区搜索…"
              class="search-input"
              disabled
            />
          </div>
          <p class="placeholder-tip">
            工作区全文搜索将在 Phase 4 正式接入 Rust 后端分批流式检索。
          </p>
        </div>

        <!-- 大纲面板占位（待 Phase 6 实现） -->
        <div v-else-if="activePanel === 'outline'" class="placeholder-pane">
          <p class="placeholder-tip">
            文档大纲将在 Phase 6 基于 CodeMirror 6 语法树解析实现。
          </p>
        </div>
      </div>

      <div class="sidefoot">
        <b>Fleet 布局提示</b><br />
        双击固定标签 · Ctrl+P 快速打开<br />
        <span class="phase-badge">Phase 1 · 示例文件，不读写磁盘</span>
      </div>
    </div>

    <!-- 侧边栏调整拉条 -->
    <div
      class="resize-handle"
      role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical"
      tabindex="0" :aria-valuenow="width" :aria-valuemin="190" :aria-valuemax="420"
      @keydown.left.prevent="$emit('update:width', Math.max(190, width - 10))"
      @keydown.right.prevent="$emit('update:width', Math.min(420, width + 10))"
      @mousedown.prevent="startResize"
    ></div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import Icon from '../common/Icon.vue'
import type { SidebarPanel, EditorDocument } from '../../types'

const props = defineProps<{
  width: number
  activePanel: SidebarPanel
  activeDocId: string | null
  openDocs: EditorDocument[]
}>()

const emit = defineEmits<{
  (e: 'update:width', w: number): void
  (e: 'toggle-side'): void
  (e: 'new-doc'): void
  (e: 'select-doc', id: string, preview?: boolean): void
}>()

const openFolders = ref<Set<string>>(new Set(['src', 'src/editor', 'config']))

const panelTitle = computed(() => {
  switch (props.activePanel) {
    case 'files': return 'EXPLORER'
    case 'search': return 'SEARCH'
    case 'outline': return 'OUTLINE'
  }
})

interface MockFileNode {
  id: string
  name: string
  path: string
  isFolder: boolean
  depth: number
}

// Phase 1 骨架结构：展示标准文本文件与代码文件示例
const fileTree = ref<MockFileNode[]>([
  { id: 'folder-src', name: 'src', path: 'src', isFolder: true, depth: 0 },
  { id: 'folder-editor', name: 'editor', path: 'src/editor', isFolder: true, depth: 1 },
  { id: 'ts-doc', name: 'EditorView.ts', path: 'src/editor/EditorView.ts', isFolder: false, depth: 2 },
  { id: 'rust-doc', name: 'main.rs', path: 'src/main.rs', isFolder: false, depth: 1 },
  { id: 'folder-config', name: 'config', path: 'config', isFolder: true, depth: 0 },
  { id: 'json-doc', name: 'settings.json', path: 'config/settings.json', isFolder: false, depth: 1 },
  { id: 'txt-doc', name: 'today.txt', path: 'notes/today.txt', isFolder: false, depth: 0 },
  { id: 'readme-doc', name: 'README.md', path: 'README.md', isFolder: false, depth: 0 }
])

const visibleTree = computed(() => fileTree.value.filter(item =>
  fileTree.value.filter(parent => parent.isFolder && item.path.startsWith(`${parent.path}/`))
    .every(parent => openFolders.value.has(parent.path))
))

function getExt(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? (parts.pop()?.toLowerCase() || 'txt') : 'txt'
}

function isDocDirty(id: string): boolean {
  return props.openDocs.some(d => d.id === id && d.dirty)
}

function handleItemClick(item: MockFileNode) {
  if (item.isFolder) {
    if (openFolders.value.has(item.path)) {
      openFolders.value.delete(item.path)
    } else {
      openFolders.value.add(item.path)
    }
  } else {
    emit('select-doc', item.id, true)
  }
}

function handleItemDblClick(item: MockFileNode) {
  if (!item.isFolder) {
    emit('select-doc', item.id, false)
  }
}

let stopResize: (() => void) | null = null
onUnmounted(() => stopResize?.())

function startResize(e: MouseEvent) {
  stopResize?.()
  const startX = e.clientX
  const startWidth = props.width

  function onMouseMove(ev: MouseEvent) {
    const delta = ev.clientX - startX
    const newWidth = Math.max(190, Math.min(420, startWidth + delta))
    emit('update:width', newWidth)
  }

  const previousCursor = document.body.style.cursor
  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('blur', onMouseUp)
    document.body.style.cursor = previousCursor
    stopResize = null
  }

  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('blur', onMouseUp)
  stopResize = onMouseUp
}
</script>

<style scoped>
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
  gap: 4px;
}

.ib.small {
  width: 24px;
  height: 24px;
}

.panel-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.treelist {
  font-size: 12px;
}

.treenode {
  height: 27px;
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

.depth-0 { padding-left: 12px; }
.depth-1 { padding-left: 24px; }
.depth-2 { padding-left: 36px; }

.root-folder {
  color: var(--muted);
  font-weight: 600;
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

.placeholder-pane {
  padding: 12px;
}

.search-input {
  width: 100%;
  background: var(--editor);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--ink);
}

.placeholder-tip {
  margin-top: 12px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}

.sidefoot {
  padding: 10px 12px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  background: var(--bar);
}

.phase-badge {
  display: inline-block;
  margin-top: 4px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accentbg);
  padding: 1px 6px;
  border-radius: 4px;
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
</style>
