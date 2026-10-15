<template>
  <div
    ref="paneContainer"
    :class="[
      `pane pane-${paneId}`,
      // The classic two-pane class names stay valid for the first and second pane
      // so existing selectors, styles and user expectations keep working.
      paneId === 'main' ? 'main-pane' : 'secondary-pane',
      { active: isActivePane }
    ]"
    @focusin="manager.focusPane(paneId, false)"
    @mousedown="manager.focusPane(paneId, false)"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent.stop="handleDrop"
  >
    <TabBar
      :docs="paneDocs"
      :active-id="paneActiveId"
      :pane="paneId"
      :split="manager.isSplit"
      :manager="manager"
      :desktop="desktop"
      :root-path="rootPath"
      @select-tab="manager.select($event, paneId)"
      @pin-tab="manager.pin($event)"
      @unpin-tab="unpinTab($event)"
      @close-tab="$emit('close-tab', { id: $event, pane: paneId })"
      @close-others="closeOthers($event)"
      @close-right="closeRight($event)"
      @close-all="closeAll"
      @new-doc="newDocument"
      @move-tab="handleMoveTab"
      @split-tab="handleSplitTab"
      @move-other="handleMoveOther"
      @move-pane="handleMoveToPane"
      @close-pane="handleClosePane"
      @close-split="manager.closeSplit()"
      @merge-splits="manager.mergeAllPanes()"
      @reveal-in-explorer="$emit('reveal-in-explorer', $event)"
    />

    <Breadcrumb :doc="activeDoc" />

    <WelcomePage
      v-if="welcome && !activeDoc && !manager.isSplit"
      :loading="startupLoading"
      @new-doc="$emit('new-doc')"
      @open-file="$emit('open-file')"
      @open-workspace="$emit('open-workspace')"
    />

    <EditorPane
      v-else
      :manager="manager"
      :pane="paneId"
      :doc="activeDoc"
      :files="files"
      @quick-open="$emit('open-palette', 'file')"
    />

    <DropZoneOverlay :active="isDraggingOver" :zone="dragZone" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import TabBar from './TabBar.vue'
import Breadcrumb from './Breadcrumb.vue'
import EditorPane from './EditorPane.vue'
import WelcomePage from './WelcomePage.vue'
import DropZoneOverlay, { type DropZone } from './DropZoneOverlay.vue'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { FileController } from '../../features/files/FileController'
import type { SplitDirection } from '../../editor/layout/types'

const props = defineProps<{
  paneId: string
  manager: DocumentManager
  /** The manager is deliberately not reactive: this counter invalidates every
   * pane computed below, exactly like the container's own revision counter. */
  revision: number
  files?: FileController
  welcome?: boolean
  startupLoading?: boolean
  desktop: boolean
  rootPath?: string | null
}>()

const emit = defineEmits<{
  (e: 'new-doc'): void
  (e: 'open-file'): void
  (e: 'open-workspace'): void
  (e: 'open-palette', cat: 'action' | 'file' | 'all'): void
  (e: 'close-tab', payload: { id: string; pane: string }): void
  (e: 'open-workspace-file', payload: { path: string; name: string; paneId: string; zone: DropZone }): void
  (e: 'reveal-in-explorer', token: string): void
}>()

const paneContainer = ref<HTMLElement | null>(null)
const isDraggingOver = ref(false)
const dragZone = ref<DropZone | null>(null)

// Every pane view is derived from non-reactive manager state, so each computed
// reads the revision counter to stay invalidated with the container.
const paneModel = computed(() => { props.revision; return props.manager.layout.getPane(props.paneId) })
const paneActiveId = computed(() => { props.revision; return paneModel.value?.group.activeId || null })
const paneDocs = computed(() => {
  props.revision
  if (!paneModel.value) return []
  return paneModel.value.group.tabs.map(t => props.manager.metadata(t.documentId)!).filter(Boolean)
})
const activeDoc = computed(() => {
  props.revision
  return paneActiveId.value ? props.manager.metadata(paneActiveId.value) : null
})
const isActivePane = computed(() => { props.revision; return props.manager.layout.activePaneId === props.paneId })

function newDocument() {
  props.manager.focusPane(props.paneId, false)
  props.manager.createUntitled()
}

function unpinTab(id: string) {
  const pane = props.manager.layout.getPane(props.paneId)
  const tab = pane?.group.tabs.find(t => t.documentId === id)
  if (tab) {
    tab.pinned = false
    props.manager.notify()
  }
}

function closeOthers(id: string) {
  if (!paneModel.value) return
  const others = paneModel.value.group.tabs.filter(t => t.documentId !== id)
  for (const tab of others) {
    emit('close-tab', { id: tab.documentId, pane: props.paneId })
  }
}

function closeRight(id: string) {
  if (!paneModel.value) return
  const index = paneModel.value.group.tabs.findIndex(t => t.documentId === id)
  if (index >= 0) {
    const rightTabs = paneModel.value.group.tabs.slice(index + 1)
    for (const tab of rightTabs) {
      emit('close-tab', { id: tab.documentId, pane: props.paneId })
    }
  }
}

function closeAll() {
  if (!paneModel.value) return
  const tabs = [...paneModel.value.group.tabs]
  for (const tab of tabs) {
    emit('close-tab', { id: tab.documentId, pane: props.paneId })
  }
}

function handleMoveTab(payload: { id: string; from: string; targetIndex?: number }) {
  props.manager.moveTab(payload.id, payload.from, props.paneId, payload.targetIndex)
}

function handleSplitTab(payload: { id: string; direction: SplitDirection; duplicate?: boolean }) {
  if (payload.duplicate) {
    props.manager.splitPane(payload.direction, props.paneId, payload.id)
  } else {
    props.manager.splitPane(payload.direction, props.paneId, payload.id)
    if (props.manager.layout.getPane(props.paneId)?.group.tabs.some(t => t.documentId === payload.id)) {
      props.manager.close(payload.id, false, props.paneId)
    }
  }
}

function handleMoveOther(id: string) {
  const leaves = props.manager.layout.getAllLeafIds()
  const otherPane = leaves.find(pid => pid !== props.paneId)
  if (otherPane) {
    props.manager.moveTab(id, props.paneId, otherPane)
  } else {
    handleSplitTab({ id, direction: 'right' })
  }
}

function handleMoveToPane(payload: { id: string; toPane: string }) {
  props.manager.moveTab(payload.id, props.paneId, payload.toPane)
}

function handleClosePane() {
  props.manager.closePane(props.paneId)
}

// Fleet-style 4-direction Drop Targets: left, right, top, bottom, center
function handleDragOver(event: DragEvent) {
  event.preventDefault()
  if (!paneContainer.value) return
  const rect = paneContainer.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  const margin = 0.25

  let zone: DropZone = 'center'
  if (x < margin) zone = 'left'
  else if (x > 1 - margin) zone = 'right'
  else if (y < margin) zone = 'top'
  else if (y > 1 - margin) zone = 'bottom'
  else zone = 'center'

  dragZone.value = zone
  isDraggingOver.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function handleDragLeave(event: DragEvent) {
  if (paneContainer.value && !paneContainer.value.contains(event.relatedTarget as Node)) {
    isDraggingOver.value = false
    dragZone.value = null
  }
}

function handleDrop(event: DragEvent) {
  const zone = dragZone.value || 'center'
  isDraggingOver.value = false
  dragZone.value = null

  // 1. Internal Tab Drag
  const rawTab = event.dataTransfer?.getData('application/x-lightedit-tab')
  if (rawTab) {
    try {
      const tab = JSON.parse(rawTab)
      if (typeof tab.id === 'string' && typeof tab.from === 'string') {
        if (zone === 'center') {
          props.manager.moveTab(tab.id, tab.from, props.paneId)
        } else {
          props.manager.splitPane(zone as SplitDirection, props.paneId, tab.id)
          props.manager.close(tab.id, false, tab.from)
        }
        return
      }
    } catch {}
  }

  // 2. Workspace File Tree Drag
  const rawFile = event.dataTransfer?.getData('application/x-lightedit-file')
  if (rawFile) {
    try {
      const fileData = JSON.parse(rawFile)
      if (typeof fileData.path === 'string') {
        emit('open-workspace-file', { path: fileData.path, name: fileData.name, paneId: props.paneId, zone })
        return
      }
    } catch {}
  }
}
</script>

<style scoped>
.pane {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  position: relative;
  flex-direction: column;
}

</style>
