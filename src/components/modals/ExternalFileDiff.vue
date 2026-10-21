<template>
  <section class="external-diff" role="region" aria-label="文件差异比较">
    <header><strong>{{ snapshot.name }} · 差异比较</strong><button @click="$emit('close')" aria-label="关闭比较并返回编辑器">关闭比较</button></header>
    <div class="snapshot-info">只读快照 · {{ new Date(snapshot.capturedAt).toLocaleTimeString() }} · 本地 {{ snapshot.encoding }}{{ snapshot.bom ? ' BOM' : '' }} · {{ snapshot.eol }} / 磁盘 {{ snapshot.diskFormat }}</div>
    <div v-if="stale" class="stale" role="status">磁盘或编辑内容已变化，此对比已过期。<button @click="$emit('refresh')">刷新对比</button></div>
    <nav aria-label="差异导航"><button :disabled="!count" @click="navigate(-1)">上一个变化</button><button :disabled="!count" @click="navigate(1)">下一个变化</button><span>{{ count }} 处差异{{ approximate ? '（简化比较）' : '' }} · {{ elapsed.toFixed(1) }} ms</span></nav>
    <div class="sources"><span>磁盘文件（{{ snapshot.diskVersion.slice(0,12) }}）</span><span>当前编辑内容（只读快照）</span></div>
    <p v-if="!withinBudget" role="status">文本超过安全比较预算（合计 256 Ki 字符或 20,000 行），未计算差异。当前编辑内容仍保留，可另存为后使用专用比较工具。</p>
    <div v-else ref="host" class="diff-host"></div>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { editorTheme } from '../../editor/core/extensions'
import { diffWithinBudget, type ExternalDiff } from '../../features/files/ExternalFileChangeController'
const props = defineProps<{ snapshot: ExternalDiff; stale: boolean }>()
defineEmits<{ (e:'close'):void; (e:'refresh'):void }>()
const host = ref<HTMLElement>(), count = ref(0), approximate = ref(false), elapsed = ref(0)
const withinBudget = computed(() => diffWithinBudget(props.snapshot.disk,props.snapshot.local))
let merge: MergeView | undefined, current = -1, observer: MutationObserver | undefined
function build() {
  merge?.destroy(); merge = undefined; count.value = 0; approximate.value = false; elapsed.value = 0; current = -1
  if (!host.value || !withinBudget.value) return
  const start = performance.now()
  const extensions = [EditorState.readOnly.of(true),EditorView.editable.of(false),lineNumbers(),editorTheme(document.body.classList.contains('light')?'light':'dark')]
  merge = new MergeView({ parent:host.value, a:{doc:props.snapshot.disk,extensions:[...extensions,EditorView.contentAttributes.of({'aria-label':'磁盘文件，只读'})]}, b:{doc:props.snapshot.local,extensions:[...extensions,EditorView.contentAttributes.of({'aria-label':'当前编辑内容，只读快照'})]}, highlightChanges:true, gutter:true, diffConfig:{scanLimit:500,timeout:40} })
  count.value = merge.chunks.length; approximate.value = merge.chunks.some(c=>!c.precise); elapsed.value = performance.now()-start; current = -1
  // MergeView aligns unchanged lines with spacers. One shared scroller keeps
  // corresponding positions synchronized without feedback-loop listeners.
}
function navigate(direction: number) {
  if (!merge || !merge.chunks.length) return
  current = current < 0 ? (direction < 0 ? merge.chunks.length - 1 : 0) : (current+direction+merge.chunks.length)%merge.chunks.length
  const c = merge.chunks[current]
  merge.a.dispatch({selection:{anchor:Math.min(c.fromA,merge.a.state.doc.length)},effects:EditorView.scrollIntoView(Math.min(c.fromA,merge.a.state.doc.length),{y:'center'})})
  merge.b.dispatch({selection:{anchor:Math.min(c.fromB,merge.b.state.doc.length)}})
}
onMounted(() => { build(); observer = new MutationObserver(build); observer.observe(document.body,{attributes:true,attributeFilter:['class']}) })
watch(() => props.snapshot,build,{flush:'post'})
onBeforeUnmount(() => { observer?.disconnect(); merge?.destroy() })
</script>
<style scoped>
.external-diff{position:fixed;inset:7vh 3vw;z-index:1500;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;background:var(--editor);color:var(--ink);box-shadow:0 12px 50px #0005;min-width:280px}header,nav{display:flex;align-items:center;gap:10px;padding:10px;flex-wrap:wrap}header strong{flex:1}.snapshot-info,.stale{padding:6px 12px;color:var(--muted);font-size:var(--ui-small-font-size)}.stale{color:var(--yellow)}.sources{display:grid;grid-template-columns:1fr 1fr;padding:8px;border-bottom:1px solid var(--line);font-size:var(--ui-small-font-size)}.sources span{padding-left:12px}.diff-host{min-height:0;flex:1;overflow:auto}.diff-host :deep(.cm-mergeView){min-height:100%}.diff-host :deep(.cm-editor){height:auto}.diff-host :deep(.cm-scroller){overflow:visible}button{font:inherit;padding:5px 9px;border:1px solid var(--line);background:var(--sidebar);color:var(--ink);border-radius:4px;cursor:pointer}button:focus-visible{outline:2px solid var(--accent)}p{padding:20px;line-height:1.8}
</style>
