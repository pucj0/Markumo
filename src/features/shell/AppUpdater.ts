import type { DownloadEvent } from '@tauri-apps/plugin-updater'

export interface AppUpdate {
  version: string
  body?: string
  download(progress: (event: DownloadEvent) => void): Promise<void>
  install(): Promise<void>
  close(): Promise<void>
}
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'ready' | 'error'
export interface UpdateState { phase: UpdatePhase; version: string; notes: string; received: number; total: number; error: string }
export const updateState = (): UpdateState => ({ phase:'idle',version:'',notes:'',received:0,total:0,error:'' })
interface UpdateServices {
  check(): Promise<AppUpdate | null>
  beforeInstall(): Promise<boolean>
  relaunch(): Promise<void>
}

// Keep the native update resource only while it can still be installed.
export class AppUpdater {
  private update: AppUpdate | null = null
  private busy = false
  private disposed = false
  constructor(readonly state: UpdateState, private readonly services: UpdateServices) {}
  async check() {
    if(this.busy || this.disposed || ['downloaded','ready'].includes(this.state.phase))return
    this.busy=true;this.state.phase='checking';this.state.error=''
    try {
      await this.update?.close();this.update=null
      const update=await this.services.check()
      if(this.disposed){await update?.close();return}
      this.update=update;this.state.version=update?.version||'';this.state.notes=update?.body||''
      this.state.phase=update?'available':'current'
    } catch(error) {
      if(!this.disposed){this.state.phase='error';this.state.error=`检查更新失败，请检查网络后重试。${String(error)}`}
    } finally {this.busy=false}
  }
  async install() {
    if(this.busy || this.disposed || !this.update)return
    this.busy=true;this.state.error=''
    let downloaded=['downloaded','ready'].includes(this.state.phase),installed=this.state.phase==='ready'
    try {
      if(!downloaded){
        this.state.phase='downloading';this.state.received=0;this.state.total=0
        await this.update.download(event=>{
          if(this.disposed)return
          if(event.event==='Started')this.state.total=event.data.contentLength||0
          else if(event.event==='Progress')this.state.received+=event.data.chunkLength
        })
        downloaded=true
      }
      if(this.disposed)return
      this.state.phase='installing'
      // Recheck after downloading: the user may have edited or opened a window.
      if(!await this.services.beforeInstall()){
        this.state.phase=installed?'ready':'downloaded'
        this.state.error='请保存所有修改、完成文件操作并关闭其他 Markumo 窗口后重试。'
        return
      }
      if(!installed){await this.update.install();installed=true}
      await this.services.relaunch()
      if(!this.disposed)this.state.phase='ready'
    } catch(error) {
      if(!this.disposed){this.state.phase=installed?'ready':downloaded?'downloaded':'available';this.state.error=`更新未完成，可重试或前往 GitHub 下载。${String(error)}`}
    } finally {this.busy=false;if(this.disposed)await this.release()}
  }
  private async release(){const update=this.update;this.update=null;try{await update?.close()}catch{/* Native resource may already be gone. */}}
  dispose(){this.disposed=true;if(!this.busy)void this.release()}
}

export const GITHUB_URL='https://github.com/pucj0/Markumo'
export async function openProjectPage(desktop:boolean, releases=false){
  const url=GITHUB_URL+(releases?'/releases/latest':'')
  if(desktop){const {invoke}=await import('@tauri-apps/api/core');await invoke('open_external_link',{url})}
  else window.open(url,'_blank','noopener,noreferrer')
}
