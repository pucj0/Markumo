import { invoke } from '@tauri-apps/api/core'
import type { RecoveryGateway, RecoveryList, RecoveryRecord, RecoverySaveResult } from './types'

export const tauriRecovery: RecoveryGateway = {
  list: () => invoke<RecoveryList>('recovery_list'),
  read: id => invoke<RecoveryRecord>('recovery_read', { id }),
  save: input => invoke<RecoverySaveResult>('recovery_save', { input }),
  remove: id => invoke<void>('recovery_delete', { id }),
}
