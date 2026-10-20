<template>
  <div v-if="external.monitoringError.value" class="monitor-warning" role="status">{{ external.monitoringError.value }} 保存时的磁盘版本保护仍然有效。</div>
  <ExternalFileDiff v-if="external.diff.value" :snapshot="external.diff.value" :stale="external.diffStale()" @close="external.diff.value = null" @refresh="external.diff.value && external.compare(external.diff.value.id)" />
  <dialog ref="dialog" class="reload-dialog" aria-labelledby="reload-title" @cancel.prevent="external.cancelReload()">
    <h3 id="reload-title">加载磁盘版本</h3>
    <p>{{ external.confirmation.value?.dirty ? '加载磁盘版本将替换当前未保存内容。' : '将重新读取磁盘并刷新当前文档。' }}</p>
    <p>重载会重置此文档的撤销历史。建议先另存当前内容；支持的文本会在加载前写入恢复快照。</p>
    <div class="actions"><button ref="cancel" autofocus @click="external.cancelReload()">取消</button><button @click="saveFirst">先另存当前内容</button><button @click="external.confirmReload()">确认加载</button></div>
  </dialog>
</template>
<script setup lang="ts">
import { defineAsyncComponent, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { FileController } from '../../features/files/FileController'
const props = defineProps<{ files:FileController }>()
const external = props.files.external
const ExternalFileDiff = defineAsyncComponent(() => import('./ExternalFileDiff.vue'))
const dialog = ref<HTMLDialogElement>(), cancel = ref<HTMLButtonElement>()
watch(external.confirmation,async value => { await nextTick(); if (value) { if (!dialog.value?.open) dialog.value?.showModal(); cancel.value?.focus() } else dialog.value?.close() })
function saveFirst() { const id = external.confirmation.value?.id; external.cancelReload(); if (id) void props.files.save(id,true) }
onBeforeUnmount(() => { dialog.value?.close() })
</script>
<style scoped>
.monitor-warning{position:fixed;bottom:28px;left:12px;right:12px;z-index:1000;background:var(--side);color:var(--yellow);border:1px solid var(--line);padding:6px 10px;font-size:var(--ui-small-font-size)}.reload-dialog{max-width:460px;inset:0;padding:22px;color:var(--text);background:var(--side);border:1px solid var(--line);border-radius:8px}.reload-dialog::backdrop{background:#0005}.reload-dialog p{line-height:1.7}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.actions button{font:inherit;padding:7px 11px;color:var(--text);background:var(--editor);border:1px solid var(--line);border-radius:4px}.actions button:focus-visible{outline:2px solid var(--accent)}
</style>
