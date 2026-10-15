<template>
  <div class="editor-container" :data-revision="revision">
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

    <!-- 右侧大纲容器（Phase 6 真实 Lezer AST 大纲接入） -->
    <aside v-if="showOutline && doc" class="outline-sidebar">
      <div class="outline-head">
        <span>OUTLINE</span>
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
import { ref, computed, onUnmounted } from 'vue'
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
  desktop: boolean
  wordWrap?: boolean
  files?: FileController
  welcome?: boolean
  startupLoading?: boolean
  rootPath?: string | null
}>()

const emit = defineEmits<{
  (e: 'new-doc'): void
  (e: 'open-file'): void
  (e: 'open-workspace'): void
  (e: 'open-palette', cat: 'action' | 'file' | 'all'): void
  (e: 'close-outline'): void
  // One event for every pane: the pane id travels with the tab, so a close can
  // never be handled twice (which would prompt for the same dirty file twice).
  (e: 'close-tab', payload: { id: string; pane: string }): void
  (e: 'open-path', path: string): void
  (e: 'reveal-in-explorer', token: string): void
}>()

const revision = ref(0)
const unsubscribe = props.manager.subscribe(() => revision.value++)

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
  return props.doc?.kind !== 'javaClass' && /\.(md|markdown)$/i.test(props.doc?.name || '')
})

const outlineItems = computed<OutlineItem[]>(() => {
  if (!props.doc) return []
  const state = props.manager.getState(props.doc.id)
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
  if (props.doc) {
    props.manager.revealPosition(props.doc.id, item.lineNumber, 1)
  }
}

onUnmounted(() => {
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
  font-size: 11px;
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
  width: 240px;
  background: var(--side);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  flex: none;
}

.outline-head {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11px;
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
  font-size: 11px;
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
