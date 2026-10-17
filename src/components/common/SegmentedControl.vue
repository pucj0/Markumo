<template>
  <div :id="id" class="segmented-control" role="radiogroup" :aria-label="label" @keydown="onKeydown">
    <button v-for="(option,index) in options" :key="option.value" type="button" role="radio"
      :aria-checked="modelValue === option.value" :tabindex="modelValue === option.value || (!hasSelection && index === 0) ? 0 : -1"
      :class="{selected:modelValue === option.value}" @click="$emit('update:modelValue',option.value)">{{ option.label }}</button>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
const props=defineProps<{id?:string;label:string;modelValue:string|number;options:{label:string;value:string|number}[]}>()
const emit=defineEmits<{(event:'update:modelValue',value:string|number):void}>()
const hasSelection=computed(()=>props.options.some(option=>option.value===props.modelValue))
function onKeydown(event:KeyboardEvent) {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return
  event.preventDefault()
  const buttons=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
  const index=buttons.indexOf(event.target as HTMLButtonElement)
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length
  emit('update:modelValue',props.options[next].value)
  buttons[next]?.focus({preventScroll:true})
}
</script>
<style scoped>
.segmented-control{display:inline-flex;flex-wrap:wrap;gap:2px;max-width:100%;padding:3px;border:1px solid var(--line);border-radius:7px;background:var(--editor)}
button{flex:1 1 auto;padding:4px 9px;min-height:26px;border-radius:4px;color:var(--sub);font:inherit;cursor:pointer;white-space:normal}
button:hover{background:var(--hover)}button.selected{background:var(--accentbg);color:var(--accent);font-weight:600}
button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
</style>
