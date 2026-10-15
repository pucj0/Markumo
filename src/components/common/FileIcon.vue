<template>
  <svg class="file-icon" :class="`file-icon-${definition.tone}`" :data-file-icon="definition.id" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor" opacity=".08" />
    <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path v-for="(path,index) in definition.paths" :key="index" :d="path" />
    </g>
    <text v-if="definition.monogram" :x="definition.id === 'go' ? 14 : 12" :y="definition.id === 'rust' ? 15.6 : 16.3" text-anchor="middle" fill="currentColor" :font-size="definition.monogram.length > 2 ? 8 : definition.id === 'rust' ? 10 : 11" font-family="Inter, 'Segoe UI', sans-serif" font-weight="750" letter-spacing="-.6">{{ definition.monogram }}</text>
  </svg>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { fileIconFor } from '../../features/shell/fileIcons'
const props=defineProps<{ name: string }>()
const definition=computed(()=>fileIconFor(props.name))
</script>
<style scoped>
.file-icon{display:inline-block;width:16px;height:16px;flex:0 0 16px;vertical-align:middle;overflow:visible;color:var(--sub)}
.file-icon-blue{color:#82acf2}.file-icon-cyan{color:#6cc8d7}.file-icon-green{color:#83c7a1}.file-icon-amber{color:#e0c078}.file-icon-orange{color:#e5a17a}.file-icon-pink{color:#d99bbe}.file-icon-purple{color:#b1a0e9}.file-icon-red{color:#df8f91}.file-icon-gray{color:#9ba9bd}
:global(body.light .file-icon-blue){color:#3d6fbe}:global(body.light .file-icon-cyan){color:#287d91}:global(body.light .file-icon-green){color:#32815b}:global(body.light .file-icon-amber){color:#927021}:global(body.light .file-icon-orange){color:#b76435}:global(body.light .file-icon-pink){color:#a94b80}:global(body.light .file-icon-purple){color:#7858b5}:global(body.light .file-icon-red){color:#b74752}:global(body.light .file-icon-gray){color:#6c7c92}
@media(forced-colors:active){.file-icon{color:CanvasText}}
</style>
