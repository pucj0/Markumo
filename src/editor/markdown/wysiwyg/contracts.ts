import type { BracketMode } from '../../core/brackets'
import type { MarkdownFormat } from '../formatCommands'
import type { MarkdownResources } from '../images'
import type { CaretAnimation } from '../../core/caretMotion'
export interface MarkdownTypography { width:number; fontSize:number; fontFamily:string; lineHeight:number; codeLineNumbers:boolean; codeWrap:boolean; imageBorder:boolean }
export const defaultMarkdownTypography=():MarkdownTypography=>({width:860,fontSize:16,fontFamily:'system',lineHeight:1.6,codeLineNumbers:true,codeWrap:false,imageBorder:true})
export interface MarkdownClipboardSettings { copyMarkdown: boolean; copyWholeLine: boolean }
export const defaultMarkdownClipboard = (): MarkdownClipboardSettings => ({ copyMarkdown: false, copyWholeLine: false })
export interface LiveEditor {
  readonly composing:boolean
  readonly selection:{anchor:number;head:number}
  sync(source:string,update?:unknown):void
  focus():void
  reveal(position:number,align?:'nearest'|'start'):void
  format(format:MarkdownFormat):boolean
  typography(settings:MarkdownTypography):void
  caretAnimation(mode:CaretAnimation):void
  bracketMode(mode:BracketMode):void
  clipboardSettings(settings:MarkdownClipboardSettings):void
  shortcut(event:KeyboardEvent):boolean
  clipboard(operation:'copy'|'cut'|'paste'|'select-all'):Promise<void>
  refreshResources():void
  destroy():void
  find(replace?:boolean):void
  findNext():void
  findPrevious():void
  closeSearch():void
}
export interface LiveOptions {
  shortcutLabel?(id:string):string|undefined
  caretAnimation?:CaretAnimation
  bracketMode?:BracketMode
  source:string; anchor:number; head:number; resources:MarkdownResources; typography:MarkdownTypography; clipboard?:MarkdownClipboardSettings
  publish(expected:string,patch:{from:number;to:number;insert:string},update:unknown,isolated:boolean):boolean
  selected(anchor:number,head:number):void
  history(forward:boolean):void
  focus():void
  openRelative?(href:string):void
  readOnly?():boolean
}
