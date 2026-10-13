<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="settingsoverlay"
      @click.self="close"
      @keydown.stop="handleKeydown"
    >
      <div
        class="settings"
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        aria-label="首选项设置"
      >
        <div class="settings-head">
          <h2>首选项</h2>
          <span class="sub-tip">Phase 1 UI 演示</span>
        </div>

        <div class="settings-content">
          <div class="settingrow">
            <span class="row-label">颜色主题</span>
            <select
              :value="theme"
              aria-label="颜色主题"
              class="setting-select"
              @change="$emit('update:theme', ($event.target as HTMLSelectElement).value as Theme)"
            >
              <option value="dark">深色 · Midnight</option>
              <option value="light">浅色 · Paper</option>
            </select>
          </div>

          <div class="settingrow">
            <span class="row-label">
              编辑器字号 <b>{{ fontSize }}px</b>
            </span>
            <input
              type="range"
              aria-label="编辑器字号"
              min="11"
              max="18"
              :value="fontSize"
              class="setting-range"
              @input="$emit('update:fontSize', Number(($event.target as HTMLInputElement).value))"
            />
          </div>

          <div class="settingrow">
            <span class="row-label">自动软换行</span>
            <input
              type="checkbox"
              aria-label="自动软换行"
              :checked="wordWrap"
              class="setting-check"
              @change="$emit('update:wordWrap', ($event.target as HTMLInputElement).checked)"
            />
          </div>

          <div class="settingrow">
            <span class="row-label">显示文档大纲</span>
            <input
              type="checkbox"
              aria-label="显示文档大纲占位"
              :checked="showOutline"
              class="setting-check"
              @change="$emit('update:showOutline', ($event.target as HTMLInputElement).checked)"
            />
          </div>

          <div class="settingrow">
            <span class="row-label">Markdown 默认模式</span>
            <select
              :value="defaultMdMode"
              disabled title="Markdown 模式将在 Phase 5 实现"
              aria-label="Markdown 默认模式（Phase 5 未实现）"
              class="setting-select"
              @change="$emit('update:defaultMdMode', ($event.target as HTMLSelectElement).value as MarkdownMode)"
            >
              <option value="live">即时排版 (Live)</option>
              <option value="source">源码 (Source)</option>
              <option value="split">双栏 (Split)</option>
            </select>
          </div>
        </div>

        <div class="settings-foot">
          <button class="close-btn" @click="close">完成</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useModal } from '../../features/shell/useModal'
import type { Theme, MarkdownMode } from '../../types'

defineProps<{
  theme: Theme
  fontSize: number
  wordWrap: boolean
  showOutline: boolean
  defaultMdMode: MarkdownMode
}>()

defineEmits<{
  (e: 'update:theme', val: Theme): void
  (e: 'update:fontSize', val: number): void
  (e: 'update:wordWrap', val: boolean): void
  (e: 'update:showOutline', val: boolean): void
  (e: 'update:defaultMdMode', val: MarkdownMode): void
}>()

const { visible, dialogRef, open, close, handleKeydown } = useModal()
defineExpose({ open, close, visible })
</script>

<style scoped>
.settingsoverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.settings {
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  width: 440px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  box-shadow: var(--shadow);
}

.settings-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 20px;
}

.settings-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--bright);
}

.sub-tip {
  font-size: 11px;
  color: var(--muted);
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settingrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--ink);
}

.row-label b {
  color: var(--accent);
  margin-left: 4px;
}

.setting-select {
  background: var(--editor);
  border: 1px solid var(--line);
  color: var(--ink);
  padding: 4px 8px;
  border-radius: 6px;
  outline: none;
}

.setting-range {
  accent-color: var(--accent);
  width: 140px;
}

.setting-check {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.settings-foot {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.close-btn {
  background: var(--accent);
  color: white;
  padding: 6px 18px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.close-btn:hover {
  opacity: 0.9;
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
