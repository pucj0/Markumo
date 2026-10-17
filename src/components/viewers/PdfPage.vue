<template>
  <div ref="root" class="pdf-page" :style="{ width:`${size.width}px`,height:`${size.height}px`, '--total-scale-factor': String(scale) }" :aria-label="`第 ${number} 页`">
    <canvas ref="canvas" />
    <div ref="textHost" class="textLayer" />
    <span v-if="error" class="page-message">{{ error }}</span>
    <span v-else-if="!rendered" class="page-message">第 {{ number }} 页 · 加载中…</span>
  </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type * as PDFJS from 'pdfjs-dist'
import type { PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import { fileError } from '../../features/files/FileController'
const props = defineProps<{ pdf: PDFJS.PDFDocumentProxy; api: typeof PDFJS; number: number; scale: number; pixelBudget: number; query: string; match?: number }>()
const emit = defineEmits<{ (e:'size', value:{page:number;width:number;height:number}):void }>()
const root=ref<HTMLElement>(), canvas=ref<HTMLCanvasElement>(), textHost=ref<HTMLElement>(), error=ref(''), rendered=ref(false)
const size=reactive({width:600,height:800})
let page: PDFPageProxy | undefined, task: RenderTask | undefined, layer: TextLayer | undefined, disposed=false
// Three pages share a 64 MiB pixel budget; CSS size stays independent of backing resolution.
function highlight() {
  if(!layer)return
  const query=props.query.toLocaleLowerCase(), divs=layer.textDivs, strings=layer.textContentItemsStr
  const text=strings.join('').toLocaleLowerCase()
  const matches:{start:number;end:number}[]=[]
  if(query)for(let i=text.indexOf(query);i>=0 && matches.length<10000;i=text.indexOf(query,i+query.length))matches.push({start:i,end:i+query.length})
  let offset=0
  let nextMatch=0
  divs.forEach((div,i)=>{
    const value=strings[i]; div.textContent=''; let cursor=0
    while(nextMatch<matches.length && matches[nextMatch].end<=offset)nextMatch++
    for(let index=nextMatch;index<matches.length && matches[index].start<offset+value.length;index++){
      const hit=matches[index]
      const start=Math.max(0,hit.start-offset), end=Math.min(value.length,hit.end-offset)
      if(start>=end)continue
      if(start>cursor)div.append(document.createTextNode(value.slice(cursor,start)))
      const mark=document.createElement('mark');mark.textContent=value.slice(start,end);mark.className=index===props.match?'selected':'';div.append(mark);cursor=end
    }
    div.append(document.createTextNode(value.slice(cursor)));offset+=value.length
  })
  root.value?.querySelector('mark.selected')?.scrollIntoView({block:'nearest',inline:'nearest'})
}
async function render() {
  try {
    page=await props.pdf.getPage(props.number)
    if(disposed) { page.cleanup(); return }
    const viewport=page.getViewport({scale:props.scale})
    size.width=viewport.width;size.height=viewport.height
    emit('size',{page:props.number,width:viewport.width/props.scale,height:viewport.height/props.scale})
    const c=canvas.value!, ratio=Math.min(window.devicePixelRatio||1,2,32767/viewport.width,32767/viewport.height,Math.sqrt(props.pixelBudget/(viewport.width*viewport.height)))
    c.width=Math.max(1,Math.floor(viewport.width*ratio));c.height=Math.max(1,Math.floor(viewport.height*ratio))
    c.style.width=`${viewport.width}px`;c.style.height=`${viewport.height}px`
    task=page.render({canvas:c,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]})
    await task.promise
    if(disposed)return
    layer=new props.api.TextLayer({textContentSource:page.streamTextContent(),container:textHost.value!,viewport})
    await layer.render()
    if(!disposed){rendered.value=true;highlight()}
  } catch(e) { if(!disposed)error.value=`页面无法显示：${fileError(e)}` }
}
watch(()=>[props.query,props.match],highlight)
onMounted(()=>void render())
onBeforeUnmount(()=>{
  disposed=true;task?.cancel();layer?.cancel();textHost.value?.replaceChildren()
  if(canvas.value){canvas.value.width=0;canvas.value.height=0}
  // Wait until a cancelled renderer stops touching the page before releasing its operator list.
  const oldPage=page
  if(task)void task.promise.catch(()=>{}).finally(()=>oldPage?.cleanup());else oldPage?.cleanup()
  page=undefined;layer=undefined
})
</script>
<style scoped>
.pdf-page {position:absolute;background:white;color:#222;box-shadow:0 1px 5px #0004;overflow:hidden;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
canvas {display:block}
.page-message {position:absolute;top:45%;left:10%;right:10%;text-align:center;color:#666}
.textLayer {position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;transform-origin:0 0;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none}
.textLayer :deep(:is(span,br)) {color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0;user-select:text}
.textLayer :deep(.markedContent) {display:contents}
.textLayer :deep(> :not(.markedContent)),.textLayer :deep(.markedContent span:not(.markedContent)) {font-size:calc(var(--text-scale-factor) * var(--font-height));transform:rotate(var(--rotate,0deg)) scaleX(var(--scale-x,1)) scale(var(--min-font-size-inv))}
.textLayer :deep(::selection) {background:#0066ff55;color:transparent}
.textLayer :deep(mark) {color:transparent;background:#ffbf0080;border-radius:2px}
.textLayer :deep(mark.selected) {background:#ff7000b0}
</style>
