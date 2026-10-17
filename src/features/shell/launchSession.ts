import { invoke } from '@tauri-apps/api/core'
import type { OpenBatch, Preferences } from '../files/contracts'
import type { WorkspaceInfo } from '../workspace/contracts'
import type { DocumentManager } from '../../editor/core/DocumentManager'
import { mapInfo } from '../workspace/tauriWorkspace'

export interface LaunchResult {
  kind: 'app' | 'file'; ownsSession: boolean; files: OpenBatch; roots: WorkspaceInfo[]
  activePath: string | null; layout: Preferences['layout']; warnings: string[]
}
export interface SessionInput {
  kind: 'single' | 'workspace'; tabs: { token:string; encoding:string }[]; activeToken: string | null; layout: Preferences['layout']
}
export async function initializeLaunch(): Promise<LaunchResult> {
  const result=await invoke<Omit<LaunchResult,'roots'> & {roots:Parameters<typeof mapInfo>[0][]}>('initialize_launch')
  return {...result,roots:result.roots.map(mapInfo)}
}
export function sessionInput(manager:DocumentManager, roots:readonly WorkspaceInfo[], layout:Preferences['layout']):SessionInput {
  const docs=manager.openedDocuments.filter(doc=>!!doc.fileToken&&!!doc.path)
  return {kind:roots.length?'workspace':'single',tabs:docs.map(doc=>({token:doc.fileToken!,encoding:doc.kind==='javaClass'?'ClassInfo':doc.kind==='image'||doc.kind==='pdf'?'Media':doc.encoding})),
    activeToken:docs.find(doc=>doc.id===manager.activeId)?.fileToken||docs[0]?.fileToken||null,layout:{...layout}}
}

// Coalesce metadata-only snapshots. No text bodies or per-keystroke IPC.
export class SessionWriter {
  private timer:ReturnType<typeof setTimeout>|undefined
  private next:SessionInput|null=null
  private last=''
  private pending:Promise<void>=Promise.resolve()
  constructor(private readonly write:(input:SessionInput)=>Promise<unknown>,private readonly failed:(error:unknown)=>void){}
  prime(input:SessionInput){this.last=JSON.stringify(input)}
  schedule(input:SessionInput){
    const signature=JSON.stringify(input)
    if(signature===this.last)return
    this.last=signature;this.next=input
    if(this.timer)clearTimeout(this.timer)
    this.timer=setTimeout(()=>{void this.flush()},250)
  }
  flush():Promise<void>{
    if(this.timer)clearTimeout(this.timer);this.timer=undefined
    this.pending=this.pending.then(async()=>{
      const input=this.next;this.next=null
      if(!input)return
      try{await this.write(input)}catch(error){if(!this.next){this.last='';this.failed(error)}}
    })
    return this.pending
  }
  dispose(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.next=null}
}
