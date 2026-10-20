<template>
  <div v-if="visible" class="update-confirm-overlay" @keydown.stop="keydown">
    <div ref="dialogRef" role="dialog" aria-modal="true" aria-label="准备安装更新" class="update-confirm">
      <h2>准备安装更新</h2><p>检测到 {{ count }} 个未保存的文档。</p><p>为了安全更新，请先保存当前修改。任意保存失败或取消选择都会停止安装。</p>
      <div class="actions"><button @click="answer(false)">取消</button><button class="primary" @click="answer(true)">保存全部并更新</button></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import {ref,onBeforeUnmount} from 'vue'
import {useModal} from '../../features/shell/useModal'
const {visible,dialogRef,open,close,handleKeydown}=useModal(),count=ref(0)
void dialogRef // Bound by name in the template.
let resolve:((value:boolean)=>void)|null=null
function answer(value:boolean){const pending=resolve;resolve=null;close();pending?.(value)}
function confirm(value:number):Promise<boolean>{answer(false);count.value=value;open();return new Promise(done=>resolve=done)}
function keydown(event:KeyboardEvent){if(event.isComposing)return;if(event.key==='Escape'){event.preventDefault();answer(false)}else handleKeydown(event)}
onBeforeUnmount(()=>answer(false));defineExpose({confirm,visible})
</script>
<style scoped>
.update-confirm-overlay{position:fixed;inset:0;z-index:1400;display:grid;place-items:center;background:rgba(0,0,0,.4);padding:16px}.update-confirm{width:min(450px,100%);background:var(--paper);color:var(--ink);padding:22px;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}h2{margin:0 0 14px;color:var(--bright);font-size:calc(var(--ui-font-size) + 3px)}p{line-height:1.6;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;gap:10px}button{padding:8px 12px;background:var(--soft);border-radius:5px}.primary{background:var(--accentbg);color:var(--accent)}
</style>
