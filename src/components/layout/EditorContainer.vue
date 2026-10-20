<template>
  <div ref="container" class="editor-container" :data-revision="revision">
    <div class="editor-main" :class="{ 'is-split-pane': manager.isSplit }">
      <div v-if="doc?.languageStatus === 'error'" class="language-message" role="status">
        {{ doc.languageError }}
      </div>

      <!-- 编辑主体区（递归 Split Tree） -->
      <div class="panes-container">
        <SplitLayoutNode
          :node="manager.layout.root"
          :manager="manager"
          :revision="revision"
          :files="files"
          :welcome="welcome"
          :startup-loading="startupLoading"
          :desktop="desktop"
          :root-path="rootPath"
          :live-toolbar="liveToolbar"
          @new-doc="$emit('new-doc')"
          @open-file="$emit('open-file')"
          @open-workspace="$emit('open-workspace')"
          @open-palette="$emit('open-palette', $event)"
          @close-tab="handleCloseTab"
          @open-workspace-file="handleOpenWorkspaceFile"
          @reveal-in-explorer="$emit('reveal-in-explorer', $event)"
        />
      </div>
    </div>

    <div v-if="showOutline && doc" class="outline-resizer" role="separator" aria-label="调整大纲宽度" aria-orientation="vertical" tabindex="0"
      :aria-valuenow="visibleOutlineWidth" :aria-valuemin="160" :aria-valuemax="maxOutlineWidth" title="拖动调整大纲宽度，双击恢复默认"
      @pointerdown="startOutlineResize" @lostpointercapture="stopOutlineResize" @dblclick="setOutlineWidth(240)"
      @keydown.left.prevent="setOutlineWidth(visibleOutlineWidth + 10)" @keydown.right.prevent="setOutlineWidth(visibleOutlineWidth - 10)"
      @keydown.home.prevent="setOutlineWidth(160)" @keydown.end.prevent="setOutlineWidth(maxOutlineWidth)"
    ></div>
    <aside v-if="showOutline && doc" class="outline-sidebar" :style="{ width: `${visibleOutlineWidth}px` }">
      <div class="outline-head">
        <span>大纲</span>
        <button
          class="tinyclose"
          aria-label="关闭大纲"
          title="关闭大纲"
          @click="$emit('close-outline')"
        >
          ✕
        </button>
      </div>
      <OutlineView
        :items="outlineItems"
        :is-markdown="isMarkdownDoc"
        :notice="outlineNotice"
        @select-item="handleSelectOutline"
      />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import SplitLayoutNode from './SplitLayoutNode.vue'
import OutlineView from './OutlineView.vue'
import { extractOutline, type OutlineItem } from '../../editor/outline/outlineService'
import type { EditorDocument } from '../../types'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { FileController } from '../../features/files/FileController'
import type { DropZone } from './DropZoneOverlay.vue'
import type { SplitDirection } from '../../editor/layout/types'

const props = defineProps<{
  doc: EditorDocument | null
  manager: DocumentManager
  showOutline: boolean
  outlineWidth?: number
  desktop: boolean
  wordWrap?: boolean
  files?: FileController
  welcome?: boolean
  startupLoading?: boolean
  rootPath?: string | null
  liveToolbar?: boolean
}>()

const emit = defineEmits<{
  (e: 'new-doc'): void
  (e: 'open-file'): void
  (e: 'open-workspace'): void
  (e: 'open-palette', cat: 'action' | 'file' | 'all'): void
  (e: 'close-outline'): void
  (e: 'update:outlineWidth', width: number): void
  // One event for every pane: the pane id travels with the tab, so a close can
  // never be handled twice (which would prompt for the same dirty file twice).
  (e: 'close-tab', payload: { id: string; pane: string }): void
  (e: 'open-path', path: string): void
  (e: 'reveal-in-explorer', token: string): void
}>()

const revision = ref(0)
const unsubscribe = props.manager.subscribe(() => revision.value++)
const container = ref<HTMLElement | null>(null), containerWidth = ref(800), localOutlineWidth = ref(240)
const maxOutlineWidth = computed(() => Math.max(160, Math.min(520, containerWidth.value - 244)))
const visibleOutlineWidth = computed(() => Math.min(maxOutlineWidth.value, Math.max(160, props.outlineWidth ?? localOutlineWidth.value)))
let observer: ResizeObserver | undefined
let resize: { pointer: number; x: number; width: number; cursor: string; selection: string; handle: HTMLElement } | null = null
function setOutlineWidth(width: number) {
  const value = Math.round(Math.max(160, Math.min(maxOutlineWidth.value, width)))
  localOutlineWidth.value = value
  emit('update:outlineWidth', value)
}
function startOutlineResize(event: PointerEvent) {
  if (event.button !== 0) return
  stopOutlineResize()
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  resize = {pointer:event.pointerId,x:event.clientX,width:visibleOutlineWidth.value,cursor:document.body.style.cursor,selection:document.body.style.userSelect,handle}
  handle.setPointerCapture(event.pointerId)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', moveOutlineResize)
  window.addEventListener('pointerup', stopOutlineResize)
  window.addEventListener('pointercancel', stopOutlineResize)
  window.addEventListener('blur', stopOutlineResize)
}
function moveOutlineResize(event: PointerEvent) {
  if (resize && event.pointerId === resize.pointer) setOutlineWidth(resize.width + resize.x - event.clientX)
}
function stopOutlineResize(event?: Event) {
  if (!resize) return
  if (event instanceof PointerEvent && event.pointerId !== resize.pointer) return
  const {handle, pointer} = resize
  document.body.style.cursor = resize.cursor
  document.body.style.userSelect = resize.selection
  resize = null
  if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
  window.removeEventListener('pointermove', moveOutlineResize)
  window.removeEventListener('pointerup', stopOutlineResize)
  window.removeEventListener('pointercancel', stopOutlineResize)
  window.removeEventListener('blur', stopOutlineResize)
}
watch(() => props.showOutline && !!props.doc, shown => { if (!shown) stopOutlineResize() })
onMounted(() => {
  if (!container.value) return
  containerWidth.value = container.value.clientWidth
  observer = new ResizeObserver(entries => { containerWidth.value = entries[0].contentRect.width })
  observer.observe(container.value)
})

function handleCloseTab(payload: { id: string; pane: string }) {
  emit('close-tab', payload)
}

function handleOpenWorkspaceFile(payload: { path: string; name: string; paneId: string; zone: DropZone }) {
  if (payload.zone !== 'center') {
    props.manager.splitPane(payload.zone as SplitDirection, payload.paneId)
  }
  emit('open-path', payload.path)
}

const isMarkdownDoc = computed(() => {
  return (!props.doc?.kind || props.doc.kind === 'text') && /\.(md|markdown)$/i.test(props.doc?.name || '')
})

const outlineItems = computed<OutlineItem[]>(() => {
  if (!props.doc) return []
  const state = props.manager.getState(props.doc.id)
  revision.value
  return extractOutline(props.doc, state)
})
const outlineNotice = computed(() => {
  if (props.doc?.languageStatus === 'loading') return '正在加载语言解析器…'
  if (props.doc && (props.manager.getState(props.doc.id)?.doc.length || 0) > 1024 * 1024) return '文档较大，大纲已暂停。'
  if (outlineItems.value.length >= 1000) return '大纲最多显示前 1000 项。'
  if (props.doc && ['Plain Text','CSV','Log','INI','TOML','JSONC'].includes(props.doc.language)) return '当前语言未提供结构大纲。'
  return ''
})

function handleSelectOutline(item: OutlineItem) {
  if (props.doc) props.manager.revealOutline(props.doc.id, item)
}

onUnmounted(() => {
  observer?.disconnect()
  stopOutlineResize()
  unsubscribe()
})
</script>

<style scoped>
.editor-container {
  min-height: 0;
  flex: 1;
  display: flex;
  background: var(--editor);
  overflow: hidden;
  position: relative;
}

.editor-main {
  min-width: 0;
  flex-direction: column;
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.language-message {
  color: var(--yellow);
  padding: 4px 18px;
  font-size: var(--ui-small-font-size);
}

.panes-container {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  position: relative;
  width: 100%;
  height: 100%;
}

.outline-sidebar {
  background: var(--side);
  display: flex;
  flex-direction: column;
  flex: none;
}
.outline-resizer {width:4px;flex:none;background:var(--line);cursor:col-resize;touch-action:none;user-select:none;position:relative;z-index:3}
.outline-resizer:hover,.outline-resizer:focus-visible {background:var(--accent);outline:none}

.outline-head {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: var(--ui-small-font-size);
  font-weight: 700;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}

.tinyclose {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--ui-small-font-size);
  color: var(--muted);
  border: none;
  background: transparent;
  cursor: pointer;
}
.tinyclose:hover {
  background: var(--line);
  color: var(--bright);
}
</style>
