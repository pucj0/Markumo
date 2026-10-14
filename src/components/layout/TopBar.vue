<template>
  <header class="topbar" @mousedown="dragWindow" @dblclick="maximizeFromHeader">
    <div class="brandarea">
      <div class="app-brand"><img class="logo" src="/logo.png" alt="LightEdit 标志" width="26" height="26" /><span class="brand">LightEdit</span></div>
      <AppMenu :groups="menuGroups" />
      <span class="workspace-name">{{ workspaceTitle }}</span>
    </div>

    <button
      class="quickbtn"
      title="Ctrl+P 快速打开"
      @click="$emit('open-palette', 'all')"
    >
      <Icon name="search" />
      <span class="quick-label">文件和命令…</span>
      <span class="kbd">Ctrl P</span>
    </button>

    <div class="topright">
      <button class="ib" aria-label="保存文件" :title="desktop ? '保存 (Ctrl+S) · 另存为 (Ctrl+Shift+S)' : '保存需要 Tauri 桌面版'" :disabled="!desktop || fileBusy" @click="$emit('save-file')"><Icon name="save" /></button>
      <div class="switch">
        <button
          :class="{ on: appMode === 'single' }"
          @click="$emit('set-mode', 'single')"
        >
          单文件
        </button>
        <button
          :class="{ on: appMode === 'workspace' }"
          @click="$emit('set-mode', 'workspace')"
        >
          工作区
        </button>
      </div>

      <button
        class="ib"
        :class="{ on: focusMode }"
        title="专注模式"
        @click="$emit('toggle-focus')"
      >
        <Icon name="max" />
      </button>


      <button
        class="ib"
        :title="theme === 'dark' ? '深色 · 切换浅色主题' : theme === 'light' ? '浅色 · 切换跟随系统' : '跟随系统 · 切换深色主题'"
        @click="$emit('toggle-theme')"
      >
        <Icon :name="theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'system'" />
      </button>

      <button
        class="ib"
        title="设置"
        @click="$emit('open-settings')"
      >
        <Icon name="gear" />
      </button>
      <div v-if="desktop" class="window-controls" @mousedown.stop @dblclick.stop>
        <button aria-label="最小化窗口" title="最小化" @click="windowAction('minimize')">—</button>
        <button aria-label="最大化或还原窗口" title="最大化 / 还原" @click="windowAction('maximize')">□</button>
        <button class="window-close" aria-label="关闭窗口" title="关闭" @click="windowAction('close')">×</button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../common/Icon.vue'
import AppMenu from './AppMenu.vue'
import type { AppMode, ThemePreference, PaletteAction } from '../../types'

const props = defineProps<{
  appMode: AppMode
  theme: ThemePreference
  focusMode: boolean
  activeFileName?: string
  workspaceName?: string
  desktop: boolean
  fileBusy: boolean
  menuGroups: { title: string; items: PaletteAction[] }[]
}>()

async function windowAction(action: 'minimize' | 'maximize' | 'close') {
  if (!props.desktop) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow()
    if (action === 'minimize') await window.minimize()
    else if (action === 'maximize') await window.toggleMaximize()
    else await window.close()
  } catch { globalThis.window.dispatchEvent(new CustomEvent('editor-notice', { detail: '窗口操作失败，请重试。' })) }
}
async function dragWindow(event: MouseEvent) {
  if (!props.desktop || event.button !== 0 || !(event.target instanceof Element) || event.target.closest('button,input,select,[role=menu]')) return
  try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().startDragging() } catch {}
}
function maximizeFromHeader(event: MouseEvent) {
  if (event.target instanceof Element && !event.target.closest('button,input,select,[role=menu]')) void windowAction('maximize')
}

defineEmits<{
  (e: 'set-mode', mode: AppMode): void
  (e: 'toggle-theme'): void
  (e: 'toggle-focus'): void
  (e: 'open-settings'): void
  (e: 'open-file'): void
  (e: 'save-file'): void
  (e: 'open-palette', category: 'action' | 'file' | 'all'): void
}>()

const workspaceTitle = computed(() => {
  return props.appMode === 'workspace'
    ? props.workspaceName || '未打开工作区'
    : props.activeFileName || '独立文件'
})
</script>

<style scoped>
.topbar {
  height: 48px;
  flex: none;
  display: grid;
  grid-template-columns: auto minmax(110px, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 0 8px;
  background: var(--bar);
  border-bottom: 1px solid var(--line);
}

.brandarea {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.logo {
  width: 26px;
  height: 26px;
  display: block;
  flex: none;
  object-fit: contain;
}
.app-brand { display:flex;align-items:center;gap:9px;flex:none }

.brand {
  font-size: 13px;
  font-weight: 700;
  color: var(--bright);
  letter-spacing: -0.3px;
}

.workspace-name {
  max-width: 130px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 1px solid var(--line);
  padding-left: 10px;
}

.quickbtn {
  width: 100%;
  max-width: 390px;
  justify-self: center;
  min-width: 0;
  height: 31px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--editor);
  padding: 0 11px;
  display: flex;
  gap: 9px;
  align-items: center;
  text-align: left;
  color: var(--muted);
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s;
}

.quickbtn:hover {
  background: var(--hover);
  border-color: var(--muted);
}

.quickbtn span {
  flex: 1;
}

.quick-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quickbtn .kbd { flex: none; }

@media (max-width: 1100px) {
  .workspace-name,.brand { display: none; }
  .topbar { gap: 8px; }
}
@media (max-width: 900px) {
  .quickbtn .kbd,.quick-label { display: none; }
  .topbar { grid-template-columns: auto 32px auto; gap:6px;justify-content:space-between }
  .quickbtn { padding:0;justify-content:center }
  .topright > .ib:not([title='设置']) { display:none }
  .switch button { padding: 3px 6px; white-space: nowrap; }
}
@media(max-width:640px) { .topright .switch { display:none } }

.topright {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.window-controls { display:flex;align-self:stretch;margin-right:-8px;margin-left:4px }
.window-controls button { width:36px;height:47px;border-radius:0;font-size:16px;color:var(--sub) }
.window-controls button:hover { background:var(--hover);color:var(--bright) }
.window-controls .window-close:hover { background:#c94048;color:#fff }

.switch {
  display: flex;
  background: var(--soft);
  border-radius: 7px;
  padding: 2px;
  margin-right: 6px;
}

.switch button {
  padding: 3px 9px;
  font-size: 11px;
  border-radius: 5px;
  color: var(--sub);
  transition: all 0.15s;
}

.switch button.on {
  background: var(--paper);
  color: var(--bright);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}
</style>
