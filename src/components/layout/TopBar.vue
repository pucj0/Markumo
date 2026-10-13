<template>
  <header class="topbar">
    <div class="brandarea">
      <div class="logo">L</div>
      <span class="brand">LightEdit</span>
      <span class="workspace-name">{{ workspaceTitle }}</span>
    </div>

    <button
      class="quickbtn"
      title="Ctrl+P 快速打开"
      @click="$emit('open-palette', 'all')"
    >
      <Icon name="search" />
      <span class="quick-label">搜索示例文件和命令…</span>
      <span class="kbd">Ctrl P</span>
    </button>

    <div class="topright">
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
        :title="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"
        @click="$emit('toggle-theme')"
      >
        <Icon :name="theme === 'dark' ? 'moon' : 'sun'" />
      </button>

      <button
        class="ib"
        title="设置"
        @click="$emit('open-settings')"
      >
        <Icon name="gear" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../common/Icon.vue'
import type { AppMode, Theme } from '../../types'

const props = defineProps<{
  appMode: AppMode
  theme: Theme
  focusMode: boolean
  activeFileName?: string
}>()

defineEmits<{
  (e: 'set-mode', mode: AppMode): void
  (e: 'toggle-theme'): void
  (e: 'toggle-focus'): void
  (e: 'open-settings'): void
  (e: 'open-palette', category: 'action' | 'file' | 'all'): void
}>()

const workspaceTitle = computed(() => {
  return props.appMode === 'workspace'
    ? '示例工作区 · Phase 1'
    : props.activeFileName || '独立文件'
})
</script>

<style scoped>
.topbar {
  height: 48px;
  flex: none;
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(200px, 390px) minmax(260px, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  background: var(--bar);
  border-bottom: 1px solid var(--line);
}

.brandarea {
  display: flex;
  gap: 11px;
  align-items: center;
  min-width: 0;
}

.logo {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: white;
  font-weight: 900;
  font-size: 15px;
  background: linear-gradient(135deg, #7a71dc, #b287d2);
}

.brand {
  font-size: 13px;
  font-weight: 700;
  color: var(--bright);
  letter-spacing: -0.3px;
}

.workspace-name {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 1px solid var(--line);
  padding-left: 10px;
}

.quickbtn {
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

@media (max-width: 1050px) {
  .workspace-name { display: none; }
  .topbar { grid-template-columns: 110px minmax(0, 1fr) auto; gap: 8px; }
}
@media (max-width: 720px) {
  .brand, .quickbtn .kbd { display: none; }
  .topbar { grid-template-columns: 26px minmax(0, 1fr) auto; padding: 0 8px; }
  .switch button { padding: 3px 6px; white-space: nowrap; }
  .topright { gap: 2px; }
}

.topright {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

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
