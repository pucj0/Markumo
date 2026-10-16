<template>
  <div class="shortcut-recorder-wrap" :class="{ 'is-recording': isRecording }">
    <!-- 1. 静止展示态 -->
    <template v-if="!isRecording">
      <div
        class="keycap-container"
        tabindex="0"
        role="button"
        :aria-label="`当前快捷键：${displayText}，点击开始录制`"
        title="点击开始录制快捷键"
        @click="startRecording"
        @keydown.enter.prevent="startRecording"
        @keydown.space.prevent="startRecording"
      >
        <template v-if="keycaps.length">
          <kbd v-for="(cap, idx) in keycaps" :key="idx" class="keycap">{{ cap }}</kbd>
        </template>
        <span v-else class="keycap-unset">未设置</span>
      </div>

      <div class="action-buttons">
        <button
          type="button"
          class="recorder-btn"
          title="修改快捷键"
          @click="startRecording"
        >
          修改
        </button>
        <button
          v-if="isModified"
          type="button"
          class="recorder-btn reset"
          title="恢复此命令的默认快捷键"
          @click="resetToDefault"
        >
          恢复默认
        </button>
      </div>
    </template>

    <!-- 2. 按键录制态 -->
    <template v-else>
      <div
        ref="recordingInputRef"
        class="recording-box"
        tabindex="0"
        role="textbox"
        aria-live="polite"
        aria-label="正在录制快捷键，请按下键盘组合键"
        @keydown.prevent.stop="onKeyDown"
        @keyup.prevent.stop="onKeyUp"
        @blur="onBlur"
      >
        <span class="recording-prompt">
          {{ draftKeycaps.length ? '' : '请按下新的快捷键…' }}
        </span>
        <template v-if="draftKeycaps.length">
          <kbd v-for="(cap, idx) in draftKeycaps" :key="idx" class="keycap active">{{ cap }}</kbd>
        </template>
      </div>

      <div class="action-buttons">
        <button
          type="button"
          class="recorder-btn clear"
          title="清除此快捷键 (Backspace)"
          @click="clearBinding"
        >
          清除
        </button>
        <button
          type="button"
          class="recorder-btn cancel"
          title="取消录制 (Esc)"
          @click="cancelRecording"
        >
          取消
        </button>
      </div>
    </template>

    <!-- 3. 冲突提示行 -->
    <div v-if="conflictInfo" class="conflict-alert" role="alert">
      <span class="conflict-msg">⚠️ {{ conflictInfo.description }}</span>
      <button
        v-if="conflictInfo.conflictType === 'exact-same-scope'"
        type="button"
        class="reassign-btn"
        title="解除原命令的快捷键并分配给当前命令"
        @click="reassignConflict"
      >
        重新分配
      </button>
      <button type="button" class="dismiss-btn" title="取消" @click="conflictInfo = null">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import {
  formatKeycaps,
  eventToKeybinding,
  checkBindingConflict,
  type KeybindingConflict,
} from '../../features/shell/keybindings'

const props = defineProps<{
  commandId: string
  binding?: string
  defaultBinding?: string
  allBindings: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'update:binding', val: string): void
  (e: 'reassign', payload: { newBinding: string; takeFromCommandId: string }): void
}>()

const isRecording = ref(false)
const recordingInputRef = ref<HTMLElement | null>(null)
const draftBinding = ref('')
const conflictInfo = ref<KeybindingConflict | null>(null)

const keycaps = computed(() => {
  return props.binding ? formatKeycaps(props.binding) : []
})

const draftKeycaps = computed(() => {
  return draftBinding.value ? formatKeycaps(draftBinding.value) : []
})

const displayText = computed(() => {
  return keycaps.value.length ? keycaps.value.join(' + ') : '未设置'
})

const isModified = computed(() => {
  return (props.binding || '') !== (props.defaultBinding || '')
})

function startRecording() {
  conflictInfo.value = null
  draftBinding.value = ''
  isRecording.value = true
  nextTick(() => {
    recordingInputRef.value?.focus()
  })
}

function cancelRecording() {
  isRecording.value = false
  draftBinding.value = ''
  conflictInfo.value = null
}

function clearBinding() {
  emit('update:binding', '')
  cancelRecording()
}

function resetToDefault() {
  emit('update:binding', props.defaultBinding || '')
  conflictInfo.value = null
}

function onBlur() {
  // 如果正在提示冲突，不强制关掉，允许点击重新分配
  if (conflictInfo.value) return
  cancelRecording()
}

function onKeyUp(event: KeyboardEvent) {
  // 仅修饰键松开时不做动作
  event.preventDefault()
  event.stopPropagation()
}

function onKeyDown(event: KeyboardEvent) {
  // 1. Esc 退出录制
  if (event.key === 'Escape') {
    cancelRecording()
    return
  }

  // 2. Backspace 或 Delete 清除绑定
  if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.altKey && !event.metaKey) {
    clearBinding()
    return
  }

  // 3. 拦截 IME
  if (event.isComposing) return

  // 4. 解析按键
  const newKey = eventToKeybinding(event)
  if (!newKey) {
    // 还在按纯修饰键
    return
  }

  draftBinding.value = newKey

  // 5. 冲突检测
  const conflict = checkBindingConflict(props.commandId, newKey, props.allBindings)
  if (conflict) {
    conflictInfo.value = conflict
    // 保留在录制/确认状态
    return
  }

  // 6. 无冲突，直接生效
  emit('update:binding', newKey)
  cancelRecording()
}

function reassignConflict() {
  if (conflictInfo.value && draftBinding.value) {
    emit('reassign', {
      newBinding: draftBinding.value,
      takeFromCommandId: conflictInfo.value.commandId,
    })
    cancelRecording()
  }
}
</script>

<style scoped>
.shortcut-recorder-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  position: relative;
  font-family: var(--font-sans);
}

.keycap-container {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 2px 6px;
  background: var(--editor);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
}

.keycap-container:hover,
.keycap-container:focus {
  border-color: var(--accent);
  background: var(--hover);
  outline: none;
}

.keycap {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bar);
  color: var(--ink);
  border: 1px solid var(--line);
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
}

.keycap.active {
  border-color: var(--accent);
  color: var(--bright);
  background: var(--accentbg);
}

.keycap-unset {
  font-size: 11px;
  color: var(--muted);
  font-style: italic;
  padding: 0 4px;
}

.action-buttons {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.recorder-btn {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--bar);
  color: var(--sub);
  cursor: pointer;
  transition: all 0.15s ease;
}

.recorder-btn:hover {
  background: var(--hover);
  color: var(--bright);
}

.recorder-btn.reset {
  color: var(--muted);
}
.recorder-btn.reset:hover {
  color: var(--accent);
}

.recording-box {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  min-width: 140px;
  padding: 2px 8px;
  background: var(--editor);
  border: 1px solid var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  border-radius: 4px;
  outline: none;
  cursor: default;
  animation: pulse-border 1.5s infinite;
}

.recording-prompt {
  font-size: 11px;
  color: var(--accent);
  white-space: nowrap;
}

@keyframes pulse-border {
  0% { box-shadow: 0 0 0 1px var(--accent); }
  50% { box-shadow: 0 0 0 2px rgba(156, 147, 244, 0.4); }
  100% { box-shadow: 0 0 0 1px var(--accent); }
}

.conflict-alert {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  margin-top: 4px;
  padding: 4px 8px;
  background: #3e2723;
  color: #ffccbc;
  border: 1px solid #d84315;
  border-radius: 4px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

:global(body.light) .conflict-alert {
  background: #fff3e0;
  color: #d84315;
  border-color: #ffab91;
}

.reassign-btn {
  padding: 1px 6px;
  font-size: 11px;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  color: inherit;
  cursor: pointer;
}

.reassign-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.dismiss-btn {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
}
</style>
