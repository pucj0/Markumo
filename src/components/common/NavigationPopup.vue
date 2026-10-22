<template>
  <Teleport to="body">
    <div ref="popup" class="app-menu-popup navigation-popup" :style="position" :aria-label="title" role="dialog" @keydown="keydown" @focusout="focusout">
      <div class="navigation-head"><span>{{ title }}</span><button v-if="parentLabel" @click="$emit('parent')" :title="parentLabel" aria-label="上一级目录">↑</button></div>
      <input ref="input" v-model="query" :aria-label="filterLabel" :placeholder="filterLabel" role="combobox" aria-autocomplete="list" aria-expanded="true" :aria-controls="listId" :aria-activedescendant="rows[index] ? `${listId}-${index}` : undefined" />
      <p v-if="message" class="navigation-message" role="status">{{ message }}</p>
      <div :id="listId" class="navigation-options" role="listbox" :aria-label="title">
        <div v-for="(item,at) in rows" :id="`${listId}-${at}`" :key="item.id" class="navigation-option" :class="{selected:at===index}" role="option" :aria-selected="at===index" :title="item.detail || item.label" @mousedown.prevent @pointermove="index=at" @click="$emit('select',item.id)">
          <span v-if="item.directory" class="navigation-folder">▸</span><FileIcon v-else :name="item.name || item.label" />
          <span class="navigation-label">{{ item.label }}<small v-if="item.detail">{{ item.detail }}</small></span>
          <span class="navigation-dirty" :class="{dirty:item.dirty}" :aria-label="item.dirty ? '未保存修改' : undefined">●</span>
          <button v-if="closable" class="navigation-close" :aria-label="`关闭 ${item.label}`" @click.stop="$emit('remove',item.id)">✕</button>
        </div>
      </div>
      <p v-if="!rows.length && !message" class="navigation-message" role="status">没有匹配项</p>
      <p v-if="filtered.length>200" class="navigation-message">显示前 200 项，请继续筛选。</p>
      <button v-if="actionLabel" class="navigation-action" @mousedown.prevent @click="$emit('action')">{{ actionLabel }}</button>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import FileIcon from './FileIcon.vue'
export interface NavigationItem { id:string; label:string; name?:string; detail?:string; dirty?:boolean; directory?:boolean }
const props=defineProps<{anchor:HTMLElement;title:string;filterLabel:string;items:NavigationItem[];message?:string;closable?:boolean;actionLabel?:string;parentLabel?:string}>()
const emit=defineEmits<{(e:'select',id:string):void;(e:'remove',id:string):void;(e:'close',restore:boolean):void;(e:'action'):void;(e:'parent'):void}>()
const query=ref(''),index=ref(0),popup=ref<HTMLElement>(),input=ref<HTMLInputElement>(),listId=useId()
const filtered=computed(()=>{const q=query.value.trim().toLocaleLowerCase();return props.items.filter(item=>(item.label+' '+(item.detail||'')).toLocaleLowerCase().includes(q))})
const rows=computed(()=>filtered.value.slice(0,200))
const position = computed(() => {
  const r = props.anchor.getBoundingClientRect()
  const left = Math.max(4, Math.min(r.left, window.innerWidth - 364)) + 'px'
  if (r.top > window.innerHeight / 2) {
    const bottom = Math.max(4, window.innerHeight - r.top + 4) + 'px'
    return { left, bottom, maxHeight: 'min(380px, calc(100vh - 50px))', maxWidth: 'calc(100vw - 8px)' }
  }
  const top = Math.min(r.bottom + 3, Math.max(4, window.innerHeight - 380)) + 'px'
  return { left, top, maxHeight: 'min(380px, calc(100vh - 50px))', maxWidth: 'calc(100vw - 8px)' }
})
watch(query,()=>index.value=0)
watch(rows,()=>index.value=Math.min(index.value,Math.max(0,rows.value.length-1)))
watch(index,()=>void nextTick(()=>document.getElementById(`${listId}-${index.value}`)?.scrollIntoView({block:'nearest'})))
function keydown(event:KeyboardEvent){
  if(event.key!=='Escape' && (event.target as Element).closest('button'))return
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    if((event.key==='Home'||event.key==='End')&&event.target===input.value&&!event.ctrlKey)return
    event.preventDefault();index.value=event.key==='ArrowDown'?Math.min(rows.value.length-1,index.value+1):event.key==='ArrowUp'?Math.max(0,index.value-1):event.key==='Home'?0:rows.value.length-1
  }else if(event.key==='Enter'){event.preventDefault();if(rows.value[index.value])emit('select',rows.value[index.value].id)}
  else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close',true)}
}
function focusout(){void nextTick(()=>{if(popup.value&&!popup.value.contains(document.activeElement))emit('close',false)})}
function outside(event:PointerEvent){if(!popup.value?.contains(event.target as Node)&&!props.anchor.contains(event.target as Node))emit('close',false)}
function resize(){emit('close',true)}
onMounted(()=>{input.value?.focus();document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',resize)})
onUnmounted(()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',resize)})
</script>
<style scoped>
.navigation-popup{position:fixed;z-index:1000;width:360px;display:flex;flex-direction:column;box-sizing:border-box;padding:6px;background:var(--sidebar);border:1px solid var(--line);border-radius:5px;color:var(--ink);font-size:var(--ui-font-size);box-shadow:0 4px 16px #0002}
.navigation-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 6px;color:var(--muted);overflow:hidden;white-space:nowrap}
.navigation-head span{min-width:0;overflow:hidden;text-overflow:ellipsis}.navigation-head button{flex:none}
.navigation-popup input{box-sizing:border-box;width:100%;padding:5px 7px;background:var(--editor);border:1px solid var(--line);border-radius:3px;color:var(--ink)}
.navigation-options{max-height:min(280px,45vh);overflow:auto;margin-top:5px}.navigation-option{display:flex;align-items:center;gap:7px;padding:5px 6px;cursor:pointer;border-radius:3px}.navigation-option.selected{background:var(--accentbg)}
.navigation-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.navigation-label small{display:block;color:var(--muted);overflow:hidden;text-overflow:ellipsis;font-size:var(--ui-small-font-size)}
.navigation-dirty{width:8px;visibility:hidden;font-size:8px;color:var(--yellow)}.navigation-dirty.dirty{visibility:visible}.navigation-popup button{border:0;background:transparent;color:var(--muted);cursor:pointer;padding:3px 6px}.navigation-popup button:hover{background:var(--hover);color:var(--bright)}
.navigation-message{padding:8px;color:var(--muted);font-size:var(--ui-small-font-size)}.navigation-action{width:100%;text-align:left;border-top:1px solid var(--line)!important}.navigation-folder{width:16px;color:var(--muted)}
</style>
