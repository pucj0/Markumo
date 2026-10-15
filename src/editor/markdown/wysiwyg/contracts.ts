import type { MarkdownFormat } from '../formatCommands'
import type { MarkdownResources } from '../images'
export interface MarkdownTypography { width:number; fontSize:number; fontFamily:string; lineHeight:number; codeLineNumbers:boolean; codeWrap:boolean }
export const defaultMarkdownTypography=():MarkdownTypography=>({width:860,fontSize:16,fontFamily:'system',lineHeight:1.7,codeLineNumbers:true,codeWrap:false})
export interface LiveEditor {
  readonly composing:boolean
  readonly selection:{anchor:number;head:number}
  sync(source:string,update?:unknown):void
  focus():void
  reveal(position:number):void
  format(format:MarkdownFormat):boolean
  typography(settings:MarkdownTypography):void
  clipboard(operation:'copy'|'cut'|'paste'|'select-all'):Promise<void>
  refreshResources():void
  destroy():void
}
export interface LiveOptions {
  source:string; anchor:number; head:number; resources:MarkdownResources; typography:MarkdownTypography
  publish(expected:string,patch:{from:number;to:number;insert:string},update:unknown,isolated:boolean):boolean
  selected(anchor:number,head:number):void
  history(forward:boolean):void
  focus():void
  openRelative?(href:string):void
  readOnly?():boolean
}
