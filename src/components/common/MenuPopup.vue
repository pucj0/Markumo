<template>
  <Teleport to="body">
    <div v-for="(panel, level) in panels" :key="level" :ref="el => { elements[level] = el as HTMLElement }" class="app-menu-popup" :class="{ submenu: level > 0 }" data-menu-popup role="menu" tabindex="-1" :aria-label="panel.title" :style="positions[level] || { visibility:'hidden' }" @scroll="align" @mouseenter="cancelHover" @mousedown.prevent.stop @keydown.stop="keydown($event, level)">
      <template v-for="item in panel.items" :key="item.id">
        <div v-if="item.type === 'separator'" class="menu-separator" role="separator"></div>
        <button v-else :data-node="item.id" :role="item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem'" :aria-label="item.title" :aria-checked="item.checked" :aria-haspopup="item.children ? 'menu' : undefined" :aria-expanded="item.children ? path[level] === item.id : undefined" :disabled="!item.enabled" :title="item.detail" @mouseenter="hover(item, level, $event)" @click="activate(item, level, $event.currentTarget as HTMLElement)">
          <span class="menu-check" aria-hidden="true">{{ item.checked ? item.type === 'radio' ? '●' : '✓' : '' }}</span><span class="menu-label">{{ item.title }}</span><kbd v-if="item.shortcut">{{ shortcutLabel(item.shortcut) }}</kbd><span v-if="item.children" class="menu-arrow" aria-hidden="true">›</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { resolveMenu, type CommandRegistry, type MenuNode, type ResolvedMenuNode } from '../../features/shell/menuModel'
import { shortcutLabel } from '../../features/shell/editorSettings'
type Anchor = { left:number; right:number; top:number; bottom:number }
const props = defineProps<{ nodes: MenuNode[]; registry: CommandRegistry; anchor: Anchor; title: string; focus?: boolean }>()
const emit = defineEmits<{ (e:'execute',id:string):void; (e:'close',restore:boolean):void; (e:'switch-root',direction:number):void }>()
const path = ref<string[]>([]), positions = ref<Record<string,string>[]>([]), elements: HTMLElement[] = [], anchors: HTMLElement[] = []
let hoverTimer: ReturnType<typeof setTimeout> | undefined, observer: ResizeObserver | undefined, alive = true
const instance = Symbol('menu-popup')
const observed = new Set<HTMLElement>()
function anotherMenu(event: Event) { if ((event as CustomEvent).detail !== instance) emit('close',false) }
const panels = computed(() => {
  const panels = [{title:props.title,items:resolveMenu(props.nodes,props.registry)}]
  for (const id of path.value) {
    const node = panels[panels.length - 1].items.find(item => item.id === id)
    if (!node?.children || !node.enabled) break
    panels.push({title:node.title,items:node.children})
  }
  return panels
})
function cancelHover() { if (hoverTimer) clearTimeout(hoverTimer); hoverTimer = undefined }
function buttons(level: number) { return Array.from(elements[level]?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []) }
function focusFirst(level: number) { (buttons(level)[0] || elements[level])?.focus() }
async function align() {
  await nextTick(); if (!alive) return
  const currentElements = new Set(elements.slice(0,panels.value.length).filter(Boolean))
  for (const old of observed) if (!currentElements.has(old)) { observer?.unobserve(old); observed.delete(old) }
  const result: Record<string,string>[] = [], rectangles: {left:number;right:number;top:number}[] = []
  for (let level = 0; level < panels.value.length; level++) {
    const element = elements[level]; if (!element) continue
    if (!observed.has(element)) { observer?.observe(element); observed.add(element) }
    // A menubar popup keeps the header reachable even in a short window.
    // Context menus have a point anchor and may flip above it instead.
    const belowHeader = !level && props.anchor.bottom > props.anchor.top
    const maxHeight = Math.max(32,window.innerHeight - (belowHeader ? props.anchor.bottom + 10 : 16))
    const width = element.offsetWidth, height = Math.min(element.offsetHeight,maxHeight)
    let x = props.anchor.left, y = props.anchor.bottom + 2
    if (!level && !belowHeader && y + height > window.innerHeight - 8) y = props.anchor.top - height - 2
    if (level) {
      const parent = rectangles[level - 1], oldParent = elements[level - 1]?.getBoundingClientRect(), row = anchors[level - 1]?.getBoundingClientRect()
      if (!parent || !oldParent || !row) continue
      x = parent.right + width <= window.innerWidth - 8 ? parent.right - 2 : parent.left - width + 2; y = parent.top + row.top - oldParent.top - 4
    }
    result[level] = {left:`${Math.max(8,Math.min(x,window.innerWidth-width-8))}px`,top:`${Math.max(8,Math.min(y,window.innerHeight-height-8))}px`,maxHeight:`${maxHeight}px`}
    rectangles[level]={left:parseFloat(result[level].left),right:parseFloat(result[level].left)+width,top:parseFloat(result[level].top)}
  }
  positions.value = result
}
async function expand(item: ResolvedMenuNode, level: number, anchor: HTMLElement, focus: boolean) {
  cancelHover(); if (!item.enabled || !item.children) return
  anchors[level] = anchor; path.value = [...path.value.slice(0,level),item.id]
  await align(); if (focus) focusFirst(level+1)
}
function hover(item: ResolvedMenuNode, level: number, event: MouseEvent) {
  cancelHover(); const anchor = event.currentTarget as HTMLElement
  hoverTimer = setTimeout(() => { hoverTimer=undefined; if (item.children && item.enabled) void expand(item,level,anchor,false); else path.value=path.value.slice(0,level) },160)
}
function activate(item: ResolvedMenuNode, level: number, anchor: HTMLElement) {
  if (!item.enabled) return
  if (item.children) { void expand(item,level,anchor,true); return }
  cancelHover(); emit('close',true); if (item.commandId) emit('execute',item.commandId)
}
function keydown(event: KeyboardEvent, level: number) {
  cancelHover(); const rows = buttons(level), current = rows.indexOf(document.activeElement as HTMLButtonElement)
  const node = panels.value[level]?.items.find(item => item.id === (document.activeElement as HTMLElement)?.dataset.node)
  if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length-1 : (current+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length; rows[next]?.focus()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault(); if (node?.children) void expand(node,level,rows[current],true); else if (!level) emit('switch-root',1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (path.value.length) { const parent = path.value.length-1; path.value=path.value.slice(0,parent);anchors[parent]?.focus() }
    else emit('close',true)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();if(level){path.value=path.value.slice(0,level-1);anchors[level-1]?.focus()}else emit('switch-root',-1)
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (node && rows[current]) activate(node,level,rows[current]) }
  else if (event.key === 'Tab') emit('close',false)
}
function inside(target: EventTarget | null) { return target instanceof Element && (!!target.closest('[data-menu-popup]') || !!target.closest('.menu-categories')) }
function outside(event: PointerEvent) { if (!inside(event.target)) emit('close',false) }
function globalKey(event: KeyboardEvent) {
  if (event.defaultPrevented) { emit('close',false); return }
  if (inside(event.target)) return
  if (event.key === 'Escape') { event.preventDefault(); if (path.value.length) path.value=path.value.slice(0,-1); else emit('close',true) }
  else emit('close',false)
}
watch(() => props.nodes, () => { void align() })
watch(panels, () => { void align() })
watch(() => props.anchor, () => { path.value=[]; void align() })
watch(() => props.focus, async focus => { if(focus){await nextTick();focusFirst(0)} })
onMounted(async () => {
  window.dispatchEvent(new CustomEvent('lightedit-menu-open',{detail:instance})); window.addEventListener('lightedit-menu-open',anotherMenu)
  window.addEventListener('pointerdown',outside,true); window.addEventListener('keydown',globalKey,true); window.addEventListener('resize',align)
  observer=new ResizeObserver(() => { void align() }); await align(); for (const element of elements) if (element) observer.observe(element)
  if (props.focus) focusFirst(0)
})
onUnmounted(() => { alive=false;cancelHover();observer?.disconnect();window.removeEventListener('lightedit-menu-open',anotherMenu);window.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',globalKey,true);window.removeEventListener('resize',align) })
</script>
<style>
.app-menu-popup { position:fixed;z-index:1200;display:flex;flex-direction:column;width:max-content;min-width:200px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;overflow-x:hidden;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.18);font: var(--ui-font-size)/var(--ui-line-height) var(--font-sans);color:var(--ink) }
.app-menu-popup button { display:flex;align-items:center;gap:8px;text-align:left;min-height:var(--ui-control-height);padding:4px 8px;border-radius:3px;flex:none;color:var(--ink);white-space:nowrap;min-width:0 }
.app-menu-popup button:hover,.app-menu-popup button:focus-visible { background:var(--hover) }.app-menu-popup button:focus-visible { outline:1px solid var(--accent);outline-offset:-1px }
.app-menu-popup button:disabled { opacity:.45;cursor:default }.app-menu-popup button:disabled:hover { background:transparent }
.menu-check { width:12px;flex:none;text-align:center;color:var(--accent);font-size: var(--ui-small-font-size) }.menu-label { flex:1;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:min(360px,60vw) }
.app-menu-popup kbd { color:var(--muted);font-size: var(--ui-small-font-size);margin-left:16px;white-space:nowrap }.menu-arrow { margin-left:12px;color:var(--muted) }.menu-separator { height:1px;flex:none;margin:4px 7px;background:var(--line) }
</style>
