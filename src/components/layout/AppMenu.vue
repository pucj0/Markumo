<template>
  <div ref="root" class="app-menu" @mousedown.stop @dblclick.stop>
    <div class="menu-categories" role="menubar" aria-label="应用菜单" @keydown.stop="keydown">
      <button v-for="(group, index) in groups" :key="group.title" :ref="el => { triggers[index] = el as HTMLButtonElement }" role="menuitem" aria-haspopup="menu" :aria-expanded="visible && active === index" :aria-controls="visible && active === index ? 'app-menu-options' : undefined" :tabindex="active === index ? 0 : -1" :class="{ on: visible && active === index }" @click="open(index, true)" @mouseenter="open(index, false)">{{ group.title }}</button>
    </div>
    <div v-if="visible" id="app-menu-options" ref="popup" class="app-menu-popup" :style="{ left: `${popupLeft}px` }" role="menu" :aria-label="`${groups[active]?.title}菜单`" @keydown.stop="keydown">
      <div class="menu-actions">
        <button v-for="item in groups[active]?.items" :key="item.id" role="menuitem" :aria-label="item.title" :disabled="item.disabled" :title="item.detail" @click="run(item)"><span>{{ item.title }}</span><kbd v-if="item.detail.startsWith('Ctrl')">{{ item.detail }}</kbd></button>
        <p v-if="!groups[active]?.items.length">暂无可用操作</p>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { PaletteAction } from '../../types'
import { eventShortcut } from '../../features/shell/editorSettings'
const props = defineProps<{ groups: { title: string; items: PaletteAction[] }[] }>()
const root = ref<HTMLElement | null>(null), popup = ref<HTMLElement | null>(null)
const triggers: HTMLButtonElement[] = []
const visible = ref(false), active = ref(0), popupLeft = ref(0)
function close(restore = true) { visible.value = false; if (restore) triggers[active.value]?.focus() }
function align() {
  const left = root.value?.getBoundingClientRect().left || 0
  const width = Math.min(330, window.innerWidth - 16)
  popupLeft.value = Math.min(triggers[active.value]?.offsetLeft || 0, Math.max(0, window.innerWidth - left - width - 8))
}
async function open(index: number, focus: boolean) {
  active.value = index; visible.value = true; align()
  if (focus) { await nextTick(); popup.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }
}
function run(item: PaletteAction) { if (item.disabled) return; close(); item.action() }
function outside(event: PointerEvent) { if (visible.value && event.target instanceof Node && !root.value?.contains(event.target)) close(false) }
function escapeOutside(event: KeyboardEvent) {
  if (visible.value && !(event.target instanceof Node && root.value?.contains(event.target))) { if (event.key === 'Escape') event.preventDefault(); close(false) }
}
function keydown(event: KeyboardEvent) {
  const shortcut = props.groups.flatMap(group => group.items).find(item => item.detail.startsWith('Ctrl') && item.detail.replace(/^Ctrl/, 'Mod') === eventShortcut(event))
  if (shortcut) { event.preventDefault(); if (!shortcut.disabled) run(shortcut); return }
  if (event.key === 'Escape') { event.preventDefault(); close() }
  else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const index = (active.value + (event.key === 'ArrowRight' ? 1 : -1) + props.groups.length) % props.groups.length
    if (visible.value) void open(index, true)
    else { active.value = index; triggers[index]?.focus() }
  } else if (event.key === 'Tab') close(false)
  else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault()
    if (!visible.value || document.activeElement?.closest('[role=menubar]')) { void open(active.value, true); return }
    const buttons = Array.from(popup.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
}
onMounted(() => { window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', escapeOutside, true); window.addEventListener('resize', align) })
onUnmounted(() => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escapeOutside, true); window.removeEventListener('resize', align) })
</script>
<style scoped>
.app-menu { position:relative;flex:none }
.menu-categories { display:flex;align-items:center;gap:1px;height:32px }
.menu-categories button { padding:6px 8px;border-radius:4px;font-size:12px;color:var(--sub);white-space:nowrap }
.menu-categories button:hover,.menu-categories button.on { color:var(--bright);background:var(--hover) }
.menu-categories button:focus-visible,.menu-actions button:focus-visible { outline:2px solid var(--accent);outline-offset:-2px }
.app-menu-popup { position:absolute;top:calc(100% + 3px);width:330px;max-width:calc(100vw - 16px);border:1px solid var(--line);border-radius:7px;padding:5px;background:var(--paper);box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:600 }
.menu-actions { max-height:min(510px, calc(100vh - 90px));overflow:auto }
.menu-actions button { display:flex;justify-content:space-between;gap:12px;width:100%;min-height:30px;border-radius:4px;padding:5px 9px;font-size:12px;color:var(--ink);text-align:left }
.menu-actions button:hover { background:var(--hover) }.menu-actions button:disabled { cursor:default }
.menu-actions kbd { font-size:10px;color:var(--muted);white-space:nowrap }.menu-actions p { padding:8px;color:var(--muted);font-size:12px }
@media(max-width:640px) { .menu-categories button { padding:6px 5px } }
</style>
