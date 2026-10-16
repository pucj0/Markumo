<template>
  <div class="image-settings">
    <h4>图片资源</h4>
    <div class="row"><label for="image-scope">设置范围</label><select id="image-scope" v-model="scope"><option value="global">应用于全部 Markdown 文档</option><option value="document" :disabled="!documentPath">当前文档单独设置</option></select></div>
    <template v-if="scope === 'document'">
      <p class="hint">{{ documentName }}</p>
      <div class="row"><label for="image-override">覆盖全局图片规则</label><input id="image-override" type="checkbox" :checked="!!documentRules" @change="emit('document', ($event.target as HTMLInputElement).checked ? { ...globalRules } : null)" /></div>
    </template>
    <fieldset :disabled="scope === 'document' && !documentRules">
      <div class="row"><label for="image-location">插入本地图片时</label><select id="image-location" :value="rules.location" @change="update('location', ($event.target as HTMLSelectElement).value as ImageRules['location'])"><option value="original">保留原位置，仅插入引用</option><option value="sibling">复制到 Markdown 同级目录</option><option value="assets">复制到 ./assets/</option><option value="document">复制到 ./&#36;{filename}.assets/</option><option value="custom">复制到自定义相对目录</option></select></div>
      <div v-if="rules.location === 'custom'" class="row"><label for="image-directory">相对目录</label><input id="image-directory" type="text" :value="rules.customDirectory" placeholder="./assets/ 或 ../images/" maxlength="1024" @input="update('customDirectory', ($event.target as HTMLInputElement).value)" /></div>
      <div v-for="option in options" :key="option.key" class="row"><label :for="`image-${option.key}`">{{ option.title }}</label><input :id="`image-${option.key}`" type="checkbox" :checked="rules[option.key]" @change="update(option.key, ($event.target as HTMLInputElement).checked)" /></div>
    </fieldset>
    <p class="hint">目录相对于 Markdown 文件；${filename} 为不含扩展名的文档名。截图在“保留原位置”下保存至 ./assets/。文档外目录需单独授权，首次导入前应已存在。</p>
    <p class="hint">文档规则保存在应用设置中；不会修改 Front Matter。网络图片仍需手动加载。</p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ImageRules } from '../../editor/markdown/imageImport'
const props = defineProps<{ globalRules: ImageRules; documentRules: ImageRules | null; documentPath?: string; documentName?: string }>()
const emit = defineEmits<{ (e:'global', rules:ImageRules):void; (e:'document',rules:ImageRules|null):void }>()
const scope=ref<'global'|'document'>('global')
watch(()=>props.documentPath,()=>{scope.value='global'})
const rules=computed(()=>scope.value==='document' ? props.documentRules || props.globalRules : props.globalRules)
const options=[{key:'relative',title:'尽可能使用相对路径'},{key:'dotPrefix',title:'相对路径添加 ./ 前缀'},{key:'escape',title:'兼容性转义路径中的空格等字符'}] as const
function update<K extends keyof ImageRules>(key:K,value:ImageRules[K]) {
  const next={...rules.value,[key]:value}
  if(scope.value==='global')emit('global',next);else emit('document',next)
}
</script>
<style scoped>
h4{font-size: var(--ui-font-size);color:var(--bright);margin:20px 0 10px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:42px;font-size: var(--ui-font-size)}.row label{flex:1}.row select,.row input[type=text]{width:225px;max-width:60%;height:30px;border:1px solid var(--line);border-radius:6px;background:var(--editor);color:var(--ink);padding:4px 8px;font:inherit}fieldset{border:0;padding:0;margin:0;min-width:0}fieldset:disabled{opacity:.5}.hint{font-size: var(--ui-small-font-size);color:var(--muted);line-height:1.6;overflow-wrap:anywhere}input[type=checkbox]{accent-color:var(--accent)}
</style>
