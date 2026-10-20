<template>
  <div v-if="visible" class="recovery-overlay" @keydown.stop="onKeydown">
    <section ref="dialogRef" class="recovery-dialog" role="dialog" aria-modal="true" aria-label="可恢复的未保存文档">
      <header>
        <div>
          <h2>可恢复的未保存文档</h2>
          <p class="hint">这些内容在异常退出前还没有保存。恢复后仍会保持“未保存修改”，可以在确认后再保存。</p>
        </div>
        <button class="icon-close" type="button" aria-label="关闭恢复面板" @click="$emit('close')">×</button>
      </header>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="!records.length" class="empty">没有可恢复的未保存文档。</p>

      <ul v-else class="recovery-list">
        <li v-for="record in records" :key="record.id" class="recovery-row">
          <div class="row-main">
            <strong :title="record.name">{{ record.name }}</strong>
            <span class="path" :title="record.path || '未命名文档'">{{ record.path || '未命名文档' }}</span>
            <span class="meta">
              {{ formatTime(record.updatedAt) }} · {{ record.charCount.toLocaleString() }} 字符
              <template v-if="record.mode"> · {{ modeLabel(record.mode) }}</template>
              <template v-if="record.panes.length > 1"> · {{ record.panes.length }} 个窗格</template>
            </span>
            <span class="disk" :class="{ changed: record.diskChanged, missing: record.path && !record.diskExists }">
              {{ diskLabel(record) }}
            </span>
          </div>
          <div class="row-actions">
            <button type="button" class="primary" :disabled="busy" @click="$emit('restore', record)">恢复</button>
            <button v-if="record.path" type="button" :disabled="busy" @click="$emit('diff', record)">比较</button>
            <button type="button" class="discard" :disabled="busy" @click="$emit('discard', record)">丢弃</button>
          </div>
        </li>
      </ul>

      <div v-if="diff" class="diff-panel">
        <div class="diff-head">
          <strong>{{ diff.name }}</strong>
          <span v-if="diff.path" class="path">{{ diff.path }}</span>
          <button type="button" class="icon-close" aria-label="关闭比较" @click="$emit('close-diff')">×</button>
        </div>
        <p v-if="diff.error" class="error">{{ diff.error }}</p>
        <p v-else-if="!diff.diskText" class="empty">原文件不存在，恢复稿将作为新的未保存文档打开。</p>
        <template v-else>
          <p class="hint diff-hint">对比当前编辑器内容与恢复内容。</p>
          <div class="diff-lines" role="list">
            <div v-for="(line, index) in diffLines.lines" :key="index" class="diff-line" :class="line.type" role="listitem">
              <span class="sign">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ' }}</span>
              <span class="text">{{ line.text || ' ' }}</span>
            </div>
          </div>
          <p v-if="diffLines.truncated" class="hint">差异较大，仅显示前 400 行。</p>
        </template>
      </div>

      <footer>
        <button type="button" class="secondary" :disabled="busy" @click="$emit('close')">暂不处理</button>
        <button type="button" :disabled="busy || !records.length" @click="$emit('restore-all')">全部恢复</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useModal } from '../../features/shell/useModal'
import { diffText } from '../../features/recovery/diff'
import type { RecoveryDiff, RecoverySummary } from '../../features/recovery/types'

const props = defineProps<{
  visible: boolean
  records: RecoverySummary[]
  busy: boolean
  diff: RecoveryDiff | null
  error: string | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'restore', record: RecoverySummary): void
  (e: 'discard', record: RecoverySummary): void
  (e: 'restore-all'): void
  (e: 'diff', record: RecoverySummary): void
  (e: 'close-diff'): void
}>()

const { dialogRef, open: openModal, close: closeModal, handleKeydown } = useModal()
void dialogRef // Bound by name in the template.
const diffLines = computed(() => props.diff
  ? diffText(props.diff.recoveryText, props.diff.diskText ?? '')
  : { lines: [], truncated: false })

watch(() => props.visible, value => {
  if (value) openModal()
  else closeModal()
}, { immediate: true })

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (props.diff) emit('close-diff')
    else emit('close')
    return
  }
  handleKeydown(event)
}

function formatTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
function modeLabel(mode: string) {
  return mode === 'live' ? '实时排版' : mode === 'split' ? '双栏' : '源码'
}
function diskLabel(record: RecoverySummary) {
  if (!record.path) return '未命名草稿'
  if (!record.diskExists) return '原文件已删除'
  return record.diskChanged ? '磁盘内容已变化' : '原文件存在'
}
</script>

<style scoped>
.recovery-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, .42);
}
.recovery-dialog {
  width: min(760px, 100%);
  max-height: min(82vh, 720px);
  overflow: auto;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 20px;
}
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
h2 { margin: 0 0 6px; font-size: calc(var(--ui-font-size) + 3px); color: var(--bright); }
.hint, .empty { color: var(--muted); line-height: 1.55; margin: 0; }
.hint { font-size: var(--ui-small-font-size); }
.error { color: #d9534f; white-space: pre-wrap; }
.icon-close { border: 0; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 2px; }
.recovery-list { list-style: none; padding: 0; margin: 16px 0 12px; display: grid; gap: 8px; }
.recovery-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--editor); }
.row-main { display: grid; gap: 3px; min-width: 0; }
.row-main strong { color: var(--bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.path { color: var(--muted); font-size: var(--ui-small-font-size); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: var(--muted); font-size: var(--ui-small-font-size); }
.disk { color: #3f9c62; font-size: var(--ui-small-font-size); }
.disk.changed { color: #c98a2c; }
.disk.missing { color: #d9534f; }
.row-actions { display: flex; gap: 6px; flex: none; }
button { padding: 6px 11px; border-radius: 6px; border: 1px solid var(--line); background: var(--soft); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accentbg); color: var(--bright); }
button.discard { color: #d9534f; }
button:disabled { opacity: .5; cursor: default; }
footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--line); padding-top: 14px; margin-top: 14px; }
.diff-panel { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
.diff-head { display: flex; align-items: center; gap: 8px; }
.diff-head .path { flex: 1; }
.diff-hint { margin: 8px 0; }
.diff-lines { max-height: 260px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--editor); font-family: var(--font-mono); font-size: var(--ui-small-font-size); }
.diff-line { display: flex; gap: 8px; padding: 1px 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.diff-line.add { background: rgba(63, 156, 98, .14); color: #7ec89a; }
.diff-line.remove { background: rgba(217, 83, 79, .13); color: #e08c89; }
.diff-line .sign { width: 1ch; flex: none; color: var(--muted); }
.diff-line .text { min-width: 0; }
</style>
