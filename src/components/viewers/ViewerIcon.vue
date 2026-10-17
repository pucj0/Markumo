<template>
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name]" />
  </svg>
</template>
<script setup lang="ts">
const paths = {
  'zoom-in': 'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM12.5 12.5 17 17M6 8.5h5M8.5 6v5',
  'zoom-out': 'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM12.5 12.5 17 17M6 8.5h5',
  fit: 'M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4M6 6h8v8H6Z',
  width: 'M3 3v14M17 3v14M5 10h10M8 7l-3 3 3 3M12 7l3 3-3 3',
  rotate: 'M4 7a6.5 6.5 0 1 1-.5 5M4 3v4h4M8 8h5v5H8Z',
  reset: 'M4 7a6.5 6.5 0 1 1-.5 5M4 3v4h4M10 6v4l3 2',
  external: 'M11 3h6v6M17 3l-8 8M8 4H4v12h12v-4',
  refresh: 'M16 8a6 6 0 0 0-10-3L3 8M3 4v4h4M4 12a6 6 0 0 0 10 3l3-3M17 16v-4h-4',
} as const
defineProps<{ name: keyof typeof paths }>()
</script>
<style scoped>
svg { display:block; width:18px; height:18px; flex:none }
</style>
