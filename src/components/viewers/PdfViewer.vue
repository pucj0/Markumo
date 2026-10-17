<template>
  <section class="media-viewer" aria-label="PDF 查看器">
    <div class="media-toolbar" role="toolbar" aria-label="PDF 工具栏">
      <button :disabled="!pdf || page<=1" title="首页" aria-label="首页" @click="jump(1)">⇤</button>
      <button :disabled="!pdf || page<=1" title="上一页" aria-label="上一页" @click="jump(page-1)">‹</button>
      <input :value="page" type="number" min="1" :max="total" class="page-input" aria-label="页码" :disabled="!pdf" @change="jump(Number(($event.target as HTMLInputElement).value))" />
      <span>/ {{ total }}</span>
      <button :disabled="!pdf || page>=total" title="下一页" aria-label="下一页" @click="jump(page+1)">›</button>
      <button :disabled="!pdf || page>=total" title="末页" aria-label="末页" @click="jump(total)">⇥</button>
      <button :disabled="!pdf" aria-label="缩小" @click="zoom(1/1.25)">−</button>
      <button :disabled="!pdf" aria-label="放大" @click="zoom(1.25)">＋</button>
      <button :disabled="!pdf" @click="setFit('width')">适应宽度</button>
      <button :disabled="!pdf" @click="setFit('page')">适应页面</button>
      <button :disabled="!pdf" @click="toggleContinuous">{{ view.continuous ? '连续' : '单页' }}</button>
      <button :disabled="!pdf" @click="focusSearch">搜索</button>
      <button title="重新读取磁盘文件" @click="load">↻</button>
      <button @click="openDefault">系统打开</button>
      <span class="media-info" :title="doc.name">{{ doc.name }} · {{ Math.round(scale*100) }}% · {{ mediaSize(meta?.byteLength||0) }}</span>
    </div>
    <form v-if="searchOpen" class="media-toolbar" role="search" @submit.prevent="findNext(1)">
      <input ref="searchInput" v-model="query" aria-label="搜索 PDF 文本" placeholder="搜索文本（扫描 PDF 无文本层）" />
      <span>{{ matches.length ? matchIndex+1 : 0 }} / {{ matches.length }}{{ searching ? ' · 搜索中…' : '' }}{{ capped ? '（结果已截断）' : '' }}</span>
      <button type="button" :disabled="!matches.length" @click="findNext(-1)">上一个</button>
      <button type="submit" :disabled="!matches.length">下一个</button>
      <button type="button" @click="closeSearch">关闭</button>
      <span v-if="searchError">{{ searchError }}</span>
    </form>
    <form v-if="passwordNeeded" class="password-form" @submit.prevent="submitPassword">
      <label>{{ passwordWrong ? '密码不正确，请重试' : '此 PDF 已加密，请输入密码' }}<input v-model="password" type="password" autocomplete="off" autofocus aria-label="PDF 密码" /></label>
      <button>打开</button><button type="button" @click="cancelPassword">取消</button>
    </form>
    <MediaEmpty v-else-if="!pdf" :error="error" :token="doc.fileToken" @retry="load" />
    <div v-show="pdf" ref="viewport" class="media-viewport pdf-viewport" tabindex="0" @scroll.passive="onScroll">
      <div class="pdf-pages" :style="{height:`${view.continuous ? offsets[total] : pageHeight(page)+24}px`, minWidth:`${maxWidth+24}px`}">
        <PdfPage v-for="number in visiblePages" :key="`${renderEpoch}:${number}`" :pdf="pdf!" :api="api!" :number="number" :scale="scale" :pixel-budget="Math.floor(64*1024*1024/4/Math.max(3,visiblePages.length))" :query="query" :match="selected?.page===number ? selected.index : undefined" :style="{top:`${view.continuous ? offsets[number-1]+12 : 12}px`,left:`max(12px, calc(50% - ${pageWidth(number)/2}px))`}" @size="rememberSize" />
      </div>
    </div>
    <div v-if="error && pdf" class="pdf-notice" role="alert">{{ error }} <button @click="load">重新加载</button></div>
  </section>
</template>
<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type * as PDFJS from 'pdfjs-dist'
import type { EditorDocument } from '../../types'
import type { MediaMetadata } from '../../features/files/contracts'
import { MEDIA_CHUNK, mediaMetadata, mediaSize, openMediaDefault, readMediaChunk, type MediaViewState } from '../../features/files/media'
import { fileError } from '../../features/files/FileController'
import PdfPage from './PdfPage.vue'
import MediaEmpty from './MediaEmpty.vue'
import './viewer.css'
const props=defineProps<{doc:EditorDocument;pane:string;state:MediaViewState}>()
const emit=defineEmits<{(e:'metadata',media:MediaMetadata,version:string):void}>()
const view=reactive(props.state), pdf=shallowRef<PDFJS.PDFDocumentProxy>(), api=shallowRef<typeof PDFJS>(), meta=ref<MediaMetadata>()
const viewport=ref<HTMLElement>(), error=ref(''), total=ref(0), page=ref(view.page), scale=ref(view.scale), renderEpoch=ref(0)
const viewportHeight=ref(800)
const sizes=reactive(new Map<number,{width:number;height:number}>()), fallback=reactive({width:612,height:792})
const pageWidth=(n:number)=>(sizes.get(n)?.width||fallback.width)*scale.value
const pageHeight=(n:number)=>(sizes.get(n)?.height||fallback.height)*scale.value
const offsets=computed(()=>{const out=[0];for(let n=1;n<=total.value;n++)out.push(out[n-1]+pageHeight(n)+16);return out})
const maxWidth=computed(()=>Math.max(...visiblePages.value.map(pageWidth),1))
function pageAt(y:number){let lo=0,hi=total.value;while(lo<hi){const mid=(lo+hi+1)>>1;if(offsets.value[mid]<=y)lo=mid;else hi=mid-1}return Math.min(total.value,lo+1)}
// No placeholder DOM per page. Usually three pages; include every visible page
// when zoomed far out, dividing the same pixel budget across the larger window.
const visiblePages=computed(()=>{
  if(!pdf.value)return []
  if(!view.continuous)return [page.value]
  const first=pageAt(view.top),last=pageAt(view.top+viewportHeight.value)
  const out=[page.value]
  for(let n=Math.max(1,first-1);n<=Math.min(total.value,last+1);n++)if(n!==page.value)out.push(n)
  return out
})
const searchOpen=ref(!!view.query), query=ref(view.query), searchInput=ref<HTMLInputElement>(), searching=ref(false), searchError=ref(''), capped=ref(false)
const matches=ref<{page:number;index:number}[]>([]), matchIndex=ref(0), selected=computed(()=>matches.value[matchIndex.value])
const passwordNeeded=ref(false),passwordWrong=ref(false),password=ref('')
let passwordCallback:((value:string)=>void)|undefined, generation=0, searchGeneration=0, disposed=false
let loading:PDFJS.PDFDocumentLoadingTask|undefined, nativeWorker:Worker|undefined, worker:PDFJS.PDFWorker|undefined, transport:PDFJS.PDFDataRangeTransport|undefined
let resize:ResizeObserver|undefined, scrollFrame=0, searchTimer:ReturnType<typeof setTimeout>|undefined
let destroyPending:Promise<unknown>=Promise.resolve()
async function teardown() {
  ++searchGeneration;searching.value=false;passwordNeeded.value=false;passwordCallback=undefined;password.value=''
  const oldLoading=loading,oldWorker=worker,oldNative=nativeWorker,oldTransport=transport
  loading=undefined;pdf.value=undefined;worker=undefined;nativeWorker=undefined;transport=undefined
  oldTransport?.abort()
  await nextTick() // Unmount pages and cancel renderers before destroying their transport.
  let timeout: ReturnType<typeof setTimeout> | undefined
  try { if(oldLoading)await Promise.race([oldLoading.destroy(),new Promise<void>(resolve=>{timeout=setTimeout(resolve,2000)})]) } catch { /* Already destroyed during load. */ }
  finally {if(timeout)clearTimeout(timeout);oldWorker?.destroy();oldNative?.terminate()}
}
async function load() {
  const current=++generation;error.value=''
  destroyPending=teardown();await destroyPending
  if(disposed||generation!==current)return
  sizes.clear();matches.value=[];total.value=0
  try {
    const [metadata,version]=await mediaMetadata(props.doc.fileToken!)
    const module=await import('pdfjs-dist')
    if(disposed||generation!==current)return
    api.value=module;meta.value=metadata
    emit('metadata',metadata,version)
    if(metadata.mime!=='application/pdf')throw new Error('文件格式已改变，请关闭并重新打开。')
    nativeWorker=new Worker(new URL(`${import.meta.env.BASE_URL}pdfjs/pdf.worker.min.mjs`,document.baseURI),{type:'module'})
    nativeWorker.addEventListener('error',()=>{
      if(!disposed&&generation===current){error.value='PDF Worker 无法启动，请更新 WebView2 或使用系统默认程序。';void teardown()}
    },{once:true})
    worker=module.PDFWorker.create({port:nativeWorker})
    const first=await readMediaChunk(props.doc.fileToken!,version,0,Math.min(MEDIA_CHUNK,metadata.byteLength))
    if(disposed||generation!==current)return
    // One IPC request at a time. PDF.js may ask for a wide range; split it into bounded chunks.
    let stopped=false,queue:Promise<void>=Promise.resolve()
    class TokenRange extends module.PDFDataRangeTransport {
      requestDataRange(begin:number,end:number) {
        queue=queue.then(async()=>{
          if(end-begin>32*1024*1024)throw new Error('PDF 单个数据范围超过 32 MiB 内存预算，请使用系统默认程序。')
          const data=new Uint8Array(end-begin)
          for(let offset=begin;offset<end;offset+=MEDIA_CHUNK){
            if(stopped||disposed||generation!==current)return
            const bytes=await readMediaChunk(props.doc.fileToken!,version,offset,Math.min(MEDIA_CHUNK,end-offset))
            if(stopped||disposed||generation!==current)return
            data.set(bytes,offset-begin)
          }
          if(!stopped)this.onDataRange(begin,data)
        }).catch(e=>{if(!stopped&&!disposed&&generation===current){error.value=fileError(e);stopped=true;void teardown()}})
      }
      abort(){stopped=true}
    }
    transport=new TokenRange(metadata.byteLength,first,true)
    loading=module.getDocument({range:transport,worker,rangeChunkSize:MEDIA_CHUNK,disableStream:true,disableAutoFetch:true,
      maxImageSize:32*1024*1024,canvasMaxAreaInBytes:32*1024*1024,
      wasmUrl:new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`,document.baseURI).href,
      cMapUrl:new URL(`${import.meta.env.BASE_URL}pdfjs/cmaps/`,document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL(`${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,document.baseURI).href})
    loading.onPassword=(callback:(value:string)=>void,reason:number)=>{if(disposed||generation!==current)return;passwordCallback=callback;passwordWrong.value=reason===module.PasswordResponses.INCORRECT_PASSWORD;passwordNeeded.value=true}
    const documentProxy=await loading.promise
    if(disposed||generation!==current)return
    const firstPage=await documentProxy.getPage(1)
    if(disposed||generation!==current)return
    const box=firstPage.getViewport({scale:1});fallback.width=box.width;fallback.height=box.height;firstPage.cleanup()
    total.value=documentProxy.numPages;page.value=Math.min(Math.max(1,view.page),total.value);pdf.value=markRaw(documentProxy)
    await nextTick();updateFit();await nextTick();jump(page.value)
    if(viewport.value){viewport.value.scrollLeft=view.left; if(view.continuous&&view.top)viewport.value.scrollTop=view.top}
    if(query.value)void search()
  }catch(e){if(!disposed&&generation===current){error.value=`PDF 加载失败：${fileError(e)}`;await teardown()}}
}
function submitPassword(){passwordCallback?.(password.value);password.value='';passwordNeeded.value=false}
function cancelPassword(){++generation;error.value='已取消输入密码。';void teardown()}
function updateFit(){
  if(!pdf.value||!viewport.value||!viewport.value.clientWidth||view.fit==='manual')return
  const dimensions=sizes.get(page.value)||fallback
  const w=Math.max(1,viewport.value.clientWidth-32)/dimensions.width,h=Math.max(1,viewport.value.clientHeight-24)/dimensions.height
  changeScale(Math.max(.05,Math.min(4,view.fit==='width'?w:Math.min(w,h))))
}
function changeScale(value:number){if(Math.abs(scale.value-value)<.001)return;scale.value=value;view.scale=value;renderEpoch.value++;void nextTick(()=>jump(page.value))}
function setFit(mode:string){view.fit=mode;updateFit()}
function zoom(factor:number){view.fit='manual';changeScale(Math.max(.05,Math.min(4,scale.value*factor)))}
function jump(n:number){if(!total.value||!Number.isFinite(n))return;page.value=Math.max(1,Math.min(total.value,Math.round(n)));view.page=page.value;viewport.value?.scrollTo({top:view.continuous?offsets.value[page.value-1]:0});view.top=viewport.value?.scrollTop||0}
function toggleContinuous(){view.continuous=!view.continuous;void nextTick(()=>jump(page.value))}
function onScroll(){
  if(scrollFrame)return
  scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;if(!viewport.value)return;view.left=viewport.value.scrollLeft;view.top=viewport.value.scrollTop
    if(!view.continuous)return
    const y=viewport.value.scrollTop+Math.min(80,viewport.value.clientHeight/3)
    page.value=pageAt(y);view.page=page.value
  })
}
function rememberSize(value:{page:number;width:number;height:number}){const old=sizes.get(value.page);if(old?.width===value.width&&old.height===value.height)return;const before=offsets.value[page.value-1];sizes.set(value.page,{width:value.width,height:value.height});if(viewport.value&&view.continuous)viewport.value.scrollTop+=offsets.value[page.value-1]-before}
async function focusSearch(){searchOpen.value=true;await nextTick();searchInput.value?.focus();searchInput.value?.select()}
function closeSearch(){searchOpen.value=false;query.value='';matches.value=[];++searchGeneration;searching.value=false}
async function search(){
  const current=++searchGeneration,documentProxy=pdf.value,term=query.value.toLocaleLowerCase();matches.value=[];matchIndex.value=0;searchError.value='';capped.value=false
  if(!documentProxy||!term){searching.value=false;return}
  searching.value=true
  try{
    for(let n=1;n<=documentProxy.numPages;n++){
      if(disposed||current!==searchGeneration)return
      const p=await documentProxy.getPage(n),content=await p.getTextContent()
      if(disposed||current!==searchGeneration){p.cleanup();return}
      const text=content.items.map(item=>'str'in item?item.str:'').join('').toLocaleLowerCase()
      let index=0
      for(let pos=text.indexOf(term);pos>=0;pos=text.indexOf(term,pos+term.length)){
        if(matches.value.length>=10000){capped.value=true;break}
        matches.value.push({page:n,index:index++})
      }
      if(!visiblePages.value.includes(n))p.cleanup()
      if(capped.value)break
      await new Promise<void>(resolve=>setTimeout(resolve,0))
    }
    if(current===searchGeneration&&matches.value.length)jump(matches.value[0].page)
  }catch(e){if(!disposed&&current===searchGeneration)searchError.value=fileError(e)}
  finally{if(current===searchGeneration)searching.value=false}
}
function findNext(direction:number){if(!matches.value.length)return;matchIndex.value=(matchIndex.value+direction+matches.value.length)%matches.value.length;jump(matches.value[matchIndex.value].page)}
watch(query,()=>{view.query=query.value;++searchGeneration;if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(()=>void search(),250)})
function command(event:Event){const detail=(event as CustomEvent).detail;if(detail.pane!==props.pane)return;if(detail.command==='find')void focusSearch();else findNext(detail.command==='find-next'?1:-1)}
async function openDefault(){try{await openMediaDefault(props.doc.fileToken!)}catch(e){error.value=fileError(e)}}
onMounted(()=>{resize=new ResizeObserver(()=>{viewportHeight.value=viewport.value?.clientHeight||800;updateFit()});if(viewport.value)resize.observe(viewport.value);window.addEventListener('pdf-command',command);void load()})
onBeforeUnmount(()=>{disposed=true;++generation;++searchGeneration;resize?.disconnect();window.removeEventListener('pdf-command',command);cancelAnimationFrame(scrollFrame);if(searchTimer)clearTimeout(searchTimer);matches.value=[];sizes.clear();void teardown()})
</script>
<style scoped>
.page-input {width:58px}
.pdf-viewport {background:var(--side)}
.pdf-pages {position:relative;min-height:100%;width:100%}
.password-form {margin:auto;display:flex;gap:8px;align-items:center;padding:20px;flex-wrap:wrap}
.password-form input {display:block;margin-top:8px;background:var(--bar);color:var(--ink);border:1px solid var(--line);padding:6px}
.pdf-notice {padding:5px 12px;color:var(--ink);background:var(--bar)}
</style>
