<template>
  <div class="tree-node-wrapper">
    <div
      class="treenode"
      :class="[
        node.isDirectory ? 'folder' : 'file',
        `depth-${depth}`,
        { active: !node.isDirectory && activePath === node.path }
      ]"
      :style="{ paddingLeft: `${depth * 14 + 10}px` }"
      role="button"
      tabindex="0"
      @click="handleClick"
      @dblclick="handleDblClick"
      @keydown.enter.self.prevent="handleClick"
      @keydown.space.self.prevent="handleClick"
      @contextmenu.prevent="openMenu"
    >
      <template v-if="node.isDirectory">
        <span class="twisty">
          <span v-if="node.isLoading" class="loading-spin">⟳</span>
          <span v-else>{{ node.isExpanded ? '▾' : '▸' }}</span>
        </span>
        <Icon name="open" size="small" />
        <span class="label">{{ node.name }}</span>
      </template>

      <template v-else>
        <span class="fileext" :class="getExt(node.name)">
          {{ getExt(node.name).slice(0, 2) }}
        </span>
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
        @select-file="$emit('select-file', $event)"
        @pin-file="$emit('pin-file', $event)"
        @toggle-folder="$emit('toggle-folder', $event)"
        @create-file="$emit('create-file', $event)"
        @rename-node="$emit('rename-node', $event)"
        @delete-node="$emit('delete-node', $event)"
        @move-node="$emit('move-node', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../common/Icon.vue'
import type { WorkspaceNode } from '../../features/workspace/contracts'

const props = defineProps<{
  node: WorkspaceNode
  depth: number
  activePath?: string
  dirtyPaths?: string[]
  flat?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-file', node: WorkspaceNode): void
  (e: 'pin-file', node: WorkspaceNode): void
  (e: 'toggle-folder', node: WorkspaceNode): void
  (e: 'create-file', parentDir: string): void
  (e: 'rename-node', node: WorkspaceNode): void
  (e: 'delete-node', node: WorkspaceNode): void
  (e: 'move-node', node: WorkspaceNode): void
}>()

const isDirty = computed(() => {
  return props.dirtyPaths?.includes(props.node.path) ?? false
})

function getExt(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? (parts.pop()?.toLowerCase() || 'txt') : 'txt'
}

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

function openMenu() {
  startRename()
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
