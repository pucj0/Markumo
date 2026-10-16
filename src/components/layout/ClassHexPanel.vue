<template>
  <section class="class-hex" aria-label="ClassFile 十六进制字节查看">
    <div class="hex-toolbar">
      <span>十六进制 · 只读</span>
      <button :disabled="loading || !offset" aria-label="上一页字节" @click="load(Math.max(0, offset - 4096))">‹</button>
      <input v-model="address" aria-label="字节偏移" title="十六进制 0x… 或十进制偏移" @keydown.enter="go" />
      <button :disabled="loading" @click="go">跳转</button>
      <button :disabled="loading || nextOffset === null" aria-label="下一页字节" @click="nextOffset !== null && load(nextOffset)">›</button>
    </div>
    <p v-if="error" class="hex-error" role="alert">{{ error }}</p>
    <div ref="host" class="hex-host" :aria-busy="loading"></div>
    <div class="hex-footer">{{ loading ? '读取中…' : `${offset.toLocaleString()}–${Math.min(offset + 4096, doc.classInfo?.byteLength || 0).toLocaleString()} / ${(doc.classInfo?.byteLength || 0).toLocaleString()} 字节` }}</div>
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection } from '@codemirror/view'
import { editorTheme } from '../../editor/core/extensions'
import type { EditorDocument } from '../../types'
import type { FileController } from '../../features/files/FileController'
import { fileError } from '../../features/files/FileController'
const props = defineProps<{ doc: EditorDocument; files?: FileController }>()
const host = ref<HTMLElement | null>(null), address = ref('0x0'), offset = ref(0), nextOffset = ref<number | null>(null), loading = ref(false), error = ref('')
let view: EditorView | undefined, generation = 0, alive = true
async function load(position: number) {
  const current = ++generation
  if (!Number.isSafeInteger(position) || position < 0 || position >= (props.doc.classInfo?.byteLength || 0) || position % 16) { error.value = '偏移须在文件范围内并对齐16字节。'; return }
  loading.value = true; error.value = ''
  try {
    if (!props.files) throw new Error('字节查看需要真实文件服务。')
    const page = await props.files.classHex(props.doc.id, position)
    if (!alive || current !== generation) return
    offset.value = page.offset; nextOffset.value = page.nextOffset; address.value = `0x${page.offset.toString(16).toUpperCase()}`
    view?.dispatch({ changes: { from:0, to:view.state.doc.length, insert:page.text } })
    if (view) view.scrollDOM.scrollTop = 0
  } catch (cause) { if (alive && current === generation) error.value = fileError(cause) }
  finally { if (alive && current === generation) loading.value = false }
}
function go() { if (loading.value) return; const value = address.value.trim(); if (!/^(0x[0-9a-f]+|\d+)$/i.test(value)) { error.value = '请输入十六进制或十进制偏移。'; return }; void load(Number(value)) }
onMounted(() => {
  if (host.value) view = new EditorView({ parent:host.value, state:EditorState.create({ extensions:[EditorState.readOnly.of(true),EditorView.editable.of(false),drawSelection(),editorTheme(document.body.classList.contains('light') ? 'light' : 'dark'),EditorView.contentAttributes.of({'aria-label':'只读十六进制字节',tabindex:'0'})] }) })
  void load(0)
})
watch(() => props.doc.lastDiskVersion, () => { if (view) void load(0) })
watch(() => props.doc, () => view?.requestMeasure())
onUnmounted(() => { alive = false; generation++; view?.destroy() })
</script>
<style scoped>
.class-hex { width:50%;min-width:0;display:flex;flex-direction:column;border-left:1px solid var(--line);background:var(--editor) }
.hex-toolbar { flex:none;display:flex;align-items:center;gap:5px;min-height:34px;padding:3px 8px;border-bottom:1px solid var(--line);font-size: var(--ui-small-font-size);color:var(--sub);flex-wrap:wrap }
.hex-toolbar span { margin-right:auto }.hex-toolbar button { padding:3px 6px;border-radius:4px;color:var(--sub) }.hex-toolbar button:hover { background:var(--hover) }
.hex-toolbar input { width:90px;min-width:0;border:1px solid var(--line);border-radius:4px;background:var(--editor);font:11px var(--font-mono);padding:3px 5px }
.hex-host { flex:1;min-height:0;overflow:hidden }.hex-host :deep(.cm-editor) { height:100% }
.hex-footer { padding:3px 8px;font-size: var(--ui-small-font-size);color:var(--muted);border-top:1px solid var(--line) }
.hex-error { padding:6px 8px;font-size: var(--ui-font-size);color:var(--pink);overflow-wrap:anywhere }
@media(max-width:900px) { .class-hex { width:auto;height:45%;border-left:0;border-top:1px solid var(--line) } }
</style>
