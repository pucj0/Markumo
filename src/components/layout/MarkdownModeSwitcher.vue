<template>
  <div class="md-mode-switcher" role="group" aria-label="Markdown 显示模式">
    <button
      v-for="item in modes"
      :key="item.mode"
      type="button"
      class="md-mode-btn"
      :class="{ active: mode === item.mode }"
      :aria-pressed="mode === item.mode"
      :aria-label="`${item.label}模式`"
      :title="item.label"
      @click="$emit('change', item.mode)"
    >
      <Icon :name="item.icon" size="small" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { MarkdownMode } from '../../types'
import Icon from '../common/Icon.vue'

defineProps<{ mode: MarkdownMode }>()
defineEmits<{ (e: 'change', mode: MarkdownMode): void }>()

const modes: { mode: MarkdownMode; label: string; icon: string }[] = [
  { mode: 'live', label: '实时排版', icon: 'font' },
  { mode: 'source', label: '源码', icon: 'code' },
  { mode: 'split', label: '双栏', icon: 'split' },
]
</script>

<style scoped>
.md-mode-switcher {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--editor);
  border-radius: 6px;
}

.md-mode-btn {
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  color: var(--muted);
  font-size: var(--ui-small-font-size);
  font-family: var(--font-sans);
  padding: 0;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}

.md-mode-btn:hover,
.md-mode-btn:focus-visible {
  color: var(--ink);
  background: var(--hover);
}
.md-mode-btn:focus-visible { outline: 1px solid var(--accent); }
.md-mode-btn.active { color: var(--accent); background: var(--accentbg); }
.md-mode-btn .icon { width: 16px; height: 16px; }
</style>
