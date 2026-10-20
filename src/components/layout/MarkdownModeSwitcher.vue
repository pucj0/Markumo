<template>
  <div class="md-mode-switcher" role="group" aria-label="Markdown 显示模式" :style="{ '--md-mode-index': activeIndex }">
    <span class="md-mode-slider" aria-hidden="true"></span>
    <button
      v-for="item in modes"
      :key="item.mode"
      type="button"
      class="md-mode-btn"
      :class="{ active: mode === item.mode }"
      :aria-pressed="mode === item.mode"
      :aria-label="`${item.label}模式`"
      :title="item.label"
      :disabled="disabled"
      @mousedown.prevent
      @click="$emit('change', item.mode)"
    >
      <MarkdownToolbarIcon :name="item.icon" :size="16" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MarkdownMode } from '../../types'
import MarkdownToolbarIcon from './MarkdownToolbarIcon.vue'

const props = defineProps<{ mode: MarkdownMode; disabled?: boolean }>()
defineEmits<{ (e: 'change', mode: MarkdownMode): void }>()

const modes: { mode: MarkdownMode; label: string; icon: string }[] = [
  { mode: 'live', label: '实时排版', icon: 'live' },
  { mode: 'source', label: '源码', icon: 'source' },
  { mode: 'split', label: '双栏', icon: 'split' },
]
const activeIndex = computed(() => Math.max(0, modes.findIndex(item => item.mode === props.mode)))
</script>

<style scoped>
.md-mode-switcher {
  --md-mode-cell: 30px;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, var(--md-mode-cell));
  flex: none;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--soft);
}
.md-mode-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: var(--md-mode-cell);
  height: 28px;
  border-radius: 4px;
  background: var(--editor);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
  transform: translateX(calc(var(--md-mode-index, 0) * var(--md-mode-cell)));
  transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
  pointer-events: none;
}
.md-mode-btn {
  position: relative;
  z-index: 1;
  display: inline-grid;
  place-items: center;
  width: var(--md-mode-cell);
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--sub);  cursor: pointer;
  transition: color 120ms ease;
}
.md-mode-btn:hover,
.md-mode-btn:focus-visible { color: var(--ink); }
.md-mode-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.md-mode-btn.active { color: var(--accent); }
.md-mode-btn:disabled { opacity: .42; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .md-mode-slider { transition: none; }
}
</style>
