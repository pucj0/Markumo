import { Facet, StateEffect } from '@codemirror/state'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { safeMarkdownURL } from './links'

export interface MarkdownResources {
  loadLocal(path: string): Promise<Uint8Array<ArrayBuffer>>
  authorizeLocal?(path: string): Promise<boolean>
  chooseLocal?(): Promise<string | null>
  allowedRemote: Set<string>
  identity(): string
}
export const refreshMarkdownResources=StateEffect.define<null>()
export const markdownResources = Facet.define<MarkdownResources, MarkdownResources>({
  combine: values => values[values.length - 1] || createMarkdownResources(() => undefined),
})
export function createMarkdownResources(token: () => string | undefined,identity:()=>string=()=>token()||''): MarkdownResources {
  const pending=new Map<string,Promise<Uint8Array<ArrayBuffer>>>()
  let previousIdentity=identity(),cachedBytes=0
  return {
    allowedRemote: new Set(),
    identity,
    async chooseLocal() {
      const grant = token()
      if (!isTauri() || !grant) throw new Error('请先保存 Markdown 文档，再选择本地图片。')
      const expected = identity()
      const inputs = await invoke<{ token: string; name: string }[]>('choose_markdown_images')
      try {
        if (!inputs.length || identity() !== expected) return null
        const result = await invoke<{ path: string }>('import_markdown_image', { input: {
          token: grant, sourceToken: inputs[0].token, name: inputs[0].name, directory: null,
        } })
        return identity() === expected ? result.path.replace(/\\/g, '/').split('/').map((part, index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/') : null
      } finally { await invoke('release_image_inputs', { tokens: inputs.map(input => input.token) }) }
    },
    async authorizeLocal(path) {
      const grant=token()
      if(!isTauri()||!grant)return false
      return invoke<boolean>('authorize_markdown_image_read',{token:grant,relative:path})
    },
    async loadLocal(path) {
      const grant = token()
      if (!isTauri() || !grant) throw new Error('请先保存 Markdown 文档。')
      const current=identity()
      if(current!==previousIdentity){pending.clear();cachedBytes=0;previousIdentity=current}
      const existing=pending.get(path)
      if(existing)return existing
      // Deduplicate concurrent panes. Keep at most 8 MiB of original bytes in
      // addition to the existing decoded-image and Blob budgets.
      const request=invoke<ArrayBuffer>('read_markdown_image', { token: grant, relative: path }).then(buffer=>{
        const bytes=new Uint8Array(buffer)
        if(identity()===current){if(cachedBytes+bytes.length>8*1024*1024){pending.clear();cachedBytes=0}else cachedBytes+=bytes.length}
        return bytes
      }).catch(error=>{pending.delete(path);throw error})
      pending.set(path,request)
      return request
    },
  }
}
export type ImageDestination = { kind: 'remote'; path: string } | { kind: 'local'; path: string } | { kind: 'blocked'; path: string }
/** Rust IPC errors are plain {code,message} objects, not JavaScript Errors. */
export function markdownImageError(error: unknown): { message: string; authorize: boolean } {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null
  const code = typeof record?.code === 'string' ? record.code : ''
  const detail = (typeof record?.message === 'string' ? record.message : typeof error === 'string' ? error : '')
    .replace(/\[object Object\]/g, '').trim()
  if (code === 'image_scope') return { message: '文件未授权：请授权访问或重新选择图片。', authorize: true }
  if (code === 'image_size') return { message: '图片尺寸或文件大小超出安全预算。', authorize: false }
  if (code === 'image_format') return { message: '图片格式不支持或文件已损坏。支持 PNG、JPEG、GIF、WebP。', authorize: false }
  if (/not.?found|不存在|找不到|os error 2|os error 3|cannot find/i.test(detail)) return { message: '文件不存在：请修改路径或重新选择图片。', authorize: false }
  return { message: detail ? `图片加载失败：${detail}` : '图片加载失败，请重试或重新选择图片。', authorize: false }
}
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
export function mountMarkdownImage(host: HTMLElement, source: string, alt: string, resources: MarkdownResources, edit: () => void, measure: () => void = () => {}, options: { live?: boolean } = {}) {
  const destination = imageDestination(source)
  host.replaceChildren()
  let disposed = false, objectURL: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0, heldBytes=0,heldPixels=0, needsAuthorization=false
  const release=()=>{
    if(objectURL)URL.revokeObjectURL(objectURL);objectURL=undefined
    retainedBytes-=heldBytes;retainedPixels-=heldPixels;heldBytes=heldPixels=0
  }
  host.className = options.live ? 'md-image-media' : 'md-image-preview'; host.title = `${alt}\n${source}`
  const status = document.createElement('span'); status.className = 'md-image-status'
  const path = document.createElement('button'); path.type = 'button'; path.className = 'md-image-path'; path.textContent = source || '选择或填写图片路径'; path.title = '编辑图片路径'; path.onclick = event => { event.stopPropagation(); edit() }
  const action = document.createElement('button'); action.type = 'button'; action.className = 'md-image-action'
  host.append(status, path, action)
  const failure = (reason: string) => {
    host.classList.add('is-broken-image')
    host.title = `${alt ? alt + ' · ' : ''}${source}\n（${reason}）`
    const tag = document.createElement('button'); tag.type = 'button'; tag.className = 'broken-image-tag'
    tag.textContent = alt ? `${alt} · ${reason}` : reason
    tag.title = '修改图片属性'; tag.onclick = event => { event.stopPropagation(); edit() }
    status.replaceChildren(tag)
    path.hidden = options.live === true
    action.hidden = destination.kind === 'blocked'
    action.textContent = '重试'
    action.className = 'md-image-action broken-retry-btn'
    measure()
  }
  async function load() {
    const current = ++generation
    if (timer) clearTimeout(timer)
    host.querySelector('img')?.remove()
    host.classList.remove('is-broken-image')
    needsAuthorization = false
    path.hidden = false
    action.className = 'md-image-action'
    release()
    status.textContent = '图片加载中…'; action.hidden = true
    try {
      let src: string
      if (destination.kind === 'blocked') { failure(source.trim() ? '路径无效：只允许本地路径或经确认的 HTTPS 图片。' : '路径为空：点击填写或选择图片。'); return }
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
      if (!options.live) image.onclick = edit
      image.onload = () => {
        if (disposed || current !== generation) return
        if (timer) clearTimeout(timer)
        const pixels=image.naturalWidth*image.naturalHeight
        if (image.naturalWidth > 16384 || image.naturalHeight > 16384 || pixels > 16_000_000 || retainedPixels+pixels>32_000_000) { image.remove();release();failure('图片尺寸或当前预览总像素超过预算');return }
        heldPixels=pixels;retainedPixels+=pixels
        status.textContent = ''; path.hidden = !!options.live; action.hidden = true; measure()
      }
      image.onerror = () => { if (!disposed && current === generation) { if (timer) clearTimeout(timer); image.remove();release();failure('加载失败或远程服务器未允许匿名跨域访问') } }
      timer = setTimeout(() => { if (!disposed && current === generation) { generation++; image.remove();release();failure('加载超时') } }, 15000)
      host.prepend(image); image.src = src; measure()
    } catch (error) {
      if (!disposed && current === generation) {
        const failureInfo = markdownImageError(error)
        release();failure(failureInfo.message)
        needsAuthorization=destination.kind==='local'&&!!resources.authorizeLocal&&failureInfo.authorize
        if(needsAuthorization)action.textContent='授权此本地图片…'
      }
    }
  }
  action.onclick = async event => {
    event.stopPropagation()
    if(needsAuthorization){
      action.disabled=true
      try{if(!await resources.authorizeLocal?.(destination.path))return;needsAuthorization=false}
      catch(error){if(!disposed)failure(markdownImageError(error).message);return}
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
