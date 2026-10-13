<template>
  <div class="tabs">
    <div class="tablist">
      <div
        v-for="doc in docs"
        :key="doc.id"
        class="tab"
        role="tab" tabindex="0" :aria-selected="doc.id === activeId"
        @keydown.enter.prevent="$emit('select-tab', doc.id)"
        @keydown.space.prevent="$emit('select-tab', doc.id)"
        @auxclick.middle.prevent="$emit('close-tab', doc.id)"
        :class="{
          active: doc.id === activeId,
          temp: !doc.pinned
        }"
        :title="doc.path"
        @click="$emit('select-tab', doc.id)"
        @dblclick="$emit('pin-tab', doc.id)"
      >
        <span class="fileext" :class="getExt(doc.name)">
          {{ getExt(doc.name).slice(0, 2) }}
        </span>
        <span class="filename">{{ doc.name }}</span>
        <span v-if="doc.dirty" class="unsaved"></span>
        <button
          class="tinyclose"
          :title="`关闭 ${doc.name}`"
          :aria-label="`关闭 ${doc.name}`"
          @click.stop="$emit('close-tab', doc.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <button
      class="newtab"
      title="新建草稿 (Ctrl+N)"
      @click="$emit('new-doc')"
    >
      <Icon name="plus" size="small" />
    </button>
  </div>
</template>

<script setup lang="ts">
import Icon from '../common/Icon.vue'
import type { EditorDocument } from '../../types'

defineProps<{
  docs: EditorDocument[]
  activeId: string | null
}>()

defineEmits<{
  (e: 'select-tab', id: string): void
  (e: 'pin-tab', id: string): void
  (e: 'close-tab', id: string): void
  (e: 'new-doc'): void
}>()

function getExt(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? (parts.pop()?.toLowerCase() || 'txt') : 'txt'
}
</script>

<style scoped>
.tabs {
  height: 38px;
  background: var(--bar);
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 0 8px;
  overflow-x: auto;
  gap: 2px;
  flex: none;
}

.tablist {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
}

.tab {
  height: 30px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
  white-space: nowrap;
}

.tab:hover {
  background: var(--hover);
  color: var(--ink);
}

.tab.active {
  background: var(--editor);
  color: var(--bright);
  border-color: var(--line);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.tab.temp .filename {
  font-style: italic;
}

.filename {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unsaved {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--yellow);
  flex: none;
}

.tinyclose {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--muted);
  opacity: 0.6;
  margin-left: 2px;
}

.tinyclose:hover {
  background: var(--hover);
  opacity: 1;
  color: var(--bright);
}

.newtab {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  margin-left: 4px;
}

.newtab:hover {
  background: var(--hover);
  color: var(--bright);
}
</style>
