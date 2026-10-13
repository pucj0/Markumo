<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="overlay"
      @click.self="close"
      @keydown.stop="handleKeydown"
    >
      <div
        class="palette"
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        aria-label="命令与快速打开面板"
      >
        <div class="palette-search">
          <Icon name="search" />
          <input
            v-model="query"
            type="text"
            placeholder="输入文件名或操作命令…"
            autocomplete="off"
            aria-label="搜索示例文件或命令"
            @keydown.down="selectNext"
            @keydown.up="selectPrev"
            @keydown.enter="executeCurrent"
          />
          <span class="kbd">Esc</span>
        </div>

        <div class="palette-rows">
          <button
            v-for="(item, index) in filteredItems"
            :key="item.id"
            class="palrow"
            :class="{ on: index === selectedIndex }"
            @mouseenter="selectedIndex = index"
            @click="executeItem(item)"
          >
            <span class="title">{{ item.title }}</span>
            <span class="meta">{{ item.detail }}</span>
          </button>

          <div v-if="filteredItems.length === 0" class="empty-rows">
            没有符合条件的操作或文件
          </div>
        </div>

        <div class="palfoot">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useModal } from '../../features/shell/useModal'
import Icon from '../common/Icon.vue'
import type { PaletteAction } from '../../types'

const props = defineProps<{
  items: PaletteAction[]
}>()

const { visible, dialogRef, open: openModal, close, handleKeydown } = useModal()
const query = ref('')
const selectedIndex = ref(0)

const currentCategory = ref<'action' | 'file' | 'all'>('all')

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  let pool = props.items
  if (currentCategory.value !== 'all') {
    pool = pool.filter(x => x.category === currentCategory.value)
  }
  if (!q) return pool.slice(0, 16)
  return pool
    .filter(x => (x.title + ' ' + x.detail).toLowerCase().includes(q))
    .slice(0, 16)
})

function open(initialCategory: 'action' | 'file' | 'all' = 'all') {
  openModal()
  currentCategory.value = initialCategory
  query.value = ''
  selectedIndex.value = 0
}

watch(filteredItems, () => { selectedIndex.value = 0 })
watch(selectedIndex, () => nextTick(() => {
  dialogRef.value?.querySelector('.palrow.on')?.scrollIntoView({ block: 'nearest' })
}))

function selectNext(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  if (filteredItems.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
}

function selectPrev(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  if (filteredItems.value.length === 0) return
  selectedIndex.value = (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length
}

function executeCurrent(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  const item = filteredItems.value[selectedIndex.value]
  if (item) {
    executeItem(item)
  }
}

function executeItem(item: PaletteAction) {
  close()
  item.action()
}

defineExpose({ open, close, visible })
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 10vh;
  z-index: 999;
}

.palette {
  max-height: 80vh;
  width: 580px;
  max-width: 90vw;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.palette-search {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}

.palette-search input {
  flex: 1;
  background: transparent;
  border: none;
  font-size: 14px;
  color: var(--bright);
  outline: none;
}

.palette-rows {
  min-height: 0;
  max-height: 340px;
  overflow-y: auto;
  padding: 6px;
}

.palrow {
  gap: 12px;
  width: 100%;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 13px;
  color: var(--ink);
  transition: background 0.1s;
}
.title, .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title { flex-shrink: 0; }

.palrow:hover,
.palrow.on {
  background: var(--hover);
  color: var(--bright);
}

.palrow.on {
  background: var(--soft);
}

.meta {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
}

.empty-rows {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.palfoot {
  height: 32px;
  background: var(--bar);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 0 16px;
  font-size: 11px;
  color: var(--muted);
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
