<template>
  <section class="welcome" aria-label="LightEdit 欢迎页" :aria-busy="loading">
    <p v-if="loading" role="status">正在打开…</p>
    <template v-else>
      <h1>LightEdit</h1>
      <div class="welcome-actions">
        <button @click="$emit('new-doc')">新建文件</button>
        <button @click="$emit('open-file')">打开文件</button>
        <button @click="$emit('open-workspace')">打开文件夹</button>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
defineProps<{loading?:boolean}>()
defineEmits<{(e:'new-doc'):void;(e:'open-file'):void;(e:'open-workspace'):void}>()
</script>
<style scoped>
.welcome { flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;color:var(--muted) }
h1 { font-size:22px;font-weight:600;color:var(--bright) }
.welcome-actions { display:flex;gap:10px;flex-wrap:wrap;justify-content:center }
button { padding:8px 14px;background:var(--soft);border:1px solid var(--line);border-radius:6px;color:var(--bright) }
button:hover { background:var(--hover) }
button:focus-visible { outline:1px solid var(--accent) }
</style>
