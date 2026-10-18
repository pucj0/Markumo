<template>
  <div class="pdf-outline-node">
    <div
      class="pdf-outline-item-row"
      :class="{
        active: isActive,
        'has-children': hasChildren,
        [`depth-${depth}`]: true
      }"
      :style="{ paddingLeft: `${Math.min(depth, 8) * 12 + 6}px` }"
      role="treeitem"
      :aria-expanded="hasChildren ? isExpanded : undefined"
      :aria-selected="isActive"
      :aria-label="item.title"
      :title="item.title"
      tabindex="0"
      @click="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.right.prevent="handleRight"
      @keydown.left.prevent="handleLeft"
    >
      <span
        v-if="hasChildren"
        class="pdf-outline-twisty"
        role="button"
        :aria-label="isExpanded ? '折叠' : '展开'"
        @click.stop="toggleExpand"
      >
        <ViewerIcon :name="isExpanded ? 'chevron-down' : 'chevron-right'" />
      </span>
      <span v-else class="pdf-outline-twisty-placeholder" aria-hidden="true" />

      <span class="pdf-outline-title">{{ item.title }}</span>
      <span v-if="pageNumber" class="pdf-outline-page">{{ pageNumber }}</span>
    </div>

    <div v-if="hasChildren && isExpanded" class="pdf-outline-children" role="group">
      <PdfOutlineItemView
        v-for="child in item.items"
        :key="child.id"
        :item="child"
        :depth="depth + 1"
        :active-id="activeId"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ViewerIcon from './ViewerIcon.vue'

export interface OutlineNode {
  id: string
  title: string
  dest?: any
  url?: string
  items?: OutlineNode[]
  pageNumber?: number
}

const props = withDefaults(defineProps<{
  item: OutlineNode
  depth?: number
  activeId?: string | null
}>(), {
  depth: 0,
  activeId: null,
})

const emit = defineEmits<{
  (e: 'select', item: OutlineNode): void
}>()

const isExpanded = ref(true)
const hasChildren = computed(() => !!(props.item.items && props.item.items.length > 0))
const isActive = computed(() => props.activeId === props.item.id)
const pageNumber = computed(() => props.item.pageNumber)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function handleClick() {
  emit('select', props.item)
}

function handleRight() {
  if (hasChildren.value && !isExpanded.value) {
    isExpanded.value = true
  }
}

function handleLeft() {
  if (hasChildren.value && isExpanded.value) {
    isExpanded.value = false
  }
}
</script>

<style scoped>
.pdf-outline-node {
  user-select: none;
}

.pdf-outline-item-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ink);
  font-size: var(--ui-small-font-size);
  transition: background-color 0.1s ease, color 0.1s ease;
  outline: none;
}

.pdf-outline-item-row:hover {
  background: var(--hover);
  color: var(--bright);
}

.pdf-outline-item-row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.pdf-outline-item-row.active {
  background: var(--accentbg);
  color: var(--accent);
  font-weight: 500;
}

.pdf-outline-twisty {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--muted);
  border-radius: 3px;
  cursor: pointer;
}

.pdf-outline-twisty:hover {
  background: var(--hover);
  color: var(--bright);
}

.pdf-outline-twisty-placeholder {
  width: 16px;
  height: 16px;
  flex: none;
}

.pdf-outline-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdf-outline-page {
  flex: none;
  margin-left: 6px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.pdf-outline-item-row.active .pdf-outline-page {
  color: var(--accent);
}
</style>
