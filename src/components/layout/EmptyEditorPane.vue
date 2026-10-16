<template>
  <section class="pane-empty" aria-label="空编辑窗格" tabindex="0">
    <div class="empty-actions">
      <button @click="$emit('new-doc')">新建文件</button>
      <button @click="$emit('quick-open')">快速打开</button>
    </div>
    <p>拖放文件或标签到此处</p>
  </section>
</template>
<script setup lang="ts">
defineEmits<{ (e: 'new-doc'): void; (e: 'quick-open'): void }>()
</script>
<style scoped>
.pane-empty { flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted);outline:none }
.empty-actions { display:flex;flex-wrap:wrap;justify-content:center;gap:10px }
button { padding:7px 14px;border-radius:6px;background:var(--soft);color:var(--bright);border:1px solid var(--line) }
button:hover { background:var(--hover) }
button:focus-visible,.pane-empty:focus-visible { outline:1px solid var(--accent);outline-offset:-2px }
p { font-size: var(--ui-font-size) }
</style>
