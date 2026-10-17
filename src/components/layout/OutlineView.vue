<template>
  <div class="outline-container">
    <p v-if="notice" class="empty-text" role="status">{{ notice }}</p>
    <div v-if="items.length === 0" class="empty-outline">
      <p class="empty-text">
        {{ isMarkdown ? '当前 Markdown 文件未发现标题结构' : '当前文件未发现可提取的符号或大纲' }}
      </p>
    </div>

    <div v-else class="outline-list">
      <button
        v-for="item in visibleItems"
        :key="item.id"
        class="outline-item"
        :class="[`level-${item.level}`, item.kind]"
        :style="{ paddingLeft: `${(item.level - 1) * 12 + 10}px` }"
        :title="`跳转至第 ${item.lineNumber} 行: ${item.name}`"
        @click="$emit('select-item', item)"
      >
        <span v-if="hasChildren(item)" class="outline-fold" role="button" :aria-label="collapsed.has(item.id) ? '展开标题' : '折叠标题'" tabindex="0" @click.stop="toggle(item.id)" @keydown.enter.stop.prevent="toggle(item.id)" @keydown.space.stop.prevent="toggle(item.id)">{{ collapsed.has(item.id) ? '▸' : '▾' }}</span>
        <span v-if="item.kind && item.kind !== 'heading'" class="kind-badge">
          {{ item.kind.slice(0, 2).toUpperCase() }}
        </span>
        <span v-if="item.kind==='heading' && item.labelHtml" class="outline-label" v-html="item.labelHtml" />
        <span v-else class="outline-label">{{ item.name }}</span>
        <span class="outline-line">L{{ item.lineNumber }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OutlineItem } from '../../editor/outline/outlineService'
import { computed,ref } from 'vue'

const props=defineProps<{
  items: OutlineItem[]
  isMarkdown: boolean
  notice?: string
}>()
const collapsed=ref(new Set<string>())
const hasChildren=(item:OutlineItem)=>{const next=props.items[props.items.indexOf(item)+1];return !!next&&next.level>item.level}
function toggle(id:string){const next=new Set(collapsed.value);if(next.has(id))next.delete(id);else next.add(id);collapsed.value=next}
const visibleItems=computed(()=>{
  let hiddenLevel=Infinity
  return props.items.filter(item=>{
    if(item.level>hiddenLevel)return false
    hiddenLevel=collapsed.value.has(item.id)?item.level:Infinity
    return true
  })
})

defineEmits<{
  (e: 'select-item', item: OutlineItem): void
}>()
</script>

<style scoped>
.outline-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  font-size: var(--ui-font-size);
}

.empty-outline {
  padding: 24px 16px;
  text-align: center;
  color: var(--muted);
  font-size: var(--ui-small-font-size);
}

.outline-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.outline-item {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 12px;
  color: var(--ink);
  transition: background 0.1s;
  cursor: pointer;
  text-align: left;
}

.outline-item:hover {
  background: var(--hover);
  color: var(--bright);
}

.outline-label :deep(strong) {font-weight:700}
.outline-label :deep(em) {font-style:italic}
.outline-label :deep(s) {text-decoration:line-through}
.outline-label :deep(code) {font:90% var(--font-mono);padding:1px 3px;background:var(--soft);border-radius:3px}
.outline-item.heading.level-1 .outline-label {font-weight:600}

.kind-badge {
  font-size: var(--ui-small-font-size);
  background: var(--soft);
  color: var(--blue);
  padding: 1px 3px;
  border-radius: 3px;
  font-family: var(--font-mono);
}

.outline-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-line {
  font-size: var(--ui-small-font-size);
  color: var(--muted);
  font-family: var(--font-mono);
}
</style>
