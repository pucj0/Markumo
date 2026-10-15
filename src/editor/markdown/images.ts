import { Facet, StateEffect } from '@codemirror/state'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { safeMarkdownURL } from './links'

export interface MarkdownResources {
  loadLocal(path: string): Promise<Uint8Array>
  authorizeLocal?(path: string): Promise<boolean>
  allowedRemote: Set<string>
  identity(): string
}
export const refreshMarkdownResources=StateEffect.define<null>()
export const markdownResources = Facet.define<MarkdownResources, MarkdownResources>({
  combine: values => values[values.length - 1] || createMarkdownResources(() => undefined),
})
export function createMarkdownResources(token: () => string | undefined,identity:()=>string=()=>token()||''): MarkdownResources {
  return {
    allowedRemote: new Set(),
    identity,
    async authorizeLocal(path) {
      const grant=token()
      if(!isTauri()||!grant)return false
      return invoke<boolean>('authorize_markdown_image_read',{token:grant,relative:path})
    },
    async loadLocal(path) {
      const grant = token()
      if (!isTauri() || !grant) throw new Error('请先保存 Markdown 文档。')
      const bytes = await invoke<ArrayBuffer>('read_markdown_image', { token: grant, relative: path })
      return new Uint8Array(bytes)
    },
  }
}
export type ImageDestination = { kind: 'remote'; path: string } | { kind: 'local'; path: string } | { kind: 'blocked'; path: string }
let retainedBytes=0,retainedPixels=0
export function imageDestination(source: string): ImageDestination {
  const raw = source.replace(/^<|>$/g, '').replace(/\\([\\()<> ])/g, '$1')
  const network = safeMarkdownURL(raw)
  if (network?.startsWith('https:')) return { kind: 'remote', path: network }
  try {
    const path = decodeURIComponent(raw)
    const localDrive = /^[a-z]:[\/\\]/i.test(path)
    if (!path || /^[/\\]{2}/.test(path) || /[\0\r\n]/.test(path) || (!localDrive && path.includes(':')) || (localDrive && path.slice(2).includes(':'))) return { kind: 'blocked', path }
    return { kind: 'local', path }
  } catch { return { kind: 'blocked', path: raw } }
}

/** Safe DOM only. No src is assigned to a remote image until explicit consent. */
export function mountMarkdownImage(host: HTMLElement, source: string, alt: string, resources: MarkdownResources, edit: () => void, measure: () => void = () => {}) {
  const destination = imageDestination(source)
  host.replaceChildren()
  let disposed = false, objectURL: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0, heldBytes=0,heldPixels=0, needsAuthorization=false
  const release=()=>{
    if(objectURL)URL.revokeObjectURL(objectURL);objectURL=undefined
    retainedBytes-=heldBytes;retainedPixels-=heldPixels;heldBytes=heldPixels=0
  }
  host.classList.add('md-image-preview'); host.title = `${alt}\n${source}`
  const status = document.createElement('span'); status.className = 'md-image-status'
  const path = document.createElement('button'); path.type = 'button'; path.className = 'md-image-path'; path.textContent = source || '(空图片路径)'; path.title = '编辑图片路径'; path.onclick = edit
  const action = document.createElement('button'); action.type = 'button'; action.className = 'md-image-action'
  host.append(status, path, action)
  const failure = (reason: string) => { status.textContent = `图片未显示：${reason}`; action.hidden = destination.kind === 'blocked'; action.textContent = '重试'; measure() }
  async function load() {
    const current = ++generation
    if (timer) clearTimeout(timer)
    host.querySelector('img')?.remove()
    release()
    status.textContent = '图片加载中…'; action.hidden = true
    try {
      let src: string
      if (destination.kind === 'blocked') { failure('只允许授权本地路径或经确认的 HTTPS 图片'); return }
      if (destination.kind === 'remote') src = destination.path
      else {
        const bytes = await resources.loadLocal(destination.path)
        if (disposed || current !== generation) return
        if(bytes.length>4*1024*1024||retainedBytes+bytes.length>32*1024*1024){failure('已达到图片预览内存预算，请关闭其他图片后重试');return}
        heldBytes=bytes.length;retainedBytes+=heldBytes
        const type = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x47 ? 'image/gif' : 'image/webp'
        objectURL = URL.createObjectURL(new Blob([bytes], { type })); src = objectURL
      }
      if (disposed || current !== generation) return
      const image = document.createElement('img'); image.alt = alt; image.referrerPolicy = 'no-referrer'; image.decoding = 'async'
      if (destination.kind === 'remote') image.crossOrigin = 'anonymous'
      image.onclick = edit
      image.onload = () => {
        if (disposed || current !== generation) return
        if (timer) clearTimeout(timer)
        const pixels=image.naturalWidth*image.naturalHeight
        if (image.naturalWidth > 16384 || image.naturalHeight > 16384 || pixels > 16_000_000 || retainedPixels+pixels>32_000_000) { image.remove();release();failure('图片尺寸或当前预览总像素超过预算');return }
        heldPixels=pixels;retainedPixels+=pixels
        status.textContent = ''; measure()
      }
      image.onerror = () => { if (!disposed && current === generation) { if (timer) clearTimeout(timer); image.remove();release();failure('加载失败或远程服务器未允许匿名跨域访问') } }
      timer = setTimeout(() => { if (!disposed && current === generation) { generation++; image.remove();release();failure('加载超时') } }, 15000)
      host.prepend(image); image.src = src; measure()
    } catch (error) {
      if (!disposed && current === generation) {
        release();failure(typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error))
        needsAuthorization=destination.kind==='local'&&!!resources.authorizeLocal&&typeof error==='object'&&!!error&&'code' in error&&error.code==='image_scope'
        if(needsAuthorization)action.textContent='授权此本地图片…'
      }
    }
  }
  action.onclick = async () => {
    if(needsAuthorization){
      action.disabled=true
      try{if(!await resources.authorizeLocal?.(destination.path))return;needsAuthorization=false}
      catch(error){failure(error instanceof Error?error.message:String(error));return}
      finally{action.disabled=false}
      if(disposed)return
    }
    if (destination.kind === 'remote') resources.allowedRemote.add(destination.path)
    void load()
  }
  if (destination.kind === 'remote' && !resources.allowedRemote.has(destination.path)) {
    status.textContent = '网络图片默认关闭'; action.textContent = `加载网络图片（${new URL(destination.path).hostname}）`
  } else void load()
  return { destroy() { disposed = true; generation++; if (timer) clearTimeout(timer); const image = host.querySelector('img'); if (image) { image.onload = image.onerror = null; image.removeAttribute('src') } release() } }
}
