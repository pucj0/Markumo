<template>
  <footer class="status">
    <div class="stat-group left">
      <span class="stat-item file-path" :title="doc?.path || doc?.name || '未打开文件'" aria-label="当前文件路径">{{ doc?.path || doc?.name || '未打开文件' }}</span>
      <span class="stat-item dirty-item" :class="{ dirty: isDirty }">
        {{ isDirty ? '● 未保存修改' : doc?.fileToken ? '已保存' : doc ? '未保存' : '' }}
      </span>
      <span v-if="doc?.readOnly" class="stat-item" title="原路径不可写，可另存为">不可写</span>
    </div>

    <div class="stat-group right">
      <span class="stat-item position">Ln {{ doc?.line || 1 }}, Col {{ doc?.column || 1 }}</span>
      <span class="stat-item optional">{{ useTabs ? 'Tabs' : 'Spaces' }}: {{ indentSize }}</span>
      <span class="stat-item" :title="doc?.encoding || 'UTF-8'">{{ doc?.encoding || 'UTF-8' }}{{ doc?.bom ? ' BOM' : '' }}</span>
      <span class="stat-item">{{ doc?.eol || 'LF' }}</span>
      <select class="stat-item lang-item" aria-label="语言模式" :disabled="!doc" :value="doc?.language || 'Plain Text'"
        @change="$emit('set-language', ($event.target as HTMLSelectElement).value as LanguageName)">
        <option v-for="language in languageNames" :key="language" :value="language">{{ language }}</option>
      </select>
      <span v-if="doc?.languageStatus === 'loading'" class="optional">加载中…</span>
      <span class="stat-item">{{ charCount }} 字符</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EditorDocument } from '../../types'
import { languageNames, type LanguageName } from '../../editor/languages'
defineEmits<{ (e: 'set-language', language: LanguageName): void }>()

const props = defineProps<{
  doc: EditorDocument | null
  indentSize: number
  useTabs: boolean
}>()

const isDirty = computed(() => {
  return props.doc?.dirty ?? false
})

const charCount = computed(() => {
  return props.doc?.charCount.toLocaleString() || '0'
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

.stat-group.left { min-width: 0; flex: 1; }
.stat-group.right { flex: none; }
.file-path { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dirty-item { flex: none; }

.dirty-item.dirty {
  color: var(--yellow);
}

.lang-item {
  background: var(--bar);
  border: 0;
  max-width: 120px;
  font-size: inherit;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
}
@media (max-width: 720px) { .dirty-item, .position { display: none; } .stat-group { gap: 6px; } }

.lang-item:hover {
  background: var(--hover);
  color: var(--bright);
}
</style>
