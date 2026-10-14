<template>
  <div class="editor-container" :data-revision="revision">
    <div class="editor-main" :class="{ 'is-split-pane': manager.isSplit }">
      <div v-if="doc?.languageStatus === 'error'" class="language-message" role="status">
        {{ doc.languageError }}
      </div>

      <!-- 编辑主体区 -->
      <div v-show="mainDoc || secondaryDoc || manager.isSplit" class="panes-container">
        <!-- 主 Pane (Left) -->
        <div
          class="pane main-pane"
          :class="{ active: manager.activePane === 'main' }"
          @focusin="manager.focusPane('main', false)"
          @mousedown="manager.focusPane('main', false)"
          @dragover.prevent
          @drop.prevent="dropTab($event, 'main')"
        >
          <EditorPane :manager="manager" pane="main" :doc="mainDoc" />
        </div>

        <!-- 副 Pane (Right) - 仅在分栏模式开启时展示 -->
        <div
          v-if="manager.isSplit"
          class="pane secondary-pane"
          :class="{ active: manager.activePane === 'secondary' }"
          @focusin="manager.focusPane('secondary', false)"
          @mousedown="manager.focusPane('secondary', false)"
          @dragover.prevent
          @drop.prevent="dropTab($event, 'secondary')"
        >
          <div class="secondary-pane-header">
            <span class="pane-title">分栏</span>
            <button
              class="tinyclose"
              title="关闭副分栏"
              aria-label="关闭副分栏"
              @click.stop="manager.closeSplit()"
            >
              ✕
            </button>
          </div>
          <TabBar :docs="secondaryDocs" :active-id="manager.secondaryGroup.activeId" pane="secondary"
            @select-tab="manager.select($event, 'secondary')" @pin-tab="manager.pin($event)"
            @close-tab="$emit('close-secondary', $event)" @new-doc="newSecondary"
            @move-tab="manager.moveTab($event.id, $event.from, 'secondary')" />
          <EditorPane :manager="manager" pane="secondary" :doc="secondaryDoc" />
        </div>
      </div>

      <!-- 空状态引导 -->
      <div v-if="!mainDoc && !manager.isSplit" class="empty-state">
        <div class="empty-actions">
          <button class="primary-btn" @click="$emit('new-doc')">新建文件</button>
          <button class="secondary-btn" @click="$emit('open-palette', 'file')">快速打开</button>
        </div>
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
import EditorPane from './EditorPane.vue'
import TabBar from './TabBar.vue'
import OutlineView from './OutlineView.vue'
import { extractOutline, type OutlineItem } from '../../editor/outline/outlineService'
import type { EditorDocument } from '../../types'
import type { DocumentManager } from '../../editor/core/DocumentManager'

const props = defineProps<{
  doc: EditorDocument | null
  manager: DocumentManager
  showOutline: boolean
  desktop: boolean
}>()

defineEmits<{
  (e: 'new-doc'): void
  (e: 'open-palette', cat: 'action' | 'file' | 'all'): void
  (e: 'close-outline'): void
  (e: 'close-secondary', id: string): void
}>()

const revision = ref(0)
const unsubscribe = props.manager.subscribe(() => revision.value++)
const mainDoc = computed(() => { revision.value; return props.manager.group.activeId ? props.manager.metadata(props.manager.group.activeId) : null })
const secondaryDoc = computed(() => { revision.value; return props.manager.secondaryGroup.activeId ? props.manager.metadata(props.manager.secondaryGroup.activeId) : null })
const secondaryDocs = computed(() => { revision.value; return props.manager.secondaryOpenedDocuments })
// The manager is deliberately markRaw; use its subscription to invalidate the render.
function newSecondary() { props.manager.focusPane('secondary', false); props.manager.createUntitled() }
function dropTab(event: DragEvent, pane: 'main' | 'secondary') {
  try {
    const tab = JSON.parse(event.dataTransfer?.getData('application/x-lightedit-tab') || '{}')
    if (typeof tab.id === 'string' && ['main', 'secondary'].includes(tab.from)) props.manager.moveTab(tab.id, tab.from, pane)
  } catch { /* External file drops are handled by Tauri, not tab payloads. */ }
}

const isMarkdownDoc = computed(() => {
  return /\.(md|markdown)$/i.test(props.doc?.name || '')
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

onUnmounted(unsubscribe)
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
}

.pane {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  position: relative;
  border: 1px solid transparent;
}

.secondary-pane {
  flex-direction: column;
  border-left: 1px solid var(--line);
}
.is-split-pane .pane.active { border-color: var(--accent); }

.secondary-pane-header {
  height: 28px;
  background: var(--bar);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 11px;
  color: var(--muted);
  flex: none;
}

.editor-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
}

.editor-host :deep(.cm-editor) {
  height: 100%;
  width: 100%;
}

@media (max-width: 1050px) {
  .outline-sidebar { display: none; }
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  text-align: center;
  padding: 24px;
}

.empty-actions {
  display: flex;
  gap: 12px;
}

.primary-btn {
  background: var(--accent);
  color: white;
  padding: 8px 18px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.primary-btn:hover {
  opacity: 0.9;
}

.secondary-btn {
  background: var(--soft);
  color: var(--bright);
  border: 1px solid var(--line);
  padding: 8px 18px;
  border-radius: 7px;
  font-size: 12px;
  transition: background 0.15s;
}

.secondary-btn:hover {
  background: var(--hover);
}

.outline-sidebar {
  width: 220px;
  flex: none;
  background: var(--sidebar);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
}

.outline-head {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--line);
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.8px;
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
  cursor: pointer;
}

.tinyclose:hover {
  background: var(--hover);
  color: var(--bright);
}
</style>
