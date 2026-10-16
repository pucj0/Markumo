<template>
  <div class="pane-body" :class="{ 'class-pane': doc?.kind === 'javaClass' }">
    <div v-if="doc?.mode === 'live' && tooLarge" class="markdown-budget" role="status">文档超过 Live 安全预算，当前使用源码编辑。</div>
    <div v-show="doc" ref="host" class="editor-host" @scroll.capture="onEditorScroll"></div>
    <SplitPreview v-if="doc?.mode === 'split'" ref="preview" :content="text" :too-large="tooLarge" :resources="resources" :resource-key="`${doc?.fileToken||''}|${doc?.path||''}`" @scroll-line="onPreviewScroll" @edit-image="editImage" />
    <ClassHexPanel v-if="doc?.kind === 'javaClass'" :key="doc.id" :doc="doc" :files="files" />
    <EmptyEditorPane v-if="!doc" @new-doc="newDocument" @quick-open="quickOpen" />
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SplitPreview from '../../editor/markdown/splitPreview.vue'
import type { DocumentManager, Pane } from '../../editor/core/DocumentManager'
import type { EditorDocument } from '../../types'
import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import ClassHexPanel from './ClassHexPanel.vue'
import type { FileController } from '../../features/files/FileController'
import { markdownResources } from '../../editor/markdown/images'
import EmptyEditorPane from './EmptyEditorPane.vue'
const props = defineProps<{ manager: DocumentManager; pane: Pane; doc: EditorDocument | null; files?: FileController }>()
const emit = defineEmits<{ (e: 'quick-open'): void }>()
function newDocument() { props.manager.focusPane(props.pane, false); props.manager.createUntitled() }
function quickOpen() { props.manager.focusPane(props.pane, false); emit('quick-open') }
const host = ref<HTMLElement | null>(null), preview = ref<InstanceType<typeof SplitPreview> | null>(null)
let previousText: Text | undefined, serialized = ''
const tooLarge = computed(() => !!props.doc && (props.manager.getState(props.doc.id)?.doc.length || 0) > 1024 * 1024)
const resources=computed(()=>props.doc ? props.manager.getState(props.doc.id)?.facet(markdownResources) : undefined)
function editImage(from:number,snapshot:string) {
  const id=props.doc?.id,state=id&&props.manager.getState(id)
  if(!id||!state||props.manager.isComposing||state.doc.toString()!==snapshot||from<0||from>state.doc.length)return
  const line=state.doc.lineAt(from)
  props.manager.focusPane(props.pane,false)
  props.manager.revealPosition(id,line.number,from-line.from+1)
}
const text = computed(() => {
  const doc = props.doc?.mode === 'split' ? props.manager.getState(props.doc.id)?.doc : undefined
  if (!doc || tooLarge.value) { previousText = undefined; serialized = ''; return '' }
  if (doc !== previousText) { previousText = doc; serialized = doc.toString() }
  return serialized
})
let expectedTop: number | null = null
function currentView() { const element = host.value?.querySelector<HTMLElement>('.cm-editor'); return element ? EditorView.findFromDOM(element) : null }
function onEditorScroll(event: Event) {
  const scroller = event.target as HTMLElement
  if (props.doc?.mode !== 'split' || !scroller.classList.contains('cm-scroller')) return
  if (expectedTop !== null && Math.abs(scroller.scrollTop - expectedTop) <= 1) { expectedTop = null; return }
  expectedTop = null
  const view = currentView()
  if (!view) return
  const height = Math.max(0, scroller.getBoundingClientRect().top - view.documentTop)
  const block = view.lineBlockAtHeight(height), line = view.state.doc.lineAt(block.from)
  preview.value?.syncScroll(line.number + Math.max(0, Math.min(1, (height - block.top) / Math.max(block.height, 1))))
}
function onPreviewScroll(lineNumber: number) {
  const scroller = host.value?.querySelector<HTMLElement>('.cm-scroller')
  if (!scroller) return
  const view = currentView()
  if (!view) return
  const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, Math.floor(lineNumber))))
  const block = view.lineBlockAt(line.from)
  const next = block.top + (lineNumber % 1) * block.height + view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop
  if (Math.abs(next - scroller.scrollTop) > 1) { scroller.scrollTop = next; expectedTop = scroller.scrollTop }
}
onMounted(() => { if (host.value) props.manager.mountPane(host.value, props.pane) })
// A newly bound view may have been created while its host was still v-show hidden.
watch(() => !!props.doc, (present, previous) => {
  if (present && !previous && props.manager.activePane === props.pane) props.manager.focusPane(props.pane)
}, { flush: 'post' })
onUnmounted(() => props.manager.unmount(props.pane))
</script>
<style scoped>
.pane-body { flex:1;display:flex;min-width:0;min-height:0;position:relative;overflow:hidden }
.editor-host { flex:1;min-height:0;min-width:0;overflow:hidden;display:flex }
.editor-host :deep(.cm-editor) { height:100%;width:100% }
.markdown-budget {position:absolute;top:0;right:12px;z-index:8;font-size: var(--ui-font-size);background:var(--side);padding:5px;color:var(--muted)}
@media(max-width:900px) { .class-pane { flex-direction:column } }
</style>
