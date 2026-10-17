<template>
  <button class="ib update-control" :class="{working:['checking','downloading','preparing','installing'].includes(state.phase)}" aria-label="检查更新" :title="updateLabel(state)" @click="$emit('open')">
    <Icon :name="state.phase==='checking' ? 'refresh' : 'download'" :class="{checking:state.phase==='checking'}" />
    <span v-if="['available','downloading','downloaded','awaiting-restart','error'].includes(state.phase)||state.error" class="update-dot" :class="{ready:state.phase==='downloaded',error:!!state.error}" />
    <span v-if="state.phase==='downloading'&&state.total" class="update-progress" :style="{width:Math.min(100,state.received/state.total*100)+'%'}" />
  </button>
</template>
<script setup lang="ts">
import Icon from './Icon.vue'
import {updateLabel,type UpdateState} from '../../features/shell/updater/UpdateState'
defineProps<{state:UpdateState}>();defineEmits<{(e:'open'):void}>()
</script>
<style scoped>
.update-control{position:relative}.update-dot{position:absolute;right:3px;top:3px;width:6px;height:6px;border-radius:50%;background:var(--accent)}.update-dot.ready{box-shadow:0 0 0 2px var(--accentbg)}.update-dot.error{background:var(--yellow)}.update-progress{position:absolute;bottom:1px;left:0;height:2px;background:var(--accent)}.working{color:var(--accent)}
.checking{animation:update-spin 1s linear infinite}@keyframes update-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.checking{animation:none}}
</style>
