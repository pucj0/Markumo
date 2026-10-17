<template>
  <div ref="tabs" class="tabs" @wheel="scrollTabs">
    <div class="tablist">
      <div
        v-for="doc in docs"
        :key="doc.id"
        :data-document="doc.id"
        class="tab"
        draggable="false"
        @pointerdown="onTabPointerDown($event, doc)"
        @dragstart.prevent
        role="tab" tabindex="0" :aria-label="doc.name" :aria-selected="doc.id === activeId"
        @keydown.enter.prevent="$emit('select-tab', doc.id)"
        @keydown.space.prevent="$emit('select-tab', doc.id)"
        @auxclick.middle.prevent="$emit('close-tab', doc.id)"
        :class="{
          active: doc.id === activeId,
          temp: !doc.pinned,
          pinned: doc.pinned,
          'drop-before': isDragInsertingBefore(doc.id),
          'drop-after': isDragInsertingAfter(doc.id),
          'is-dragging': tabDragService.isDragging.value && tabDragService.dragPayload.value?.fromPaneId === pane && tabDragService.dragPayload.value?.documentId === doc.id
        }"
        :title="readablePath(doc.path)"
        @click="$emit('select-tab', doc.id)"
        @dblclick="$emit('pin-tab', doc.id)"
        @contextmenu.prevent.stop="openMenu($event, doc)"
        @keydown.shift.f10.prevent.stop="openMenu($event, doc)"
      >
        <FileIcon :name="doc.name" />
        <span class="filename">{{ doc.name }}</span>
        <span v-if="doc.dirty || !doc.path" class="unsaved" :title="doc.dirty ? '未保存修改' : '尚未保存'"></span>
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
      title="新建草稿"
      @click="$emit('new-doc')"
    >
      <Icon name="plus" size="small" />
    </button>

    <ContextMenu ref="contextMenu" />
  </div>
</template>

<script setup lang="ts">
import Icon from '../common/Icon.vue'
import FileIcon from '../common/FileIcon.vue'
import type { EditorDocument } from '../../types'
import { readablePath } from '../../features/shell/pathDisplay'
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import ContextMenu from '../common/ContextMenu.vue'
import { CommandRegistry, menuCommand as cmd, separator, type MenuNode } from '../../features/shell/menuModel'
import { textClipboard } from '../../features/shell/clipboard'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { tabDragService } from '../../editor/layout/TabDragService'

const props = withDefaults(defineProps<{
  docs: EditorDocument[]
  activeId: string | null
  pane?: string
  split?: boolean
  manager?: DocumentManager
  desktop?: boolean
  rootPath?: string | null
}>(), { pane: 'main', desktop: false })

const emit = defineEmits<{
  (e: 'select-tab', id: string): void
  (e: 'pin-tab', id: string): void
  (e: 'unpin-tab', id: string): void
  (e: 'close-tab', id: string): void
  (e: 'close-others', id: string): void
  (e: 'close-right', id: string): void
  (e: 'close-all'): void
  (e: 'new-doc'): void
  (e: 'split-tab', payload: { id: string; direction: 'left' | 'right' | 'top' | 'bottom'; duplicate?: boolean }): void
  (e: 'move-other', id: string): void
  (e: 'move-pane', payload: { id: string; toPane: string }): void
  (e: 'close-pane'): void
  (e: 'close-split'): void
  (e: 'merge-splits'): void
  (e: 'reveal-in-explorer', token: string): void
}>()

const contextMenu = ref<InstanceType<typeof ContextMenu> | null>(null)
const tabs = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined

const isDragInsertingBefore = (docId: string) => {
  const insert = tabDragService.activeTabInsert.value
  return !!(insert && insert.paneId === props.pane && insert.targetDocId === docId && insert.position === 'before')
}

const isDragInsertingAfter = (docId: string) => {
  const insert = tabDragService.activeTabInsert.value
  return !!(insert && insert.paneId === props.pane && insert.targetDocId === docId && insert.position === 'after')
}

function onTabPointerDown(event: PointerEvent, doc: EditorDocument) {
  if ((event.target as HTMLElement).closest('.tinyclose') || event.button !== 0) return
  tabDragService.startWatching(
    event,
    {
      documentId: doc.id,
      fromPaneId: props.pane,
      documentName: doc.name,
    },
    result => {
      const manager = props.manager
      if (!manager) return
      const { documentId, fromPaneId, isCopy } = result.payload
      let transferred = false
      if (result.paneDrop) {
        const { paneId, zone } = result.paneDrop
        transferred = manager.transferTab(documentId, fromPaneId, paneId, {
          copy: isCopy,
          direction: zone === 'center' ? undefined : zone,
        })
      } else if (result.tabInsert) {
        const { paneId, targetDocId, position } = result.tabInsert
        const targetGroup = manager.layout.getPane(paneId)?.group
        let targetIdx = targetGroup ? targetGroup.tabs.findIndex(t => t.documentId === targetDocId) : -1
        if (targetIdx >= 0 && position === 'after') targetIdx += 1
        transferred = manager.transferTab(documentId, fromPaneId, paneId, {
          copy: isCopy,
          targetIndex: targetIdx >= 0 ? targetIdx : targetGroup?.tabs.length,
        })
      }
      if (transferred) void nextTick(() => manager.focusPane(manager.activePaneId))
    }
  )
}

async function revealActiveTab() {
  await nextTick()
  const container = tabs.value
  const active = Array.from(container?.querySelectorAll<HTMLElement>('.tab') || []).find(tab => tab.dataset.document === props.activeId)
  if (!container || !active) return
  const bounds = container.getBoundingClientRect(), rect = active.getBoundingClientRect()
  if (rect.left < bounds.left + 8) container.scrollLeft += rect.left - bounds.left - 8
  else if (rect.right > bounds.right - 8) container.scrollLeft += rect.right - bounds.right + 8
}

function scrollTabs(event: WheelEvent) {
  const container = tabs.value
  if (!container || event.ctrlKey || event.metaKey || event.deltaX || !event.deltaY || container.scrollWidth <= container.clientWidth) return
  const amount = event.deltaY * (event.deltaMode === 1 ? 26 : event.deltaMode === 2 ? container.clientWidth : 1)
  container.scrollLeft += amount
  event.preventDefault()
}

// Focus and cursor updates also refresh document metadata. Compare the values
// separately so those updates cannot scroll the old active tab under a click.
watch([() => props.activeId, () => props.docs.map(doc => doc.id).join('\n')], () => { void revealActiveTab() }, { immediate: true })

onMounted(() => {
  observer = new ResizeObserver(() => { void revealActiveTab() })
  if (tabs.value) observer.observe(tabs.value)
})
onUnmounted(() => observer?.disconnect())

function openMenu(event: MouseEvent | KeyboardEvent, doc: EditorDocument) {
  const currentIndex = props.docs.findIndex(d => d.id === doc.id)
  const hasMultiple = props.docs.length > 1
  const hasRightTabs = currentIndex >= 0 && currentIndex < props.docs.length - 1
  const isSplit = !!props.split
  const otherPanes = props.manager ? props.manager.layout.getAllLeafIds().filter(id => id !== props.pane) : []

  const commands = [
    { id: 'tab-close', title: '关闭', enabled: true, run: () => emit('close-tab', doc.id) },
    { id: 'tab-close-others', title: '关闭其他标签', enabled: hasMultiple, run: () => emit('close-others', doc.id) },
    { id: 'tab-close-right', title: '关闭右侧标签', enabled: hasRightTabs, run: () => emit('close-right', doc.id) },
    { id: 'tab-close-all', title: '关闭全部标签', enabled: props.docs.length > 0, run: () => emit('close-all') },

    doc.pinned
      ? { id: 'tab-unpin', title: '取消固定', enabled: !doc.dirty, run: () => emit('unpin-tab', doc.id) }
      : { id: 'tab-pin', title: '固定标签', enabled: true, run: () => emit('pin-tab', doc.id) },

    { id: 'tab-open-copy-right', title: '在右侧分栏打开副本', enabled: true, run: () => emit('split-tab', { id: doc.id, direction: 'right', duplicate: true }) },
    { id: 'tab-open-copy-down', title: '在下方分栏打开副本', enabled: true, run: () => emit('split-tab', { id: doc.id, direction: 'bottom', duplicate: true }) },
    { id: 'tab-move-right', title: '移动到右侧分栏', enabled: true, run: () => emit('split-tab', { id: doc.id, direction: 'right', duplicate: false }) },
    { id: 'tab-move-down', title: '移动到下方分栏', enabled: true, run: () => emit('split-tab', { id: doc.id, direction: 'bottom', duplicate: false }) },

    { id: 'tab-split-left', title: '向左拆分', enabled: true, run: () => emit('split-tab', { id: doc.id, direction: 'left', duplicate: false }) },
    { id: 'tab-split-up', title: '向上拆分', enabled: true, run: () => emit('split-tab', { id: doc.id, direction: 'top', duplicate: false }) },

    { id: 'tab-move-other', title: '移动到另一分栏', enabled: isSplit, run: () => emit('move-other', doc.id) },
    ...otherPanes.map(targetPaneId => ({
      id: `tab-move-to-${targetPaneId}`,
      title: `移动到分栏 (${targetPaneId})`,
      enabled: true,
      run: () => emit('move-pane', { id: doc.id, toPane: targetPaneId })
    })),

    { id: 'tab-close-pane', title: '关闭当前分栏', enabled: isSplit, run: () => emit('close-pane') },
    { id: 'tab-merge-splits', title: '合并全部分栏', enabled: isSplit, run: () => emit('merge-splits') },

    { id: 'tab-copy-path', title: '复制文件完整路径', enabled: !!doc.path, run: () => textClipboard.writeText(doc.path) },
    { id: 'tab-copy-relative', title: '复制文件相对路径', enabled: !!doc.path, run: () => {
      let rel = doc.path
      if (props.rootPath && rel.toLowerCase().startsWith(props.rootPath.toLowerCase())) {
        rel = rel.slice(props.rootPath.length).replace(/^[\\/]/, '')
      }
      textClipboard.writeText(rel)
    }},
    { id: 'tab-reveal-explorer', title: '在系统文件管理器中显示', enabled: !!doc.fileToken && props.desktop, run: () => {
      if (doc.fileToken) emit('reveal-in-explorer', doc.fileToken)
    }},
  ]

  const registry = new CommandRegistry(commands)

  const otherSplits: MenuNode[] = [
    cmd('tab-split-left'),
    cmd('tab-split-up'),
  ]

  const menuNodes: MenuNode[] = [
    cmd('tab-close'),
    cmd('tab-close-others'),
    cmd('tab-close-right'),
    cmd('tab-close-all'),
    separator('tab-close-section'),
    cmd(doc.pinned ? 'tab-unpin' : 'tab-pin'),
    separator('tab-pin-section'),
    cmd('tab-open-copy-right'),
    cmd('tab-open-copy-down'),
    cmd('tab-move-right'),
    cmd('tab-move-down'),
    { type: 'submenu', id: 'tab-split-other-submenu', label: '其他方向拆分', children: otherSplits },
    ...(otherPanes.length > 1
      ? [{
          type: 'submenu' as const,
          id: 'tab-move-submenu',
          label: '移动到已有分栏',
          children: otherPanes.map(pid => cmd(`tab-move-to-${pid}`))
        }]
      : isSplit ? [cmd('tab-move-other')] : []),
    cmd('tab-close-pane'),
    cmd('tab-merge-splits'),
    separator('tab-layout-section'),
    cmd('tab-copy-path'),
    cmd('tab-copy-relative'),
    cmd('tab-reveal-explorer'),
  ]

  contextMenu.value?.open(event, menuNodes, registry, '标签操作')
}

</script>

<style scoped>
.tabs {
  height: calc(var(--ui-font-size) + 26px);
  background: var(--bar);
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 0 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  gap: 2px;
  flex: none;
  position: relative;
}
.tabs::-webkit-scrollbar { display: none; height: 0 }

.tablist {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  overflow: visible;
}

.tab {
  flex: none;
  touch-action: none;
  height: var(--ui-control-height);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  color: var(--muted);
  font-size: var(--ui-font-size);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.12s;
  white-space: nowrap;
  position: relative;
  user-select: none;
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

.tab.is-dragging {
  opacity: 0.4;
}

.tab.temp .filename {
  font-style: italic;
}

.tab.temp:has(.unsaved) .filename {
  font-style: normal;
}

.tab.drop-before::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.tab.drop-after::after {
  content: '';
  position: absolute;
  right: -2px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
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
  width: var(--ui-row-height);
  height: var(--ui-row-height);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--ui-small-font-size);
  color: var(--muted);
  border: none;
  background: transparent;
  cursor: pointer;
}
.tinyclose:hover {
  background: var(--line);
  color: var(--bright);
}

.newtab {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  flex: none;
  margin-left: 2px;
}
.newtab:hover {
  background: var(--hover);
  color: var(--bright);
}

</style>
