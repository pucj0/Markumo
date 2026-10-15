<template>
  <div class="tree-node-wrapper">
    <div
      class="treenode"
      :class="[
        node.isDirectory ? 'folder' : 'file',
        `depth-${depth}`,
        { active: !node.isDirectory && activePath && displayPathKey(activePath) === displayPathKey(node.path) }
      ]"
      :style="{ paddingLeft: `${Math.min(depth, 10) * 12 + 10}px` }"
      :title="`${node.name}\n${readablePath(node.path)}`"
      role="button"
      :aria-label="node.name"
      :aria-expanded="node.isDirectory ? !!node.isExpanded : undefined"
      tabindex="0"
      @click="handleClick"
      @dblclick="handleDblClick"
      @keydown.enter.self.prevent="handleClick"
      @keydown.space.self.prevent="handleClick"
      @contextmenu.prevent.stop="openMenu"
      @keydown.shift.f10.prevent.stop="openMenu"
    >
      <template v-if="node.isDirectory">
        <span class="twisty">
          <span v-if="node.isLoading" class="loading-spin">⟳</span>
          <span v-else>{{ node.isExpanded ? '▾' : '▸' }}</span>
        </span>
        <Icon name="folder" size="small" />
        <span class="label">{{ node.name }}</span>
      </template>

      <template v-else>
        <span class="twisty" aria-hidden="true"></span><Icon name="file" size="small" />
        <span class="label">{{ node.name }}</span>
        <span v-if="isDirty" class="dirty-dot">●</span>
      </template>

      <!-- 悬停快捷按钮 -->
      <div class="node-actions" @click.stop @keydown.stop>
        <button
          v-if="node.isDirectory"
          class="ib-tiny"
          title="新建子文件"
          @click="$emit('create-file', node.path)"
        >
          +
        </button>
        <button
          class="ib-tiny"
          title="重命名"
          @click="startRename"
        >
          ✎
        </button>
        <button
          class="ib-tiny danger"
          title="删除"
          @click="$emit('delete-node', node)"
        >
          ✕
        </button>
        <button class="ib-tiny" title="移动到…" @click="$emit('move-node', node)">↗</button>
      </div>
    </div>

    <!-- 子目录递归展开 -->
    <div v-if="!flat && node.isDirectory && node.isExpanded && node.children">
      <TreeNodeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        :dirty-paths="dirtyPaths"
        :desktop="desktop"
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
import type { WorkspaceNode } from '../../features/workspace/contracts'
import { readablePath, displayPathKey } from '../../features/shell/pathDisplay'

const props = defineProps<{
  node: WorkspaceNode
  depth: number
  activePath?: string
  dirtyPaths?: string[]
  flat?: boolean
  desktop?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-file', node: WorkspaceNode): void
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
  return props.dirtyPaths?.includes(props.node.path) ?? false
})


function handleClick() {
  if (props.node.isDirectory) {
    emit('toggle-folder', props.node)
  } else {
    emit('select-file', props.node)
  }
}

function handleDblClick() {
  if (!props.node.isDirectory) {
    emit('pin-file', props.node)
  }
}

function startRename() {
  emit('rename-node', props.node)
}

const contextMenu = ref<InstanceType<typeof ContextMenu> | null>(null)
function openMenu(event: MouseEvent | KeyboardEvent) {
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
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--ink);
  transition: background 0.1s;
  position: relative;
  font-size: 12px;
}

.treenode:hover {
  background: var(--hover);
}

.treenode.active {
  background: var(--soft);
  color: var(--bright);
  font-weight: 500;
}

.twisty {
  flex:none;
  width: 12px;
  text-align: center;
  color: var(--muted);
  font-size: 10px;
}

.label {
  min-width:0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-dot {
  font-size: 8px;
  color: var(--yellow);
  margin-right: 4px;
}

.node-actions {
  display: none;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
}

.treenode:hover .node-actions, .treenode:focus-within .node-actions {
  display: flex;
}

.ib-tiny {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--muted);
}

.ib-tiny:hover {
  background: var(--hover);
  color: var(--bright);
}

.ib-tiny.danger:hover {
  color: #ff6b6b;
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
