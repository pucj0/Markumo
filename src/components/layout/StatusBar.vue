<template>
  <footer class="status">
    <div class="stat-group left">
      <span class="stat-item mode-item">
        <i class="dotstatus"></i>
        <span>{{ modeText }}</span>
      </span>
      <span class="stat-item dirty-item" :class="{ dirty: isDirty }">
        {{ isDirty ? '● 未保存修改' : 'Phase 1 · 只读示例' }}
      </span>
    </div>

    <div class="stat-group right">
      <span class="stat-item optional" title="编辑器未挂载">Ln —, Col —</span>
      <span class="stat-item optional">Spaces: 2（示例）</span>
      <span class="stat-item" :title="doc?.encoding || 'UTF-8'">{{ doc?.encoding || 'UTF-8' }}</span>
      <span class="stat-item">{{ doc?.eol || 'LF' }}</span>
      <button class="stat-item lang-item" disabled title="语言切换将在 Phase 2 实现">
        {{ doc?.language || 'Plain Text' }}
      </button>
      <span class="stat-item">{{ charCount }} 字符</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AppMode, EditorDocument } from '../../types'

const props = defineProps<{
  appMode: AppMode
  doc: EditorDocument | null
}>()

const modeText = computed(() => {
  return props.appMode === 'workspace' ? '工作区' : '单文件模式'
})

const isDirty = computed(() => {
  return props.doc?.dirty ?? false
})

const charCount = computed(() => {
  return props.doc?.content?.length?.toLocaleString() || '0'
})
</script>

<style scoped>
.status {
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  height: 24px;
  background: var(--bar);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 11px;
  color: var(--muted);
  flex: none;
}

@media (max-width: 950px) {
  .optional { display: none; }
  .stat-group { gap: 6px; }
}

.stat-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dotstatus {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
}

.dirty-item.dirty {
  color: var(--yellow);
}

.lang-item {
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
}

.lang-item:hover {
  background: var(--hover);
  color: var(--bright);
}
</style>
