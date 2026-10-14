<template>
  <div class="pane-body">
    <div ref="host" class="editor-host" @scroll.capture="onEditorScroll"></div>
    <SplitPreview v-if="doc?.mode === 'split'" ref="preview" :content="text" :too-large="tooLarge" @scroll-ratio="onPreviewScroll" />
    <div v-if="!doc" class="pane-empty">将标签拖到此处，或新建文件</div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import SplitPreview from '../../editor/markdown/splitPreview.vue'
import type { DocumentManager, Pane } from '../../editor/core/DocumentManager'
import type { EditorDocument } from '../../types'
import type { Text } from '@codemirror/state'
const props = defineProps<{ manager: DocumentManager; pane: Pane; doc: EditorDocument | null }>()
const host = ref<HTMLElement | null>(null), preview = ref<InstanceType<typeof SplitPreview> | null>(null)
let previousText: Text | undefined, serialized = ''
const tooLarge = computed(() => !!props.doc && (props.manager.getState(props.doc.id)?.doc.length || 0) > 1024 * 1024)
const text = computed(() => {
  const doc = props.doc?.mode === 'split' ? props.manager.getState(props.doc.id)?.doc : undefined
  if (!doc || tooLarge.value) { previousText = undefined; serialized = ''; return '' }
  if (doc !== previousText) { previousText = doc; serialized = doc.toString() }
  return serialized
})
function onEditorScroll(event: Event) {
  const scroller = event.target as HTMLElement
  if (props.doc?.mode !== 'split' || !scroller.classList.contains('cm-scroller')) return
  const max = scroller.scrollHeight - scroller.clientHeight
  if (max > 0) preview.value?.syncScroll(scroller.scrollTop / max)
}
function onPreviewScroll(ratio: number) {
  const scroller = host.value?.querySelector<HTMLElement>('.cm-scroller')
  if (!scroller) return
  const next = ratio * (scroller.scrollHeight - scroller.clientHeight)
  if (Math.abs(next - scroller.scrollTop) > 1) scroller.scrollTop = next
}
onMounted(() => { if (host.value) props.pane === 'main' ? props.manager.mount(host.value) : props.manager.mountSecondary(host.value) })
onUnmounted(() => props.manager.unmount(props.pane))
</script>
<style scoped>
.pane-body { flex:1;display:flex;min-width:0;min-height:0;position:relative;overflow:hidden }
.editor-host { flex:1;min-height:0;min-width:0;overflow:hidden;display:flex }
.editor-host :deep(.cm-editor) { height:100%;width:100% }
.pane-empty { position:absolute;inset:40px 12px auto;text-align:center;color:var(--muted);pointer-events:none }
</style>
