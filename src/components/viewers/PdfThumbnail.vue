<template>
  <div
    class="pdf-thumbnail-item"
    :class="{ active: isActive }"
    role="button"
    tabindex="0"
    :aria-label="`转到第 ${pageNumber} 页`"
    :aria-current="isActive ? 'page' : undefined"
    :data-page-number="pageNumber"
    @click="$emit('select', pageNumber)"
    @keydown.enter.prevent="$emit('select', pageNumber)"
    @keydown.space.prevent="$emit('select', pageNumber)"
  >
    <div
      class="pdf-thumbnail-card"
      :style="{
        width: `${cardWidth}px`,
        height: `${cardHeight}px`,
      }"
    >
      <img
        v-if="dataUrl"
        :src="dataUrl"
        class="pdf-thumbnail-img"
        :style="{
          width: `${cardWidth}px`,
          height: `${cardHeight}px`,
        }"
        alt=""
        draggable="false"
      />
      <div v-else-if="loading" class="pdf-thumbnail-placeholder loading">
        <span class="loading-spin">⟳</span>
      </div>
      <div v-else-if="error" class="pdf-thumbnail-placeholder error" title="缩略图生成失败">
        <span>⚠</span>
      </div>
      <div v-else class="pdf-thumbnail-placeholder pending" />
    </div>
    <div class="pdf-thumbnail-page-number">{{ pageNumber }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  pageNumber: number
  isActive?: boolean
  dataUrl?: string | null
  loading?: boolean
  error?: boolean
  aspectRatio?: number
  maxWidth?: number
}>(), {
  isActive: false,
  dataUrl: null,
  loading: false,
  error: false,
  aspectRatio: 612 / 792,
  maxWidth: 120,
})

defineEmits<{
  (e: 'select', pageNumber: number): void
}>()

const cardWidth = computed(() => {
  const maxW = props.maxWidth || 120
  const ratio = props.aspectRatio || (612 / 792)
  if (ratio > 1) {
    // Landscape
    return maxW
  }
  return Math.round(Math.min(maxW, 140 * ratio))
})

const cardHeight = computed(() => {
  const ratio = props.aspectRatio || (612 / 792)
  return Math.round(cardWidth.value / ratio)
})
</script>

<style scoped>
.pdf-thumbnail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background-color 0.1s ease;
  outline: none;
  box-sizing: border-box;
}

.pdf-thumbnail-item:hover {
  background: var(--hover);
}

.pdf-thumbnail-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.pdf-thumbnail-card {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--line);
  border-radius: 3px;
  background: #ffffff;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
  position: relative;
  box-sizing: border-box;
}

.pdf-thumbnail-item.active .pdf-thumbnail-card {
  box-shadow: 0 0 0 2px var(--accent), 0 2px 8px rgba(0, 0, 0, 0.18);
}

.pdf-thumbnail-img {
  display: block;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.pdf-thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bar);
  color: var(--muted);
  font-size: 13px;
}

.pdf-thumbnail-placeholder.error {
  color: var(--yellow);
}

.pdf-thumbnail-page-number {
  margin-top: 5px;
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.pdf-thumbnail-item.active .pdf-thumbnail-page-number {
  color: var(--accent);
  font-weight: 600;
}

.loading-spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
