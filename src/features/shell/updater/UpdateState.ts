export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'preparing' | 'installing' | 'awaiting-restart' | 'error'
export interface UpdateState {
  phase: UpdatePhase; currentVersion: string; version: string; notes: string
  received: number; total: number; error: string; installSupported: boolean; platform: string
  confirmedVersion: string
}
export const updateState = (): UpdateState => ({phase:'idle',currentVersion:'',version:'',notes:'',received:0,total:0,error:'',installSupported:true,platform:'',confirmedVersion:''})
export function updateLabel(state: UpdateState): string {
  return {idle:'检查 Markumo 更新',checking:'正在检查更新…','up-to-date':'当前已是最新版本',available:`发现新版本 ${state.version}`,downloading:'正在后台下载更新',downloaded:'更新已准备就绪',preparing:'正在准备安装更新',installing:'正在安装更新…','awaiting-restart':'安装操作已完成，等待重启验证',error:'检查更新失败，可重试'}[state.phase]
}
