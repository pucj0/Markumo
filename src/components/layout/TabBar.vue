<template>
  <div ref="tabs" class="tabs" @wheel="scrollTabs" @dragover.prevent @drop.prevent.stop="dropTab">
    <div class="tablist">
      <div
        v-for="doc in docs"
        :key="doc.id"
        :data-document="doc.id"
        class="tab"
        draggable="true"
        @dragstart="dragTab($event, doc.id)"
        role="tab" tabindex="0" :aria-label="doc.name" :aria-selected="doc.id === activeId"
        @keydown.enter.prevent="$emit('select-tab', doc.id)"
        @keydown.space.prevent="$emit('select-tab', doc.id)"
        @auxclick.middle.prevent="$emit('close-tab', doc.id)"
        :class="{
          active: doc.id === activeId,
          temp: !doc.pinned
        }"
        :title="readablePath(doc.path)"
        @click="$emit('select-tab', doc.id)"
        @dblclick="$emit('pin-tab', doc.id)"
        @contextmenu.prevent.stop="openMenu($event,doc)"
        @keydown.shift.f10.prevent.stop="openMenu($event,doc)"
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
import type { EditorDocument } from '../../types'
import { readablePath } from '../../features/shell/pathDisplay'
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import ContextMenu from '../common/ContextMenu.vue'
import { CommandRegistry,menuCommand as cmd,separator } from '../../features/shell/menuModel'
import { textClipboard } from '../../features/shell/clipboard'

const props = withDefaults(defineProps<{
  docs: EditorDocument[]
  activeId: string | null
  pane?: 'main' | 'secondary'
  split?:boolean
}>(), { pane: 'main' })

const emit = defineEmits<{
  (e: 'select-tab', id: string): void
  (e: 'pin-tab', id: string): void
  (e: 'close-tab', id: string): void
  (e: 'new-doc'): void
  (e: 'move-tab', tab: { id: string; from: 'main' | 'secondary' }): void
  (e:'close-others',id:string):void
  (e:'split-tab',id:string):void
  (e:'move-other',id:string):void
  (e:'close-split'):void
}>()
const contextMenu=ref<InstanceType<typeof ContextMenu>|null>(null)
const tabs=ref<HTMLElement|null>(null)
let observer:ResizeObserver|undefined
async function revealActiveTab() {
  await nextTick()
  const container=tabs.value,active=Array.from(container?.querySelectorAll<HTMLElement>('.tab')||[]).find(tab=>tab.dataset.document===props.activeId)
  if(!container||!active)return
  const bounds=container.getBoundingClientRect(),rect=active.getBoundingClientRect()
  if(rect.left<bounds.left+8)container.scrollLeft+=rect.left-bounds.left-8
  else if(rect.right>bounds.right-8)container.scrollLeft+=rect.right-bounds.right+8
}
function scrollTabs(event:WheelEvent) {
  const container=tabs.value
  if(!container||event.ctrlKey||event.metaKey||event.deltaX||!event.deltaY||container.scrollWidth<=container.clientWidth)return
  const amount=event.deltaY*(event.deltaMode===1?26:event.deltaMode===2?container.clientWidth:1)
  container.scrollLeft+=amount;event.preventDefault()
}
watch(()=>[props.activeId,props.docs.map(doc=>doc.id).join('\n')],()=>{void revealActiveTab()},{immediate:true})
onMounted(()=>{observer=new ResizeObserver(()=>{void revealActiveTab()});if(tabs.value)observer.observe(tabs.value)})
onUnmounted(()=>observer?.disconnect())
function openMenu(event:MouseEvent|KeyboardEvent,doc:EditorDocument) {
  const registry=new CommandRegistry([
    {id:'tab-close',title:'关闭',enabled:true,run:()=>emit('close-tab',doc.id)},
    {id:'tab-close-others',title:'关闭其他标签',enabled:props.docs.length>1,run:()=>emit('close-others',doc.id)},
    {id:'tab-copy-path',title:'复制文件路径',enabled:!!doc.path,run:()=>textClipboard.writeText(doc.path)},
    {id:'tab-split',title:'在另一窗格中打开',enabled:true,run:()=>emit('split-tab',doc.id)},
    {id:'tab-move',title:'移动到另一窗格',enabled:true,run:()=>emit('move-other',doc.id)},
    {id:'tab-close-split',title:'关闭分栏',enabled:!!props.split,run:()=>emit('close-split')},
  ])
  contextMenu.value?.open(event,[cmd('tab-close'),cmd('tab-close-others'),separator('tab-path-section'),cmd('tab-copy-path'),separator('tab-split-section'),cmd('tab-split'),cmd('tab-move'),cmd('tab-close-split')],registry,'标签操作')
}
function dragTab(event: DragEvent, id: string) {
  event.dataTransfer?.setData('application/x-lightedit-tab', JSON.stringify({ id, from: props.pane }))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dropTab(event: DragEvent) {
  try {
    const tab = JSON.parse(event.dataTransfer?.getData('application/x-lightedit-tab') || '{}')
    if (typeof tab.id === 'string' && ['main', 'secondary'].includes(tab.from)) emit('move-tab', tab)
  } catch { /* Ignore foreign drag payloads. */ }
}

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
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  gap: 2px;
  flex: none;
}
.tabs::-webkit-scrollbar { display:none;height:0 }

.tablist {
  flex:none;
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
