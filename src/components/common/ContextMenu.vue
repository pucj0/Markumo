<template><MenuPopup v-if="visible" :nodes="nodes" :registry="registry" :anchor="anchor" :title="title" focus @execute="execute" @close="close" /></template>
<script setup lang="ts">
import { shallowRef, ref } from 'vue'
import MenuPopup from './MenuPopup.vue'
import { CommandRegistry, type MenuNode } from '../../features/shell/menuModel'
const visible=ref(false),nodes=shallowRef<MenuNode[]>([]),registry=shallowRef(new CommandRegistry([])),title=ref('上下文菜单'),anchor=ref({left:0,right:0,top:0,bottom:0})
let previous:HTMLElement | null=null
function open(event:MouseEvent | KeyboardEvent, items:MenuNode[], commands:CommandRegistry, label='上下文菜单',atTrigger=false) {
  event.preventDefault();event.stopPropagation();previous=document.activeElement as HTMLElement;nodes.value=items;registry.value=commands;title.value=label
  const rect=(event.currentTarget as HTMLElement).getBoundingClientRect(),mouse=!atTrigger&&event instanceof MouseEvent&&(event.clientX!==0||event.clientY!==0),x=mouse?(event as MouseEvent).clientX:rect.left,y=mouse?(event as MouseEvent).clientY:rect.bottom
  anchor.value={left:x,right:atTrigger?rect.right:x,top:atTrigger?rect.top:y,bottom:y};visible.value=true
}
function close(restore:boolean) {visible.value=false;if(restore&&previous?.isConnected)previous.focus()}
function execute(id:string){try{const result=registry.value.execute(id);if(result instanceof Promise)void result.catch(error=>window.dispatchEvent(new CustomEvent('editor-notice',{detail:String(error)})))}catch(error){window.dispatchEvent(new CustomEvent('editor-notice',{detail:String(error)}))}}
defineExpose({open,close})
</script>
