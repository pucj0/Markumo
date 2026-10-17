<template>
  <div class="media-empty" role="status" aria-live="polite">
    <span>{{ error || '正在加载…' }}</span>
    <button v-if="error" @click="$emit('retry')">重新加载</button>
    <button v-if="error && token" @click="open">使用系统默认程序打开</button>
    <span v-if="openError">{{ openError }}</span>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { openMediaDefault } from '../../features/files/media'
import { fileError } from '../../features/files/FileController'
const props = defineProps<{ error?: string; token?: string }>()
defineEmits<{ (e: 'retry'): void }>()
const openError = ref('')
async function open() { try { await openMediaDefault(props.token!) } catch (e) { openError.value = fileError(e) } }
</script>
<style scoped>
.media-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; color:var(--muted); text-align:center; overflow:auto }
button { background:var(--bar); color:var(--ink); border:1px solid var(--line); border-radius:5px; padding:5px 10px; cursor:pointer }
</style>
