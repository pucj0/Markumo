<template>
  <div ref="root" class="pdf-page" :style="{width:`${width}px`,height:`${height}px`,'--total-scale-factor':String(scale)}" :aria-label="`第 ${number} 页`" :aria-busy="!rendered">
    <div ref="canvasHost" class="canvas-host" />
    <div ref="textHost" class="text-host" />
    <div ref="annotationHost" class="annotation-host" aria-hidden="false">
      <template v-for="link in pageLinks" :key="link.id">
        <a
          v-for="(r, idx) in link.rects"
          :key="`${link.id}-${idx}`"
          class="pdf-link-annotation"
          :style="{
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
          }"
          :href="link.type === 'url' ? link.url : '#'"
          :title="link.title || link.ariaLabel"
          :aria-label="link.ariaLabel"
          role="link"
          tabindex="0"
          @click.prevent.stop="handleClickLink(link)"
          @keydown.enter.prevent.stop="handleClickLink(link)"
          @keydown.space.prevent.stop="handleClickLink(link)"
        />
      </template>
    </div>
    <span v-if="error" class="page-message" role="status">{{ error }}</span>
    <span v-else-if="!rendered" class="page-message">第 {{ number }} 页 · 加载中…</span>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type * as PDFJS from 'pdfjs-dist'
import type { PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import { fileError } from '../../features/files/FileController'
import {
  type PdfLinkItem,
  safePdfUrl,
  convertAnnotationRects,
} from './pdfLinkUtils'

const props = defineProps<{
  pdf:PDFJS.PDFDocumentProxy; api:typeof PDFJS; number:number; scale:number; rotation:number
  pixelBudget:number; query:string; match?:number; matchRequest:number
}>()
const emit = defineEmits<{
  (e:'size',value:{page:number;width:number;height:number}):void
  (e:'match-location',value:{page:number;index:number;top:number;left:number;width:number;height:number}):void
  (e:'navigate-dest',dest:any):void
  (e:'open-url',url:string):void
  (e:'action',action:string):void
}>()
const root=ref<HTMLElement>(),canvasHost=ref<HTMLElement>(),textHost=ref<HTMLElement>(),annotationHost=ref<HTMLElement>()
const pageLinks=ref<PdfLinkItem[]>([])
const error=ref(''),rendered=ref(false),natural=reactive({width:612,height:792})
const width=computed(()=>(props.rotation%180?natural.height:natural.width)*props.scale)
const height=computed(()=>(props.rotation%180?natural.width:natural.height)*props.scale)
let page:PDFPageProxy|undefined,task:RenderTask|undefined,layer:TextLayer|undefined,pendingLayer:TextLayer|undefined
let canvas:HTMLCanvasElement|undefined,paintedRotation=0,generation=0,disposed=false
let renderTimer:ReturnType<typeof setTimeout>|undefined
let cachedAnnotations:any[]|undefined

function highlight() {
  if(!layer)return
  const query=props.query.toLocaleLowerCase(),divs=layer.textDivs,strings=layer.textContentItemsStr
  const text=strings.join('').toLocaleLowerCase(),matches:{start:number;end:number}[]=[]
  if(query)for(let pos=text.indexOf(query);pos>=0&&matches.length<10000;pos=text.indexOf(query,pos+query.length))matches.push({start:pos,end:pos+query.length})
  let offset=0,nextMatch=0
  divs.forEach((div,index)=>{
    const value=strings[index];div.textContent='';let cursor=0
    while(nextMatch<matches.length&&matches[nextMatch].end<=offset)nextMatch++
    for(let hitIndex=nextMatch;hitIndex<matches.length&&matches[hitIndex].start<offset+value.length;hitIndex++){
      const hit=matches[hitIndex],start=Math.max(0,hit.start-offset),end=Math.min(value.length,hit.end-offset)
      if(start>=end)continue
      if(start>cursor)div.append(document.createTextNode(value.slice(cursor,start)))
      const mark=document.createElement('mark');mark.textContent=value.slice(start,end);mark.className=hitIndex===props.match?'selected':''
      div.append(mark);cursor=end
    }
    div.append(document.createTextNode(value.slice(cursor)));offset+=value.length
  })
  const mark=root.value?.querySelector('mark.selected')
  if(mark&&root.value&&props.match!==undefined){
    const hit=mark.getBoundingClientRect(),box=root.value.getBoundingClientRect()
    emit('match-location',{page:props.number,index:props.match,top:hit.top-box.top,left:hit.left-box.left,width:hit.width,height:hit.height})
  }
}

function updateLinkPositions(vp:PDFJS.PageViewport) {
  if(!cachedAnnotations||!cachedAnnotations.length){
    pageLinks.value=[]
    return
  }
  const links:PdfLinkItem[]=[]
  for(const annot of cachedAnnotations){
    if(annot.subtype!=='Link'&&annot.annotationType!==2)continue
    const rects=convertAnnotationRects(vp,annot)
    if(!rects.length)continue

    let type:PdfLinkItem['type']='unsupported'
    let url:string|undefined
    let dest:any|undefined
    let action:string|undefined
    let ariaLabel='PDF 链接'
    let title=annot.overlaidText||''

    if(annot.url||annot.unsafeUrl){
      const raw=annot.url||annot.unsafeUrl
      const safe=safePdfUrl(raw)
      if(safe){
        type='url'
        url=safe
        ariaLabel=`外部链接: ${safe}`
        title=title||safe
      }else{
        type='unsupported'
        ariaLabel=`已拦截非安全链接`
        title=`已拦截非安全链接: ${raw}`
      }
    }else if(annot.dest){
      type='dest'
      dest=annot.dest
      ariaLabel=typeof annot.dest==='string'?`跳转至: ${annot.dest}`:'跳转至目标位置'
      title=title||ariaLabel
    }else if(annot.action){
      type='action'
      action=annot.action
      ariaLabel=`动作: ${annot.action}`
      title=title||ariaLabel
    }

    links.push({
      id:annot.id||`link-${links.length}`,
      rects,
      type,
      url,
      dest,
      action,
      title,
      ariaLabel,
    })
  }
  pageLinks.value=links
}

function handleClickLink(link:PdfLinkItem) {
  if(link.type==='url'&&link.url){
    emit('open-url',link.url)
  }else if(link.type==='dest'&&link.dest){
    emit('navigate-dest',link.dest)
  }else if(link.type==='action'&&link.action){
    emit('action',link.action)
  }else{
    window.dispatchEvent(new CustomEvent('editor-notice',{detail:'已拦截或忽略不受支持的 PDF 动作'}))
  }
}

function updatePreview() {
  if(canvas){
    const rotation=(props.rotation-paintedRotation+360)%360
    canvas.style.width=`${rotation%180?height.value:width.value}px`
    canvas.style.height=`${rotation%180?width.value:height.value}px`
    canvas.style.transform=`translate(-50%,-50%) rotate(${rotation}deg)`
  }
  if(page){
    const vp=page.getViewport({scale:props.scale,rotation:(page.rotate+props.rotation)%360})
    if(layer)layer.update({viewport:vp})
    updateLinkPositions(vp)
  }
}

async function render(current:number) {
  if(!page||disposed||current!==generation)return
  const targetRotation=props.rotation,viewport=page.getViewport({scale:props.scale,rotation:(page.rotate+targetRotation)%360})
  const nextCanvas=document.createElement('canvas')
  // The displayed bitmap stays visible while repainting. The parent reserves
  // half of its pixel budget for each generation rather than retaining a full cache.
  const ratio=Math.min(window.devicePixelRatio||1,2,32767/viewport.width,32767/viewport.height,Math.sqrt(props.pixelBudget/(viewport.width*viewport.height)))
  nextCanvas.width=Math.max(1,Math.floor(viewport.width*ratio));nextCanvas.height=Math.max(1,Math.floor(viewport.height*ratio))
  let committed=false,nextLayer:TextLayer|undefined
  try{
    const renderTask=page.render({canvas:nextCanvas,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});task=renderTask
    if(!cachedAnnotations){
      try{cachedAnnotations=await page.getAnnotations({intent:'display'})}
      catch{cachedAnnotations=[]}
    }
    await renderTask.promise
    if(disposed||current!==generation)return
    const text=document.createElement('div');text.className='textLayer'
    nextLayer=new props.api.TextLayer({textContentSource:page.streamTextContent(),container:text,viewport});pendingLayer=nextLayer
    await nextLayer.render()
    if(disposed||current!==generation)return
    layer?.cancel()
    if(canvas){canvas.width=0;canvas.height=0}
    canvasHost.value!.replaceChildren(nextCanvas);textHost.value!.replaceChildren(text)
    canvas=nextCanvas;layer=nextLayer;pendingLayer=undefined;paintedRotation=targetRotation;committed=true
    rendered.value=true;error.value=''
    updatePreview()
    updateLinkPositions(viewport)
    highlight()
  }catch(e){if(!disposed&&current===generation)error.value=`页面无法显示：${fileError(e)}`}
  finally{if(!committed){nextLayer?.cancel();nextCanvas.width=0;nextCanvas.height=0}}
}

function scheduleRender(delay=80) {
  const current=++generation;task?.cancel();pendingLayer?.cancel()
  if(renderTimer)clearTimeout(renderTimer)
  updatePreview()
  renderTimer=setTimeout(()=>{renderTimer=undefined;void render(current)},delay)
}
watch(()=>[props.scale,props.rotation],()=>scheduleRender())
watch(()=>props.pixelBudget,budget=>{if(canvas&&canvas.width*canvas.height>budget)scheduleRender()})
watch(()=>[props.query,props.match,props.matchRequest],highlight)
onMounted(async()=>{
  try{
    const loaded=await props.pdf.getPage(props.number)
    if(disposed){loaded.cleanup();return}
    page=loaded;const box=loaded.getViewport({scale:1});natural.width=box.width;natural.height=box.height
    emit('size',{page:props.number,width:box.width,height:box.height});scheduleRender(0)
  }catch(e){if(!disposed)error.value=`页面无法显示：${fileError(e)}`}
})
onBeforeUnmount(()=>{
  disposed=true;++generation;if(renderTimer)clearTimeout(renderTimer)
  task?.cancel();pendingLayer?.cancel();layer?.cancel()
  if(canvas){canvas.width=0;canvas.height=0}
  cachedAnnotations=undefined
  pageLinks.value=[]
  textHost.value?.replaceChildren();canvasHost.value?.replaceChildren();annotationHost.value?.replaceChildren()
  const oldPage=page
  if(task)void task.promise.catch(()=>{}).finally(()=>oldPage?.cleanup());else oldPage?.cleanup()
  page=undefined;layer=undefined;canvas=undefined
})
</script>
<style scoped>
.pdf-page {position:absolute;background:#fff;color:#222;box-shadow:0 0 0 1px #00000012,0 2px 8px #0000001a;overflow:hidden;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
.canvas-host,.text-host,.annotation-host {position:absolute;inset:0;overflow:hidden}
.canvas-host :deep(canvas) {position:absolute;left:50%;top:50%;display:block;transform-origin:center}
.page-message {position:absolute;top:45%;left:10%;right:10%;text-align:center;color:#666;font-size:12px;pointer-events:none}
.text-host :deep(.textLayer) {position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;transform-origin:0 0;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none}
.text-host :deep(.textLayer :is(span,br)) {color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0;user-select:text}
.text-host :deep(.textLayer .markedContent) {display:contents}
.text-host :deep(.textLayer > :not(.markedContent)),.text-host :deep(.textLayer .markedContent span:not(.markedContent)) {font-size:calc(var(--text-scale-factor) * var(--font-height));transform:rotate(var(--rotate,0deg)) scaleX(var(--scale-x,1)) scale(var(--min-font-size-inv))}
.text-host :deep(::selection) {background:#0066ff55;color:transparent}
.text-host :deep(mark) {color:transparent;background:#ffbf0080;border-radius:2px}
.text-host :deep(mark.selected) {background:#ff7000b0}
.annotation-host {pointer-events:none;z-index:2}
.annotation-host .pdf-link-annotation {position:absolute;pointer-events:auto;cursor:pointer;background:transparent;border-radius:2px;box-sizing:border-box;transition:background-color 0.12s ease;outline:none;text-decoration:none;display:block}
.annotation-host .pdf-link-annotation:hover {background-color:rgba(30,144,255,0.14)}
.annotation-host .pdf-link-annotation:focus-visible {outline:2px solid var(--accent,#9c93f4);outline-offset:1px;background-color:rgba(30,144,255,0.18)}
</style>
