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
        aria-label="快速打开与命令面板"
      >
        <div class="palette-search">
          <Icon name="search" />
          <input
            v-model="query"
            type="text"
            :placeholder="placeholder"
            autocomplete="off"
            aria-label="搜索文件或命令"
            @keydown.down="selectNext"
            @keydown.up="selectPrev"
            @keydown.enter="executeCurrent"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          />
          <span class="mode-tag">{{ modeLabel }}</span>
          <span class="kbd">Esc</span>
        </div>

        <div class="palette-rows" role="listbox" :aria-label="parsed.commandMode ? '命令结果' : '文件结果'">
          <button
            v-for="(result, index) in ranked"
            :key="result.item.id"
            class="palrow"
            :disabled="result.item.disabled"
            :class="{ on: index === selectedIndex }"
            role="option"
            :aria-selected="index === selectedIndex"
            :title="result.item.path || result.item.title"
            @mousemove="hover(index, $event)"
            @click="executeItem(result.item, false)"
          >
            <span class="title">
              <FileIcon v-if="result.item.fileName" :name="result.item.fileName" />
              <span class="label"><template v-for="(part, partIndex) in highlightSegments(result.item.title, result.titleRanges)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
            </span>
            <span class="meta">
              <span v-if="result.item.source === 'open'" class="source">已打开</span>
              <span v-else-if="result.item.source === 'recent'" class="source">最近</span>
              <span class="path"><template v-for="(part, partIndex) in highlightSegments(result.item.detail, result.detailRanges)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
            </span>
          </button>

          <div v-if="ranked.length === 0" class="empty-rows">
            {{ loading && parsed.mode !== 'commands' ? '正在索引工作区文件…' : '没有匹配的文件或命令' }}
          </div>
        </div>

        <div class="palfoot">
          <span v-if="positionLabel" class="position">{{ positionLabel }}</span>
          <span v-if="loading && parsed.mode !== 'commands'" class="loading">索引中…</span>
          <span class="hints">
            <span>↑↓ 选择</span>
            <span>Enter 打开</span>
            <span>Ctrl+Enter 固定</span>
            <span>Esc 关闭</span>
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useModal } from '../../features/shell/useModal'
import { parseQuickOpenQuery, rankPaletteItems, highlightSegments } from '../../features/shell/quickOpen'
import Icon from '../common/Icon.vue'
import FileIcon from '../common/FileIcon.vue'
import type { PaletteAction } from '../../types'

const props = defineProps<{
  items: PaletteAction[]
  loading?: boolean
}>()

const { visible, dialogRef, open: openModal, close, handleKeydown } = useModal()
const query = ref('')
const selectedIndex = ref(0)
const baseMode = ref<'action' | 'file' | 'all'>('file')
const composing = ref(false)

const exactFile = computed(() => {
  const value = query.value.trim()
  if (!/:\d+(?::\d+)?$/.test(value)) return false
  const key = value.replace(/\\/g, '/').toLowerCase()
  return props.items.some(item => item.category === 'file' && (
    (item.fileName || '').toLowerCase() === value.toLowerCase() ||
    (item.path || '').replace(/\\/g, '/').toLowerCase() === key
  ))
})
const parsed = computed(() => parseQuickOpenQuery(query.value, baseMode.value, exactFile.value))
const ranked = computed(() => rankPaletteItems(props.items, parsed.value, 100))
const placeholder = computed(() => {
  if (parsed.value.commandMode || baseMode.value === 'action') return '搜索命令…'
  if (baseMode.value === 'all') return '搜索文件或命令…'
  return '搜索文件，支持 文件:行:列…'
})
const modeLabel = computed(() => parsed.value.commandMode || baseMode.value === 'action' ? '命令' : baseMode.value === 'all' ? '全部' : '文件')
const positionLabel = computed(() => {
  if (!parsed.value.line || parsed.value.commandMode) return ''
  return parsed.value.column
    ? `第 ${parsed.value.line} 行，第 ${parsed.value.column} 列`
    : `第 ${parsed.value.line} 行`
})

let lastPointer = { x: -1, y: -1 }

function open(initialCategory: 'action' | 'file' | 'all' = 'file') {
  baseMode.value = initialCategory
  query.value = ''
  selectedIndex.value = ranked.value.findIndex(result => !result.item.disabled)
  composing.value = false
  lastPointer = { x: -1, y: -1 }
  openModal()
}

watch([query, baseMode], () => { selectedIndex.value = ranked.value.findIndex(result => !result.item.disabled) })
watch(ranked, items => {
  if (!items[selectedIndex.value] || items[selectedIndex.value].item.disabled) {
    selectedIndex.value = items.findIndex(result => !result.item.disabled)
  }
})
watch(selectedIndex, () => nextTick(() => {
  dialogRef.value?.querySelector('.palrow.on')?.scrollIntoView({ block: 'nearest' })
}))
onUnmounted(() => { composing.value = false })

function selectNext(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  event.preventDefault()
  moveSelection(1)
}

function selectPrev(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  event.preventDefault()
  moveSelection(-1)
}

function moveSelection(direction: 1 | -1) {
  const items = ranked.value
  for (let step = 1; step <= items.length; step++) {
    const index = (selectedIndex.value + direction * step + items.length) % items.length
    if (!items[index].item.disabled) { selectedIndex.value = index; return }
  }
  selectedIndex.value = -1
}

function executeCurrent(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  event.preventDefault()
  const result = ranked.value[selectedIndex.value]
  if (result) executeItem(result.item, event.ctrlKey || event.metaKey)
}

function executeItem(item: PaletteAction, pinned: boolean) {
  if (item.disabled) return
  const position = parsed.value
  close()
  try {
    const result = item.execute
      ? item.execute({
          pinned,
          line: position.commandMode ? undefined : position.line ?? undefined,
          column: position.commandMode ? undefined : position.column ?? undefined,
        })
      : item.action()
    if (result instanceof Promise) void result.catch(error => console.error('Quick Open action failed', error))
  } catch (error) {
    console.error('Quick Open action failed', error)
  }
}

function hover(index: number, event: MouseEvent) {
  if (ranked.value[index]?.item.disabled) return
  // A list scrolling under a stationary pointer must not steal the keyboard
  // selection. Only real pointer movement changes the active row.
  if ((!event.movementX && !event.movementY) || (event.clientX === lastPointer.x && event.clientY === lastPointer.y)) return
  lastPointer = { x: event.clientX, y: event.clientY }
  selectedIndex.value = index
}

defineExpose({ open, close, visible })
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 9vh;
  z-index: 999;
}

.palette {
  max-height: 72vh;
  width: 640px;
  max-width: 92vw;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.palette-search {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}

.palette-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  font-size: var(--ui-font-size);
  color: var(--bright);
  outline: none;
}

.mode-tag {
  flex: none;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
}

.palette-rows {
  min-height: 0;
  max-height: 46vh;
  overflow-y: auto;
  padding: 5px;
}

.palrow {
  gap: 12px;
  width: 100%;
  height: 32px;
  min-height: 32px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: var(--ui-font-size);
  color: var(--ink);
  transition: background 0.08s;
}
.title, .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.label { overflow: hidden; text-overflow: ellipsis; }

.palrow:hover,
.palrow.on {
  background: var(--hover);
  color: var(--bright);
}

.palrow.on {
  background: var(--soft);
}

.meta {
  flex: 0 1 45%;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ui-small-font-size);
  color: var(--muted);
  font-family: var(--font-mono);
}
.path { overflow: hidden; text-overflow: ellipsis; }
.source {
  flex: none;
  font-family: var(--font-sans);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 15px;
}

mark {
  color: var(--accent);
  background: var(--accentbg);
  border-radius: 2px;
}

.empty-rows {
  padding: 24px;
  text-align: center;
  font-size: var(--ui-font-size);
  color: var(--muted);
}

.palfoot {
  min-height: 30px;
  background: var(--bar);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  font-size: var(--ui-small-font-size);
  color: var(--muted);
}
.position { color: var(--accent); flex: none; }
.loading { flex: none; }
.hints { margin-left: auto; display: flex; gap: 12px; }

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
