<template>
  <nav v-if="doc" class="breadcrumb" aria-label="文件路径与当前结构">
    <template v-for="(crumb,index) in crumbs" :key="crumb.path">
      <span v-if="index" class="crumb-separator" aria-hidden="true">›</span>
      <button v-if="crumb.directory" class="crumb-directory" :class="{ 'crumb-root':index===0,'crumb-parent':index===crumbs.length-2 }" :title="readablePath(crumb.path)" :aria-label="`浏览目录 ${crumb.name}`" @click="openDirectory($event,crumb.path)">{{ crumb.name }}</button>
      <span v-else class="crumb-file" :title="readablePath(doc.path)">{{ doc.name }}</span>
    </template>
    <span v-if="!crumbs.length" class="crumb-file" :title="readablePath(doc.path) || doc.name">{{ doc.name }}</span>
    <span v-if="doc.kind==='javaClass'" class="readonly-kind">JVM ClassFile · 只读</span>
    <template v-for="symbol in symbolChain" :key="symbol.id">
      <span class="crumb-separator symbol-separator" aria-hidden="true">›</span>
      <button class="crumb-symbol" :title="`${symbol.kind==='heading' ? '标题' : '代码符号'}：${symbol.name}`" @click="revealSymbol(symbol)"><Icon :name="symbol.kind==='heading' ? 'outline' : 'symbol-'+symbol.kind" size="small" />{{ symbol.name }}{{ ['method','function','constructor'].includes(symbol.kind || '') ? '()' : '' }}</button>
    </template>
    <NavigationPopup v-if="menuAnchor" :key="menuPath" :anchor="menuAnchor" :title="menuPath" filter-label="筛选目录文件" :items="menuItems" :message="message" :parent-label="parentPath" action-label="在工作区文件树中定位当前文件" @select="choose" @parent="loadDirectory(parentPath!)" @action="revealTree" @close="close" />
  </nav>
</template>
<script setup lang="ts">
import { computed, inject, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { EditorDocument } from '../../types'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { useDocumentOutline } from '../../editor/outline/useDocumentOutline'
import { useOutlineViewport } from '../../editor/outline/useOutlineViewport'
import type { OutlineItem } from '../../editor/outline/outlineService'
import { displayPathKey, readablePath } from '../../features/shell/pathDisplay'
import { navigationDirectory, navigationParent, pathCrumbs, workspaceNavigationKey } from '../../features/workspace/navigation'
import type { WorkspaceNode } from '../../features/workspace/contracts'
import NavigationPopup from '../common/NavigationPopup.vue'
import Icon from '../common/Icon.vue'
const props=withDefaults(defineProps<{doc:EditorDocument|null;manager?:DocumentManager;pane?:string;active?:boolean}>(),{pane:'main',active:true})
const navigation=inject(workspaceNavigationKey,undefined)
const crumbs=computed(()=>props.doc?.path && navigation?.enabled() ? pathCrumbs(props.doc.path,navigation.workspace.roots) : [])
const structure=useDocumentOutline(()=>props.manager,()=>props.doc,()=>!!props.active && !!props.manager && (!props.doc?.kind || props.doc.kind==='text'))
const activeSymbol=useOutlineViewport(()=>props.manager,()=>props.doc?.id,()=>structure.value.items)
const symbolChain=computed(()=>{
  const items=structure.value.items,index=items.findIndex(item=>item.id===activeSymbol.value)
  if(index<0)return []
  const current=items[index],chain:OutlineItem[]=[]
  if(current.kind==='heading'){
    for(const item of items.slice(0,index+1)){while(chain.length&&chain[chain.length-1].level>=item.level)chain.pop();chain.push(item)}
  }else{
    const byId=new Map(items.map(item=>[item.id,item]));let item:OutlineItem|undefined=current
    while(item){chain.unshift(item);item=item.parentId?byId.get(item.parentId):undefined}
  }
  return chain.slice(-3)
})
function revealSymbol(item:OutlineItem){const m=props.manager;if(!m||!props.doc)return;m.focusPane(props.pane,false);if(m.activePane===props.pane)m.revealOutline(props.doc.id,item)}
const menuAnchor=shallowRef<HTMLElement|null>(null),menuPath=ref(''),nodes=shallowRef<WorkspaceNode[]>([]),message=ref('')
let epoch=0
const menuItems=computed(()=>nodes.value.map(node=>({id:node.path,label:node.name,directory:node.isDirectory})))
const parentPath=computed(()=>navigationParent(menuPath.value,navigation?.workspace.rootForPath(menuPath.value)||null))
function close(restore=false){++epoch;const anchor=menuAnchor.value;menuAnchor.value=null;nodes.value=[];if(restore&&anchor?.isConnected)anchor.focus()}
function openDirectory(event:MouseEvent,path:string){close();menuAnchor.value=event.currentTarget as HTMLElement;void loadDirectory(path)}
async function loadDirectory(path:string){
  if(!navigation?.enabled())return close()
  const current=++epoch;menuPath.value=path;nodes.value=[];message.value='正在加载目录…'
  try{const result=await navigationDirectory(navigation.workspace,path);if(current!==epoch)return;nodes.value=result.nodes;message.value=result.limited?'目录较大，仅列出前 1000 项。':result.nodes.length?'':'此目录没有可导航的文件。'}
  catch(error){if(current===epoch)message.value=`无法加载目录：${String(error)}`}
}
async function choose(path:string){
  const node=nodes.value.find(node=>node.path===path),m=props.manager
  if(!node||!navigation?.enabled()||!m||!navigation.workspace.rootForPath(path))return
  if(node.isDirectory)return loadDirectory(path)
  close();m.focusPane(props.pane,false)
  if(m.activePane!==props.pane)return
  await navigation.workspace.openFile(node)
  if(m.activePane===props.pane&&displayPathKey(m.activeDocument?.path||'')===displayPathKey(path))m.focusPane(props.pane)
}
async function revealTree(){
  const path=props.doc?.path,current=epoch
  if(!path||!navigation?.enabled())return
  const found=await navigation.reveal(path)
  if(current!==epoch)return
  if(found)close();else message.value='无法在当前工作区文件树中定位该文件。'
}
watch([()=>props.doc?.id,()=>props.doc?.path,()=>props.active,()=>navigation?.enabled(),()=>navigation?.workspace.openRevision],()=>close())
onUnmounted(()=>{++epoch;menuAnchor.value=null})
</script>
<style scoped>
.breadcrumb{display:flex;align-items:center;gap:4px;height:25px;min-width:0;flex:none;overflow:hidden;padding:0 10px;color:var(--muted);border-bottom:1px solid var(--line);font-size:var(--ui-small-font-size);white-space:nowrap;background:var(--editor)}
.breadcrumb button{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 3px;border:0;border-radius:3px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.breadcrumb button:hover{background:var(--hover);color:var(--ink)}.breadcrumb button:focus-visible{outline:1px solid var(--accent)}.crumb-file{overflow:hidden;text-overflow:ellipsis;min-width:30px;flex-shrink:0;max-width:220px;color:var(--ink)}.crumb-separator{opacity:.5;flex:none}.crumb-symbol{flex-shrink:2}.crumb-symbol .icon{flex:none}.readonly-kind{font-size:var(--ui-small-font-size);color:var(--muted)}
@container (max-width:600px){.crumb-directory:not(.crumb-root):not(.crumb-parent),.crumb-directory:not(.crumb-root):not(.crumb-parent)+.crumb-separator{display:none}.crumb-symbol:not(:last-child),.symbol-separator:not(:nth-last-child(2)){display:none}.crumb-root{max-width:90px!important}.crumb-file{max-width:140px;flex-shrink:1}}
</style>
