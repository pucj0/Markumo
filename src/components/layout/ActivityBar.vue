<template>
  <nav class="rail">
    <button
      class="ib"
      :class="{ on: activePanel === 'files' && sidebarVisible }"
      title="文件资源管理器"
      @click="$emit('select-panel', 'files')"
    >
      <Icon name="files" />
    </button>

    <button
      class="ib"
      :class="{ on: activePanel === 'search' && sidebarVisible }"
      title="搜索面板占位（Phase 4 接入）"
      @click="$emit('select-panel', 'search')"
    >
      <Icon name="search" />
    </button>

    <button
      class="ib"
      :class="{ on: activePanel === 'outline' && sidebarVisible }"
      title="大纲面板占位（Phase 6 接入）"
      @click="$emit('select-panel', 'outline')"
    >
      <Icon name="outline" />
    </button>

    <div class="push"></div>

    <button
      class="ib"
      title="首选项设置"
      @click="$emit('open-settings')"
    >
      <Icon name="gear" />
    </button>
  </nav>
</template>

<script setup lang="ts">
import Icon from '../common/Icon.vue'
import type { SidebarPanel } from '../../types'

defineProps<{
  activePanel: SidebarPanel
  sidebarVisible: boolean
}>()

defineEmits<{
  (e: 'select-panel', panel: SidebarPanel): void
  (e: 'open-settings'): void
}>()
</script>

<style scoped>
.rail {
  width: 44px;
  flex: none;
  background: var(--bar);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
  gap: 6px;
}

.push {
  flex: 1;
}
</style>
