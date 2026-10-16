<template>
  <div v-if="doc?.kind === 'javaClass'" class="readonly-kind" role="status">JVM ClassFile · 只读</div>
</template>
<script setup lang="ts">
import type { EditorDocument } from '../../types'
defineProps<{ doc: EditorDocument | null }>()
</script>
<style scoped>
.readonly-kind { padding:4px 12px;color:var(--muted);font-size: var(--ui-small-font-size);border-bottom:1px solid var(--line);flex:none }
</style>
