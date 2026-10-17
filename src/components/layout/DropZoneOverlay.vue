<template>
  <div v-if="active" class="drop-zone-overlay" :class="`zone-${currentZone}`" aria-hidden="true">
    <div class="drop-highlight">
      <span class="drop-text">{{ zoneLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

const props = defineProps<{
  active: boolean
  zone: DropZone | null
  copy?: boolean
}>()

const currentZone = computed(() => props.zone || 'center')

const zoneLabel = computed(() => {
  switch (props.zone) {
    case 'left': return '在左侧分栏'
    case 'right': return '在右侧分栏'
    case 'top': return '在上方分栏'
    case 'bottom': return '在下方分栏'
    default: return props.copy ? '在此分栏打开视图' : '移入此分栏'
  }
})
</script>

<style scoped>
.drop-zone-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  padding: 8px;
  display: flex;
}

.drop-highlight {
  position: absolute;
  background: var(--accentbg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.1s ease-out;
}

.drop-text {
  font-size: var(--ui-font-size);
  font-weight: 500;
  color: var(--accent);
  background: var(--editor);
  padding: 5px 12px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.zone-center .drop-highlight {
  inset: 8px;
}

.zone-left .drop-highlight {
  top: 8px;
  bottom: 8px;
  left: 8px;
  width: calc(50% - 12px);
}

.zone-right .drop-highlight {
  top: 8px;
  bottom: 8px;
  right: 8px;
  width: calc(50% - 12px);
}

.zone-top .drop-highlight {
  top: 8px;
  left: 8px;
  right: 8px;
  height: calc(50% - 12px);
}

.zone-bottom .drop-highlight {
  bottom: 8px;
  left: 8px;
  right: 8px;
  height: calc(50% - 12px);
}
</style>
