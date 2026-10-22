<template>
  <div v-if="open" class="history-dialog-backdrop" @click="close" @keydown.esc="close">
    <div class="history-dialog" role="dialog" aria-label="文档历史版本" @click.stop>
      <div class="history-header">
        <div class="history-title-group">
          <span class="history-title">历史版本快照</span>
          <span class="history-subtitle">{{ currentPath }}</span>
        </div>
        <button class="history-close-btn" title="关闭 (Esc)" @click="close">✕</button>
      </div>

      <div class="history-body">
        <!-- Left: Versions List -->
        <div class="history-sidebar">
          <div class="history-sidebar-header">
            <span>保存记录 ({{ snapshots.length }})</span>
            <button v-if="snapshots.length" class="history-clean-btn" title="清理该文件的所有历史版本" @click="clearAll">全部清理</button>
          </div>
          <div v-if="!snapshots.length" class="history-empty">
            <p>暂无历史保存版本</p>
          </div>
          <div v-else class="history-list">
            <button
              v-for="s in snapshots"
              :key="s.id"
              class="history-item"
              :class="{ active: s.id === selectedId }"
              @click="selectSnapshot(s)"
            >
              <div class="history-item-top">
                <span class="history-item-time">{{ formatTime(s.timestamp) }}</span>
                <span v-if="s.label" class="history-item-label">{{ s.label }}</span>
              </div>
              <div class="history-item-bottom">
                <span>{{ (s.byteLength / 1024).toFixed(1) }} KB</span>
                <span class="history-item-hash">{{ s.hash }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Right: Preview & Diff -->
        <div class="history-content">
          <div class="history-view-tabs">
            <button class="history-tab" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">版本预览</button>
            <button class="history-tab" :class="{ active: viewMode === 'diff' }" @click="viewMode = 'diff'">与当前版本对比</button>
            <div class="history-tab-spacer"></div>
            <button v-if="selectedSnapshot" class="history-action-btn restore" @click="restoreSelected">恢复为此版本</button>
            <button v-if="selectedSnapshot" class="history-action-btn" @click="copySelected">复制内容</button>
            <button v-if="selectedSnapshot" class="history-action-btn delete" @click="deleteSelected">删除快照</button>
          </div>

          <div v-if="!selectedSnapshot" class="history-content-empty">
            <p>请选择一个历史版本进行查看</p>
          </div>

          <div v-else-if="viewMode === 'preview'" class="history-preview-box">
            <pre class="history-preview-pre"><code>{{ selectedSnapshot.content }}</code></pre>
          </div>

          <div v-else-if="viewMode === 'diff'" class="history-diff-box">
            <div v-for="(line, idx) in diffLines" :key="idx" class="diff-line" :class="line.type">
              <span class="diff-marker">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
              <span class="diff-text">{{ line.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { historyService, type DocumentSnapshot, type DiffLine } from '../../features/history/historyService'
import type { DocumentManager } from '../../editor/core/DocumentManager'

const props = defineProps<{
  open: boolean
  filePath: string
  currentContent: string
  documentId?: string | null
  manager?: DocumentManager
}>()

const emit = defineEmits<{(e: 'close'): void; (e: 'restored'): void}>()

const snapshots = ref<DocumentSnapshot[]>([])
const selectedId = ref<string | null>(null)
const viewMode = ref<'preview' | 'diff'>('preview')
const diffLines = ref<DiffLine[]>([])

const currentPath = computed(() => props.filePath || '未命名文档')

const selectedSnapshot = computed(() => {
  return snapshots.value.find(s => s.id === selectedId.value) || null
})

watch(() => [props.open, props.filePath], async () => {
  if (props.open && props.filePath) {
    snapshots.value = await historyService.getSnapshots(props.filePath)
    if (snapshots.value.length > 0) {
      selectedId.value = snapshots.value[0].id
    } else {
      selectedId.value = null
    }
    updateDiff()
  }
}, { immediate: true })

watch(() => [selectedId.value, viewMode.value], () => {
  if (viewMode.value === 'diff') {
    updateDiff()
  }
})

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function selectSnapshot(s: DocumentSnapshot) {
  selectedId.value = s.id
  if (viewMode.value === 'diff') updateDiff()
}

function updateDiff() {
  if (!selectedSnapshot.value) {
    diffLines.value = []
    return
  }
  diffLines.value = historyService.computeDiff(props.currentContent, selectedSnapshot.value.content)
}

function close() {
  emit('close')
}

async function restoreSelected() {
  if (!selectedSnapshot.value || !props.manager || !props.documentId) return
  const ok = confirm(`确定将文档恢复为 ${formatTime(selectedSnapshot.value.timestamp)} 的历史版本吗？`)
  if (!ok) return

  const targetContent = selectedSnapshot.value.content
  const currentLength = props.manager.getText(props.documentId)?.length ?? 0

  props.manager.dispatch(props.documentId, {
    changes: { from: 0, to: currentLength, insert: targetContent },
    userEvent: 'input.history.restore',
  })

  emit('restored')
  close()
}

function copySelected() {
  if (selectedSnapshot.value) {
    navigator.clipboard?.writeText(selectedSnapshot.value.content)
  }
}

async function deleteSelected() {
  if (!selectedSnapshot.value || !props.filePath) return
  await historyService.deleteSnapshot(props.filePath, selectedSnapshot.value.id)
  snapshots.value = await historyService.getSnapshots(props.filePath)
  if (snapshots.value.length > 0) {
    selectedId.value = snapshots.value[0].id
  } else {
    selectedId.value = null
  }
}

async function clearAll() {
  if (!props.filePath) return
  const ok = confirm('确定清空该文件的所有历史版本记录吗？此操作不可撤销。')
  if (!ok) return
  await historyService.clearSnapshots(props.filePath)
  snapshots.value = []
  selectedId.value = null
}
</script>

<style scoped>
.history-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-dialog {
  width: 900px;
  max-width: 92vw;
  height: 640px;
  max-height: 90vh;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
}

.history-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--bright);
}

.history-subtitle {
  margin-left: 10px;
  font-size: 12px;
  color: var(--muted);
}

.history-close-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
}
.history-close-btn:hover {
  color: var(--bright);
}

.history-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.history-sidebar {
  width: 260px;
  flex: none;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  background: var(--side);
}

.history-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}

.history-clean-btn {
  border: 0;
  background: transparent;
  color: var(--red, #ef4444);
  font-size: 11px;
  cursor: pointer;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  transition: all .12s ease;
}
.history-item:hover {
  background: var(--hover);
}
.history-item.active {
  background: var(--paper);
  border-color: var(--accent);
}

.history-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.history-item-time {
  font-size: 13px;
  font-weight: 600;
  color: var(--bright);
}

.history-item-label {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--soft);
  color: var(--muted);
}

.history-item-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
}

.history-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.history-view-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
}

.history-tab {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink);
}
.history-tab.active {
  background: var(--soft);
  color: var(--bright);
  font-weight: 600;
}

.history-tab-spacer {
  flex: 1;
}

.history-action-btn {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.history-action-btn:hover {
  background: var(--hover);
  color: var(--bright);
}
.history-action-btn.restore {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.history-action-btn.restore:hover {
  opacity: 0.9;
}
.history-action-btn.delete {
  color: var(--red, #ef4444);
}

.history-preview-box, .history-diff-box {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.history-preview-pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--ink);
}

.diff-line {
  display: flex;
  align-items: baseline;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  padding: 1px 4px;
}
.diff-line.added {
  background: rgba(16, 185, 129, 0.12);
  color: var(--green, #10b981);
}
.diff-line.removed {
  background: rgba(239, 68, 68, 0.12);
  color: var(--red, #ef4444);
}
.diff-marker {
  width: 20px;
  flex: none;
  user-select: none;
  font-weight: 700;
}
.diff-text {
  flex: 1;
  white-space: pre-wrap;
}

.history-empty, .history-content-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--muted);
  font-size: 13px;
}
</style>
