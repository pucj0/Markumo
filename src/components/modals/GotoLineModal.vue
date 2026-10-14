<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="goto-overlay"
      @click.self="close"
      @keydown.stop="handleKeydown"
    >
      <div ref="dialogRef" class="goto-box" role="dialog" aria-modal="true" aria-label="转到指定行">
        <div class="goto-head">
          <span>转到行 / 列</span>
          <span class="max-line">共 {{ maxLines }} 行</span>
        </div>
        <div class="goto-input-row">
          <input
            ref="inputRef"
            v-model="lineText"
            type="text"
            placeholder="行号:列号 (例如: 15 或 15:4)"
            class="goto-input"
            aria-label="行号与列号"
            @keydown.enter.prevent="submit($event)"
            @keydown.esc.prevent="close"
          />
        </div>
        <div class="goto-foot">
          <span class="tip">输入行号回车跳转 · Esc 取消</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useModal } from '../../features/shell/useModal'

defineProps<{
  maxLines: number
}>()

const emit = defineEmits<{
  (e: 'goto', payload: { line: number; column: number }): void
}>()

const { visible, dialogRef, open: openModal, close, handleKeydown } = useModal()
const lineText = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function open() {
  lineText.value = ''
  openModal()
}

function submit(event: KeyboardEvent) {
  if (event.isComposing) return
  const trimmed = lineText.value.trim()
  if (!trimmed) {
    close()
    return
  }

  const match = /^([1-9]\d*)(?::([1-9]\d*))?$/.exec(trimmed)
  if (match && Number.isSafeInteger(Number(match[1])) && Number.isSafeInteger(Number(match[2] || 1))) {
    emit('goto', { line: Number(match[1]), column: Number(match[2] || 1) })
    close()
  }
}

defineExpose({ open, close, visible })
</script>

<style scoped>
.goto-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(1px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 15vh;
  z-index: 1000;
}

.goto-box {
  width: 320px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.goto-head {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}

.max-line {
  font-family: var(--font-mono);
  font-size: 10px;
}

.goto-input-row {
  padding: 10px 12px;
}

.goto-input {
  width: 100%;
  background: var(--editor);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--bright);
  outline: none;
}

.goto-input:focus {
  border-color: var(--accent);
}

.goto-foot {
  height: 26px;
  background: var(--bar);
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 10px;
  color: var(--muted);
  border-top: 1px solid var(--line);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
