<template>
  <div v-if="visible" class="discard-overlay" @keydown.stop="handleKeydown">
    <div ref="dialogRef" class="discard-dialog" role="dialog" aria-modal="true" aria-label="未保存修改确认">
      <h2>保留未保存修改？</h2>
      <p>{{ name }} 有未保存的修改。</p>
      <p>放弃后无法恢复这些修改。保存失败或取消选择时会保留文档。</p>
      <div class="actions">
        <button :disabled="busy" @click="close">继续编辑</button>
        <button class="discard" :disabled="busy" @click="discard">放弃修改并关闭</button>
        <button :disabled="!canSave || busy" :title="canSave ? '' : '需要 Tauri 桌面版'" @click="$emit('save')">保存并关闭</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { useModal } from '../../features/shell/useModal'
const props = defineProps<{ canSave: boolean; busy: boolean }>()
const emit = defineEmits<{ (e: 'discard'): void; (e: 'save'): void }>()
const { visible, dialogRef, open: openModal, close, handleKeydown: modalKeydown } = useModal()
function handleKeydown(event: KeyboardEvent) { if (props.busy) { event.preventDefault(); return }; modalKeydown(event) }
const name = ref('')
function open(documentName: string) { name.value = documentName; openModal() }
function discard() { close(); emit('discard') }
defineExpose({ open, close, visible })
</script>
<style scoped>
.discard-overlay { position: fixed; inset: 0; z-index: 1001; background: rgba(0,0,0,.45); display: grid; place-items: center; padding: 16px; }
.discard-dialog { width: min(440px, 100%); background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 22px; }
h2 { font-size: 16px; color: var(--bright); margin: 0 0 14px; }
p { overflow-wrap: anywhere; }
.actions { display: flex; gap: 10px; justify-content: flex-end; }
button { padding: 7px 12px; border-radius: 6px; background: var(--accentbg); color: var(--bright); }
.discard { background: var(--soft); }
</style>
