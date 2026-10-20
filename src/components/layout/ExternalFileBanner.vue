<template>
  <aside v-if="state && state.conflictValid" class="external-banner" role="status" aria-live="polite">
    <template v-if="state.hidden">
      <button class="summary" @click="external.keep(id, false)">⚠ {{ title }} · 查看处理选项</button>
    </template>
    <template v-else>
      <div class="explanation"><strong>{{ title }}</strong><span>{{ state.error || '磁盘内容与当前编辑内容不同。为防止覆盖，已暂停自动保存。' }}</span></div>
      <div class="actions" aria-label="处理外部文件变化">
        <button :disabled="busy || !canCompare" :title="!canCompare ? '当前文件没有可比较的磁盘文本版本' : '比较磁盘和编辑内容'" @click="external.compare(id)">比较差异</button>
        <button :disabled="busy" @click="external.keep(id)">保留当前</button>
        <button :disabled="busy || state.phase === 'deleted'" @click="external.requestReload(id)">加载磁盘</button>
        <button v-if="canSave" :disabled="busy" @click="files.save(id, true)">另存为</button>
        <button :disabled="busy" aria-label="重新检查磁盘" @click="external.check(id)">刷新</button>
      </div>
    </template>
  </aside>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { FileController } from '../../features/files/FileController'
const props = defineProps<{ files: FileController; id: string }>()
const external = props.files.external
const state = computed(() => external.state(props.id))
const busy = computed(() => !!state.value?.operation)
const doc = computed(() => { external.revision.value; return props.files.manager.metadata(props.id) })
const title = computed(() => state.value?.phase === 'deleted' ? '原文件已被删除或移动' : state.value?.phase === 'unavailable' ? '暂时无法读取磁盘文件' : '文件已在外部修改')
const canSave = computed(() => doc.value?.kind !== 'javaClass' && doc.value?.kind !== 'image' && doc.value?.kind !== 'pdf')
const canCompare = computed(() => canSave.value && doc.value?.encoding !== 'Hex' && state.value?.phase !== 'deleted')
</script>
<style scoped>
.external-banner{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:7px 12px;background:var(--side);border-bottom:1px solid var(--line);color:var(--ink);font-size:var(--ui-small-font-size)}
.explanation{display:flex;flex:1 1 230px;flex-direction:column;gap:3px}.explanation strong{color:var(--yellow)}.explanation span{color:var(--muted);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:5px}button{font:inherit;color:var(--ink);background:var(--editor);border:1px solid var(--line);border-radius:4px;padding:4px 7px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--accent)}.summary{border:0;background:none;color:var(--yellow);text-align:left}
</style>
