<template>
  <!-- Maximized Mode: Show only the maximized pane -->
  <template v-if="manager.layout.maximizedPaneId">
    <EditorPaneItem
      v-if="maximizedPaneExists"
      :key="manager.layout.maximizedPaneId"
      :pane-id="manager.layout.maximizedPaneId"
      :manager="manager"
      :revision="revision"
      :files="files"
      :welcome="welcome"
      :startup-loading="startupLoading"
      :desktop="desktop"
      :root-path="rootPath"
      @new-doc="$emit('new-doc')"
      @open-file="$emit('open-file')"
      @open-workspace="$emit('open-workspace')"
      @open-palette="$emit('open-palette', $event)"
      @close-tab="$emit('close-tab', $event)"
      @open-workspace-file="$emit('open-workspace-file', $event)"
      @reveal-in-explorer="$emit('reveal-in-explorer', $event)"
    />
  </template>

  <!-- Leaf Node: Render single pane -->
  <EditorPaneItem
    v-else-if="node.type === 'leaf'"
    :key="node.id"
    :pane-id="node.id"
    :manager="manager"
    :revision="revision"
    :files="files"
    :welcome="welcome"
    :startup-loading="startupLoading"
    :desktop="desktop"
    :root-path="rootPath"
    @new-doc="$emit('new-doc')"
    @open-file="$emit('open-file')"
    @open-workspace="$emit('open-workspace')"
    @open-palette="$emit('open-palette', $event)"
    @close-tab="$emit('close-tab', $event)"
    @open-workspace-file="$emit('open-workspace-file', $event)"
    @reveal-in-explorer="$emit('reveal-in-explorer', $event)"
  />

  <!-- Split Node: Render split container with divider -->
  <div
    v-else-if="node.type === 'split'"
    :key="node.id"
    ref="splitContainer"
    class="split-node"
    :class="`split-${node.orientation}`"
  >
    <div
      class="split-child first-child"
      :style="node.orientation === 'horizontal'
        ? { flex: `0 0 calc(${node.ratio * 100}% - 2px)` }
        : { flex: `0 0 calc(${node.ratio * 100}% - 2px)` }"
    >
      <SplitLayoutNode
        :key="node.first.id"
        :node="node.first"
        :manager="manager"
        :revision="revision"
        :files="files"
        :welcome="welcome"
        :startup-loading="startupLoading"
        :desktop="desktop"
        :root-path="rootPath"
        @new-doc="$emit('new-doc')"
        @open-file="$emit('open-file')"
        @open-workspace="$emit('open-workspace')"
        @open-palette="$emit('open-palette', $event)"
        @close-tab="$emit('close-tab', $event)"
        @open-workspace-file="$emit('open-workspace-file', $event)"
        @reveal-in-explorer="$emit('reveal-in-explorer', $event)"
      />
    </div>

    <div
      class="pane-divider"
      :class="node.orientation === 'horizontal' ? 'divider-horizontal' : 'divider-vertical'"
      role="separator"
      :aria-label="node.orientation === 'horizontal' ? '调整分栏宽度' : '调整分栏高度'"
      :aria-orientation="node.orientation === 'horizontal' ? 'vertical' : 'horizontal'"
      tabindex="0"
      :aria-valuenow="Math.round(node.ratio * 100)"
      :aria-valuemin="5"
      :aria-valuemax="95"
      @pointerdown="startResize($event, node)"
      @keydown="resizeKey($event, node)"
    />

    <div class="split-child second-child">
      <SplitLayoutNode
        :key="node.second.id"
        :node="node.second"
        :manager="manager"
        :revision="revision"
        :files="files"
        :welcome="welcome"
        :startup-loading="startupLoading"
        :desktop="desktop"
        :root-path="rootPath"
        @new-doc="$emit('new-doc')"
        @open-file="$emit('open-file')"
        @open-workspace="$emit('open-workspace')"
        @open-palette="$emit('open-palette', $event)"
        @close-tab="$emit('close-tab', $event)"
        @open-workspace-file="$emit('open-workspace-file', $event)"
        @reveal-in-explorer="$emit('reveal-in-explorer', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import EditorPaneItem from './EditorPaneItem.vue'
import type { LayoutNode, PaneSplitNode } from '../../editor/layout/types'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { FileController } from '../../features/files/FileController'
import type { DropZone } from './DropZoneOverlay.vue'

defineOptions({ name: 'SplitLayoutNode' })

const props = defineProps<{
  node: LayoutNode
  manager: DocumentManager
  /** The manager is not reactive: this counter invalidates the pane subtree. */
  revision: number
  files?: FileController
  welcome?: boolean
  startupLoading?: boolean
  desktop: boolean
  rootPath?: string | null
}>()

defineEmits<{
  (e: 'new-doc'): void
  (e: 'open-file'): void
  (e: 'open-workspace'): void
  (e: 'open-palette', cat: 'action' | 'file' | 'all'): void
  (e: 'close-tab', payload: { id: string; pane: string }): void
  (e: 'open-workspace-file', payload: { path: string; name: string; paneId: string; zone: DropZone }): void
  (e: 'reveal-in-explorer', token: string): void
}>()

const splitContainer = ref<HTMLElement | null>(null)
let activeResizeNode: PaneSplitNode | null = null

const maximizedPaneExists = computed(() => {
  props.revision
  return props.manager.layout.maximizedPaneId ? props.manager.layout.panes.has(props.manager.layout.maximizedPaneId) : false
})

function onResizeMove(event: PointerEvent) {
  if (!activeResizeNode || !splitContainer.value) return
  const rect = splitContainer.value.getBoundingClientRect()
  if (activeResizeNode.orientation === 'horizontal') {
    if (rect.width > 0) {
      const ratio = (event.clientX - rect.left) / rect.width
      props.manager.layout.resizeSplit(activeResizeNode.id, ratio)
    }
  } else {
    if (rect.height > 0) {
      const ratio = (event.clientY - rect.top) / rect.height
      props.manager.layout.resizeSplit(activeResizeNode.id, ratio)
    }
  }
}

function stopResize() {
  activeResizeNode = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
}

function startResize(event: PointerEvent, node: PaneSplitNode) {
  if (event.button !== 0) return
  event.preventDefault()
  activeResizeNode = node
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
}

function resizeKey(event: KeyboardEvent, node: PaneSplitNode) {
  const isHoriz = node.orientation === 'horizontal'
  const keys = isHoriz ? ['ArrowLeft', 'ArrowRight', 'Home'] : ['ArrowUp', 'ArrowDown', 'Home']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') {
    props.manager.layout.resizeSplit(node.id, 0.5)
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    props.manager.layout.resizeSplit(node.id, node.ratio + 0.05)
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    props.manager.layout.resizeSplit(node.id, node.ratio - 0.05)
  }
}

onUnmounted(() => {
  stopResize()
})
</script>

<style scoped>
.split-node {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
  position: relative;
  width: 100%;
  height: 100%;
}

.split-horizontal {
  flex-direction: row;
}

.split-vertical {
  flex-direction: column;
}

.split-child {
  min-height: 0;
  min-width: 0;
  display: flex;
  position: relative;
  overflow: hidden;
}

.second-child {
  flex: 1 1 0%;
}

.pane-divider {
  flex: none;
  background: var(--line);
  position: relative;
  z-index: 10;
  outline: none;
  transition: background 0.15s;
}

.divider-horizontal {
  width: 1px;
  cursor: col-resize;
}

.divider-horizontal::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
  background: transparent;
}

.divider-vertical {
  height: 1px;
  cursor: row-resize;
}

.divider-vertical::after {
  content: '';
  position: absolute;
  inset: -3px 0;
  background: transparent;
}

.pane-divider:hover,.pane-divider:focus-visible {
  background: var(--accent);
}
.pane-divider:hover::after,.pane-divider:focus-visible::after {
  background: var(--accentbg);
}
</style>
