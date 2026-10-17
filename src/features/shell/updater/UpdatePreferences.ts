export interface UpdatePreferences { autoCheckUpdates: boolean; autoDownloadUpdates: boolean }
export const defaultUpdatePreferences = (): UpdatePreferences => ({autoCheckUpdates:true,autoDownloadUpdates:false})
