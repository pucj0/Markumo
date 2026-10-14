<template>
  <div v-if="visible" class="workspace-operation-overlay" @click.self="finish(null)" @keydown="onKeydown">
    <form ref="dialogRef" class="workspace-operation-dialog" role="dialog" aria-modal="true" aria-label="工作区文件操作" @submit.prevent="finish(value)">
      <h2>{{ request.title }}</h2>
      <p>{{ request.description }}</p>
      <input v-if="request.initialValue !== undefined" v-model="value" aria-label="名称或目标目录" autocomplete="off" />
      <div class="operation-buttons">
        <button type="button" @click="finish(null)">取消</button>
        <button type="submit" :disabled="request.initialValue !== undefined && !value.trim()">{{ request.confirmLabel }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useModal } from '../../features/shell/useModal'
interface Request { title: string; description: string; confirmLabel: string; initialValue?: string }
const request = ref<Request>({ title: '', description: '', confirmLabel: '确认' })
const value = ref('')
const { visible, dialogRef, open, close, handleKeydown } = useModal()
let resolvePending: ((value: string | null) => void) | undefined
function finish(result: string | null) {
  close()
  const resolve = resolvePending; resolvePending = undefined; resolve?.(result)
}
function ask(next: Request) {
  finish(null); request.value = next; value.value = next.initialValue || ''; open()
  return new Promise<string | null>(resolve => { resolvePending = resolve })
}
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null) }
  else handleKeydown(event)
}
onUnmounted(() => finish(null))
defineExpose({ ask })
</script>

<style scoped>
.workspace-operation-overlay { position: fixed; inset: 0; z-index: 40; display: flex; justify-content: center; align-items: center; background: #080a1080; }
.workspace-operation-dialog { width: min(440px, 90vw); padding: 22px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); }
h2 { font-size: 16px; margin-bottom: 12px; } p { font-size: 12px; margin-bottom: 14px; overflow-wrap: anywhere; }
input { width: 100%; padding: 8px; background: var(--editor); color: var(--ink); border: 1px solid var(--line); }
.operation-buttons { display: flex; justify-content: flex-end; gap: 12px; margin-top: 18px; }
button { padding: 7px 14px; border-radius: 5px; background: var(--soft); } button[type=submit] { background: var(--accentbg); } button:disabled { opacity: .5; }
</style>
