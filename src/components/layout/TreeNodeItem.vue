<template>
  <div class="tree-node-wrapper">
    <div
      class="treenode"
      :class="[
        node.isDirectory ? 'folder' : 'file',
        `depth-${depth}`,
        { 'active-file': isNodeActive, selected: isNodeSelected, 'locate-highlight': highlighted }
      ]"
      :style="{ paddingLeft: `${Math.min(depth, 10) * 12 + 10}px` }"
      :title="`${node.name}\n${readablePath(node.path)}`"
      role="treeitem"
      :data-tree-path="node.path"
      :aria-level="depth + 1"
      :aria-selected="isNodeSelected"
      :aria-current="isNodeActive ? 'page' : undefined"
      :aria-label="node.name"
      :aria-expanded="node.isDirectory ? !!node.isExpanded : undefined"
      :draggable="!node.isDirectory"
      @dragstart="handleDragStart"
      :tabindex="tabStop ? 0 : -1"
      @focus.self="emit('locate-node', node)"
      @click="handleClick"
      @dblclick="handleDblClick"
      @contextmenu.prevent.stop="openMenu"
      @keydown.shift.f10.prevent.stop="openMenu"
    >
      <template v-if="node.isDirectory">
        <span class="twisty" @click.stop="handleTwistyClick" @dblclick.stop>
          <span v-if="node.isLoading" class="loading-spin">⟳</span>
          <span v-else>{{ node.isExpanded ? '▾' : '▸' }}</span>
        </span>
        <Icon name="folder" size="small" />
        <span class="label">{{ node.name }}</span>
      </template>

      <template v-else>
        <span class="twisty" aria-hidden="true"></span><FileIcon :name="node.name" />
        <span class="label">{{ node.name }}</span>
        <span v-if="isDirty" class="dirty-dot">●</span>
      </template>
    </div>

    <!-- 子目录递归展开 -->
    <div v-if="!flat && node.isDirectory && node.isExpanded && node.children">
      <TreeNodeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-file-path="activeFilePath"
        :selected-tree-path="selectedTreePath"
        :tree-click-mode="treeClickMode"
        :dirty-paths="dirtyPaths"
        :desktop="desktop"
        @locate-node="$emit('locate-node', $event)"
        @open-file="$emit('open-file', $event)"
        @select-file="$emit('select-file', $event)"
        @pin-file="$emit('pin-file', $event)"
        @toggle-folder="$emit('toggle-folder', $event)"
        @create-file="$emit('create-file', $event)"
        @rename-node="$emit('rename-node', $event)"
        @delete-node="$emit('delete-node', $event)"
        @move-node="$emit('move-node', $event)"
        @copy-path="$emit('copy-path', $event)"
        @reveal-node="$emit('reveal-node', $event)"
      />
    </div>
    <ContextMenu ref="contextMenu" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ContextMenu from '../common/ContextMenu.vue'
import { CommandRegistry, menuCommand as cmd, separator } from '../../features/shell/menuModel'
import Icon from '../common/Icon.vue'
import FileIcon from '../common/FileIcon.vue'
import type { WorkspaceNode } from '../../features/workspace/contracts'
import { readablePath, displayPathKey } from '../../features/shell/pathDisplay'

const props = withDefaults(defineProps<{
  node: WorkspaceNode
  depth: number
  activeFilePath?: string
  selectedTreePath?: string | null
  treeClickMode?: 'double' | 'single'
  dirtyPaths?: string[]
  flat?: boolean
  desktop?: boolean
  tabStop?: boolean
  highlighted?: boolean
}>(), {
  treeClickMode: 'single',
})

const emit = defineEmits<{
  (e: 'locate-node', node: WorkspaceNode): void
  (e: 'select-file', node: WorkspaceNode): void
  (e: 'open-file', node: WorkspaceNode): void
  (e: 'pin-file', node: WorkspaceNode): void
  (e: 'toggle-folder', node: WorkspaceNode): void
  (e: 'create-file', parentDir: string): void
  (e: 'rename-node', node: WorkspaceNode): void
  (e: 'delete-node', node: WorkspaceNode): void
  (e: 'move-node', node: WorkspaceNode): void
  (e: 'copy-path', path: string): void
  (e: 'reveal-node', path: string): void
}>()

const isDirty = computed(() => {
  return props.dirtyPaths?.some(path => displayPathKey(path) === displayPathKey(props.node.path)) ?? false
})

const isNodeSelected = computed(() => !!props.selectedTreePath && displayPathKey(props.selectedTreePath) === displayPathKey(props.node.path))
const isNodeActive = computed(() => !props.node.isDirectory && !!props.activeFilePath && displayPathKey(props.activeFilePath) === displayPathKey(props.node.path))

function handleDragStart(event: DragEvent) {
  if (props.node.isDirectory) return
  event.dataTransfer?.setData('application/x-markumo-file', JSON.stringify({ path: props.node.path, name: props.node.name }))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'
}

function handleClick(event: MouseEvent) {
  emit('locate-node', props.node)
  if (event.detail > 1) return
  if (props.node.isDirectory) {
    if (props.treeClickMode === 'single') {
      emit('toggle-folder', props.node)
    }
  } else {
    // 文件无论何种模式，单击均打开临时预览 (Preview Tab)
    emit('select-file', props.node)
  }
}

function handleDblClick() {
  emit('locate-node', props.node)
  if (props.node.isDirectory) {
    if (props.treeClickMode === 'double') {
      emit('toggle-folder', props.node)
    }
  } else {
    // 文件双击固定为永久标签 (Permanent Tab)
    emit('pin-file', props.node)
  }
}

function handleTwistyClick(event: MouseEvent) {
  emit('locate-node', props.node)
  if (props.node.isDirectory && event.detail <= 1) {
    emit('toggle-folder', props.node)
  }
}

const contextMenu = ref<InstanceType<typeof ContextMenu> | null>(null)
function openMenu(event: MouseEvent | KeyboardEvent) {
  emit('locate-node', props.node)
  const node = props.node
  const registry = new CommandRegistry([
    { id:'node-new-file',title:'新建文件…',enabled:node.isDirectory,run:()=>emit('create-file',node.path) },
    { id:'node-rename',title:'重命名…',enabled:true,run:()=>emit('rename-node',node) },
    { id:'node-move',title:'移动到…',enabled:true,run:()=>emit('move-node',node) },
    { id:'node-delete',title:'删除…',enabled:true,run:()=>emit('delete-node',node) },
    { id:'node-copy-path',title:'复制文件路径',enabled:true,run:()=>emit('copy-path',node.path) },
    { id:'node-reveal',title:'在文件管理器中显示',enabled:!!props.desktop,run:()=>emit('reveal-node',node.path) },
  ])
  contextMenu.value?.open(event,[...(node.isDirectory ? [cmd('node-new-file'),separator('node-create-section')] : []),cmd('node-rename'),cmd('node-move'),cmd('node-delete'),separator('node-path-section'),cmd('node-copy-path'),cmd('node-reveal')],registry,'文件与目录操作')
}
</script>

<style scoped>
.tree-node-wrapper {
  user-select: none;
}

.treenode {
  height: var(--ui-tree-row-height);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--ink);
  transition: background 0.1s;
  position: relative;
  font-size: var(--ui-font-size);
}

.treenode:hover {
  background: var(--hover);
}

.treenode.selected {
  background: var(--accentbg);
  color: var(--bright);
}
.treenode.active-file::before { content:'';position:absolute;left:0;top:4px;bottom:4px;width:2px;border-radius:2px;background:var(--accent) }
.treenode.active-file { color:var(--bright) }
.treenode:focus-visible { outline:2px solid var(--accent);outline-offset:-2px }
.treenode.locate-highlight { animation:locate-pulse 1.2s ease-out }
@keyframes locate-pulse { from { box-shadow:inset 0 0 0 2px var(--accent);background:var(--accentbg) } to { box-shadow:inset 0 0 0 2px transparent } }
@media(prefers-reduced-motion:reduce) { .treenode { transition:none }.treenode.locate-highlight { animation:none;box-shadow:inset 0 0 0 2px var(--accent) } }

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

.treenode.folder .twisty {
  cursor: pointer;
}

.treenode.folder .twisty:hover {
  color: var(--bright);
  background: var(--hover);
}

.label {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-dot {
  font-size: var(--ui-small-font-size);
  color: var(--yellow);
  margin-right: 4px;
}

.loading-spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
