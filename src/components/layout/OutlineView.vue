<template>
  <div class="outline-container">
    <div v-if="!isMarkdown" class="outline-filter">
      <input v-model="query" aria-label="筛选符号" placeholder="筛选符号…" maxlength="128" />
      <select v-model="kindFilter" aria-label="符号种类">
        <option value="">所有种类</option>
        <option v-for="kind in kinds" :key="kind" :value="kind">{{ kind }}</option>
      </select>
    </div>
    <p v-if="notice" class="empty-text" role="status">{{ notice }}</p>
    <div v-if="items.length === 0 && !notice" class="empty-outline">
      <p class="empty-text">
        {{ isMarkdown ? '当前 Markdown 文件未发现标题结构' : '当前文件未发现可提取的符号或大纲' }}
      </p>
    </div>

    <div v-else-if="items.length" ref="list" class="outline-list" role="tree" aria-label="文档结构">
      <button
        v-for="(item,index) in visibleItems"
        :key="item.id"
        class="outline-item"
        :class="[`level-${item.level}`, item.kind, { active: item.id === visibleActiveId }]"
        :aria-current="item.id === visibleActiveId ? 'location' : undefined"
        role="treeitem"
        :aria-level="item.level"
        :aria-expanded="hasChildren(item) ? filtering || !collapsed.has(item.id) : undefined"
        :tabindex="item.id === focusedId || (!focusedId && index===0) ? 0 : -1"
        :style="{ paddingLeft: `${(item.level - 1) * 12 + 10}px` }"
        :title="`跳转至第 ${item.lineNumber} 行: ${item.name}`"
        @click="$emit('select-item', item)"
        @focus="focusedId=item.id"
        @keydown="navigate($event,index)"
      >
        <span class="outline-fold-slot">
          <span
            v-if="hasChildren(item)"
            class="outline-fold"
            role="button"
            :aria-label="(collapsed.has(item.id) ? '展开' : '折叠')+(isMarkdown ? '标题' : '符号')"
            :tabindex="isMarkdown ? 0 : -1"
            @click.stop="toggle(item.id)"
            @keydown.enter.stop.prevent="toggle(item.id)"
            @keydown.space.stop.prevent="toggle(item.id)"
          >{{ !filtering && collapsed.has(item.id) ? '▸' : '▾' }}</span>
        </span>
        <Icon v-if="item.kind && item.kind !== 'heading'" :name="'symbol-'+item.kind" size="small" :class="'symbol-'+item.kind" />
        <span v-if="item.kind==='heading' && item.labelHtml" class="outline-label" v-html="item.labelHtml" />
        <span v-else class="outline-label"><template v-for="(part,partIndex) in labelParts(item)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
        <span v-if="item.detail" class="outline-detail">{{ item.detail }}</span>
        <span class="outline-line">L{{ item.lineNumber }}</span>
      </button>
    </div>
    <p v-if="items.length && !visibleItems.length" class="empty-text" role="status">没有匹配的符号</p>
  </div>
</template>

<script setup lang="ts">
import type { OutlineItem } from '../../editor/outline/outlineService'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { useOutlineViewport } from '../../editor/outline/useOutlineViewport'
import { computed,ref,watch,nextTick } from 'vue'
import Icon from '../common/Icon.vue'

const props=defineProps<{
  items: OutlineItem[]
  isMarkdown: boolean
  notice?: string
  manager?: DocumentManager
  documentId?: string | null
}>()
const activeId = useOutlineViewport(() => props.manager, () => props.documentId, () => props.items)
const collapsed=ref(new Set<string>())
const foldStates=new Map<string,Set<string>>()
watch(()=>props.documentId,id=>{
  const key=id||'standalone'
  if(!foldStates.has(key))foldStates.set(key,new Set())
  collapsed.value=foldStates.get(key)!
  if(foldStates.size>12)foldStates.delete(foldStates.keys().next().value!)
},{immediate:true})
const query=ref(''),kindFilter=ref(''),focusedId=ref(''),list=ref<HTMLElement>()
const kinds=computed(()=>[...new Set(props.items.map(item=>item.kind).filter(Boolean))])
const children=computed(()=>new Set(props.items.filter((item,index)=>props.items[index+1]?.level>item.level).map(item=>item.id)))
const hasChildren=(item:OutlineItem)=>children.value.has(item.id)
const parents=computed(()=>{
  const result=new Map<string,string>(),stack:OutlineItem[]=[]
  for(const item of props.items){
    while(stack.length&&stack[stack.length-1].level>=item.level)stack.pop()
    const parent=item.parentId||stack[stack.length-1]?.id
    if(parent)result.set(item.id,parent)
    stack.push(item)
  }
  return result
})
const matches=computed(()=>{
  const result=new Map<string,Set<number>>(),needle=query.value.trim().toLocaleLowerCase()
  for(const item of props.items){
    if(kindFilter.value&&item.kind!==kindFilter.value)continue
    const haystack=item.name.toLocaleLowerCase(),indices=new Set<number>()
    let offset=0,found=true
    for(const character of needle){const at=haystack.indexOf(character,offset);if(at<0){found=false;break}indices.add(at);offset=at+character.length}
    if(found)result.set(item.id,indices)
  }
  return result
})
const filtering=computed(()=>!props.isMarkdown&&!!(query.value.trim()||kindFilter.value))
const included=computed(()=>{
  const result=new Set<string>()
  for(const id of matches.value.keys()){
    let current:string|undefined=id
    while(current&&!result.has(current)){result.add(current);current=parents.value.get(current)}
  }
  return result
})
function labelParts(item:OutlineItem){
  if(!filtering.value||!query.value)return [{text:item.name,match:false}]
  const indices=matches.value.get(item.id),parts:{text:string;match:boolean}[]=[]
  let offset=0
  for(const character of item.name){
    const match=!!indices?.has(offset),last=parts[parts.length-1]
    if(last?.match===match)last.text+=character
    else parts.push({text:character,match})
    offset+=character.length
  }
  return parts
}
function toggle(id:string){const next=new Set(collapsed.value);if(next.has(id))next.delete(id);else next.add(id);collapsed.value=next}
function expandAll() { collapsed.value = new Set() }
function collapseAll() { collapsed.value = new Set(props.items.filter(hasChildren).map(item => item.id)) }
defineExpose({ expandAll, collapseAll })
watch(collapsed,value=>foldStates.set(props.documentId||'standalone',value))
watch(()=>props.items,items=>{
  if(!items.length)return
  const present=new Set(items.map(item=>item.id)),next=new Set([...collapsed.value].filter(id=>present.has(id)))
  if(next.size!==collapsed.value.size)collapsed.value=next
})
const visibleItems=computed(()=>{
  if(filtering.value)return props.items.filter(item=>included.value.has(item.id))
  let hiddenLevel=Infinity
  return props.items.filter(item=>{
    if(item.level>hiddenLevel)return false
    hiddenLevel=collapsed.value.has(item.id)?item.level:Infinity
    return true
  })
})
watch(visibleItems,items=>{if(!items.some(item=>item.id===focusedId.value))focusedId.value=items[0]?.id||''})
function navigate(event:KeyboardEvent,index:number){
  if(event.target!==event.currentTarget)return
  const items=visibleItems.value,item=items[index]
  let target=index
  if(event.key==='ArrowDown')target=Math.min(items.length-1,index+1)
  else if(event.key==='ArrowUp')target=Math.max(0,index-1)
  else if(event.key==='Home')target=0
  else if(event.key==='End')target=items.length-1
  else if(event.key==='ArrowRight'){
    if(!filtering.value&&hasChildren(item)&&collapsed.value.has(item.id)){toggle(item.id);event.preventDefault();return}
    if(items[index+1]?.level>item.level)target=index+1
  }else if(event.key==='ArrowLeft'){
    if(!filtering.value&&hasChildren(item)&&!collapsed.value.has(item.id)){toggle(item.id);event.preventDefault();return}
    const parent=parents.value.get(item.id)
    if(parent)target=items.findIndex(row=>row.id===parent)
  }else return
  event.preventDefault();focusedId.value=items[target]?.id||''
  void nextTick(()=>list.value?.querySelectorAll<HTMLElement>('.outline-item')[target]?.focus())
}
const visibleActiveId = computed(() => {
  const visible = new Set(visibleItems.value.map(item => item.id))
  let index = props.items.findIndex(item => item.id === activeId.value)
  if (index < 0) return null
  let level = Infinity
  for (; index >= 0; index--) {
    const item = props.items[index]
    if (item.level >= level) continue
    if (visible.has(item.id)) return item.id
    level = item.level
  }
  return null
})

defineEmits<{
  (e: 'select-item', item: OutlineItem): void
}>()
</script>

<style scoped>
.outline-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  font-size: var(--ui-font-size);
}
.outline-filter{display:flex;gap:4px;padding:6px;position:sticky;top:0;background:var(--sidebar);z-index:1}
.outline-filter input{min-width:0;flex:1;width:0;background:var(--soft);border:1px solid var(--line);padding:4px;color:var(--ink)}
.outline-filter select{max-width:88px;min-width:0;background:var(--soft);border:1px solid var(--line);color:var(--ink)}
.outline-detail{max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font:var(--ui-small-font-size) var(--font-mono)}
.outline-label mark{background:var(--accentbg);color:var(--accent);font-weight:600}
.outline-item.active{background:color-mix(in srgb,var(--accent) 12%,var(--sidebar));color:var(--bright)}
.outline-item:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}
.outline-item .icon{width:14px;height:14px;flex:none;color:var(--blue)}

.empty-outline {
  padding: 24px 16px;
  text-align: center;
  color: var(--muted);
  font-size: var(--ui-small-font-size);
}

.outline-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.outline-item {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 12px;
  color: var(--ink);
  transition: background 0.1s;
  cursor: pointer;
  text-align: left;
}

.outline-item:hover {
  background: var(--hover);
  color: var(--bright);
}

.outline-fold-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: none;
}

.outline-fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  line-height: 14px;
  color: var(--muted);
  cursor: pointer;
  border-radius: 2px;
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.outline-fold:hover {
  background: var(--hover);
  color: var(--bright);
}

.outline-label :deep(strong) {font-weight:700}
.outline-label :deep(em) {font-style:italic}
.outline-label :deep(s) {text-decoration:line-through}
.outline-label :deep(code) {font:90% var(--font-mono);padding:1px 3px;background:var(--soft);border-radius:3px}
.outline-item.heading.level-1 .outline-label {font-weight:600}
.outline-item.heading.active .outline-label {font-weight:700;color:var(--bright)}
.outline-item.heading.active .outline-label :deep(code) {font-weight:700}

.kind-badge {
  font-size: var(--ui-small-font-size);
  background: var(--soft);
  color: var(--blue);
  padding: 1px 3px;
  border-radius: 3px;
  font-family: var(--font-mono);
}

.outline-label {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-line {
  font-size: var(--ui-small-font-size);
  color: var(--muted);
  font-family: var(--font-mono);
}
</style>
