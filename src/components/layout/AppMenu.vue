<template>
  <div class="app-menu" @mousedown.stop @dblclick.stop>
    <div class="menu-categories" role="menubar" aria-label="应用菜单" @keydown.stop="keydown">
      <button v-for="(group,index) in groups" :key="group.id" :ref="el => { triggers[index] = el as HTMLButtonElement }" role="menuitem" aria-haspopup="menu" :aria-expanded="visible && active === index" :tabindex="active === index ? 0 : -1" :class="{on:visible && active === index}" @focus="focusTrigger(index)" @mousedown.prevent="remember" @click="open(index,true)" @mouseenter="open(index,false)">{{ group.title }}</button>
    </div>
    <MenuPopup v-if="visible && groups[active]" :key="groups[active].id" :nodes="groups[active].items" :registry="registry" :anchor="anchor" :title="`${groups[active].title}菜单`" :focus="keyboardFocus" @execute="$emit('execute',$event)" @close="close" @switch-root="switchRoot" />
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import MenuPopup from '../common/MenuPopup.vue'
import type { MenuGroup, CommandRegistry } from '../../features/shell/menuModel'
const props=defineProps<{groups:MenuGroup[];registry:CommandRegistry}>()
defineEmits<{(e:'execute',id:string):void}>()
const visible=ref(false),active=ref(0),keyboardFocus=ref(false),anchor=ref({left:0,right:0,top:0,bottom:0})
const triggers:HTMLButtonElement[]=[]
let previous:HTMLElement | null=null
function remember() { if(!visible.value) previous=document.activeElement as HTMLElement }
function open(index:number,focus:boolean) { remember();active.value=index;keyboardFocus.value=focus;const rect=triggers[index]?.getBoundingClientRect();if(rect)anchor.value={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};visible.value=true }
function close(restore:boolean) { visible.value=false;if(restore && previous?.isConnected) previous.focus() }
function switchRoot(direction:number) { open((active.value+direction+props.groups.length)%props.groups.length,true) }
function focusTrigger(index:number) { if(visible.value && active.value!==index)open(index,false);else active.value=index }
function keydown(event:KeyboardEvent) {
  if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();active.value=(active.value+(event.key==='ArrowRight'?1:-1)+props.groups.length)%props.groups.length;if(visible.value)open(active.value,true);else triggers[active.value]?.focus()}
  else if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();open(active.value,true)}
  else if(event.key==='Escape'){event.preventDefault();close(true)}
}
</script>
<style scoped>
.app-menu{flex:none}.menu-categories{display:flex;align-items:center;gap:1px;height:32px}.menu-categories button{padding:6px 8px;font-size:12px;border-radius:4px;color:var(--sub);white-space:nowrap}.menu-categories button:hover,.menu-categories button.on{background:var(--hover);color:var(--bright)}.menu-categories button:focus-visible{outline:1px solid var(--accent)}
@media(max-width:640px){.menu-categories button{padding:6px 5px}}
</style>
