import { invoke } from '@tauri-apps/api/core'
import type { MediaMetadata } from './contracts'
export const MEDIA_CHUNK = 256 * 1024
export const isMedia = (doc?: { kind?: string } | null) => doc?.kind === 'image' || doc?.kind === 'pdf'
export const isText = (doc?: { kind?: string } | null) => !!doc && (!doc.kind || doc.kind === 'text')
export const mediaMetadata = (token: string) => invoke<[MediaMetadata, string]>('media_metadata', { token })
export const readMediaChunk = async (token: string, expectedVersion: string, offset: number, length: number) => {
  const data = await invoke<ArrayBuffer | number[]>('read_media_chunk', { token, expectedVersion, offset, length })
  return new Uint8Array(data)
}
export const openMediaDefault = (token: string) => invoke<void>('open_media_default', { token })
export const mediaSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`

// State contains numbers/strings only. Decoder/PDF resources belong to the mounted viewer.
export interface MediaViewState { scale: number; fit: string; rotation: number; left: number; top: number; page: number; continuous: boolean; query: string }
export const newMediaViewState = (): MediaViewState => ({ scale: 1, fit: 'page', rotation: 0, left: 0, top: 0, page: 1, continuous: true, query: '' })
