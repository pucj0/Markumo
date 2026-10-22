import { shallowRef, ref, watch, onUnmounted } from 'vue'
import { forceParsing, syntaxTree } from '@codemirror/language'
import type { EditorDocument } from '../../types'
import type { DocumentManager } from '../core/DocumentManager'
import { isMarkdownOutline, MAX_CODE_OUTLINE_SIZE, outlineResult, type OutlineResult } from './outlineService'

/** Requested panels only. Reuse the editor's incremental parser, never parse a workspace. */
export function useDocumentOutline(manager:()=>DocumentManager|undefined,doc:()=>EditorDocument|null,enabled:()=>boolean) {
  const result=shallowRef<OutlineResult>({items:[],notice:''}),revision=ref(0)
  let timer:ReturnType<typeof setTimeout>|undefined,epoch=0,disposed=false
  let previous:{id:string;text:unknown;language:string;status:string;tree:unknown}|undefined
  let unsubscribe:(()=>void)|undefined
  watch(manager,current=>{unsubscribe?.();unsubscribe=current?.subscribe(()=>revision.value++);revision.value++},{immediate:true})
  watch(()=>[enabled(),doc()?.id,revision.value],()=>{
    const document=doc(),host=manager(),state=document&&host?.getState(document.id)
    if(!enabled()||!document||!state){++epoch;clearTimeout(timer);previous=undefined;result.value={items:[],notice:''};return}
    const tree=syntaxTree(state),markdown=isMarkdownOutline(document)
    if(previous?.id===document.id && previous.text===state.doc && previous.language===document.language && previous.status===document.languageStatus && (markdown||previous.tree===tree))return
    const sameDocument=previous?.id===document.id,sameLanguage=previous?.language===document.language,current=++epoch
    previous={id:document.id,text:state.doc,language:document.language,status:document.languageStatus,tree}
    clearTimeout(timer)
    if(!markdown||!sameDocument||!sameLanguage)result.value={items:[],notice:markdown?'正在更新大纲…':'正在更新代码结构…'}
    let attempts=0
    const update=()=>{
      if(disposed||current!==epoch)return
      const active=doc(),owner=manager(),snapshot=active&&owner?.getState(active.id)
      if(!active||!snapshot)return
      const parsed=outlineResult(active,snapshot)
      result.value=parsed
      if(parsed.notice.startsWith('语法解析尚未完成') && snapshot.doc.length<=MAX_CODE_OUTLINE_SIZE && attempts++<3){
        const view=owner?.activeId===active.id?owner.activeEditorView:null
        if(view && view.state.doc===snapshot.doc){forceParsing(view,snapshot.doc.length,8);timer=setTimeout(update,80)}
      }
    }
    timer=setTimeout(update,sameDocument?80:0)
  },{immediate:true})
  onUnmounted(()=>{disposed=true;++epoch;clearTimeout(timer);unsubscribe?.()})
  return result
}
