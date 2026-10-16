import { defaultMarkdownTypography, type MarkdownTypography } from '../../editor/markdown/wysiwyg/contracts'

export interface ExportAppearance { typography:MarkdownTypography; colors:Record<string,string> }
export function exportAppearance(typography=defaultMarkdownTypography()):ExportAppearance {
  const colors:Record<string,string>={ink:'#333',editor:'#fff',line:'#dfe2e5',muted:'#777',pink:'#c73369',green:'#22863a',yellow:'#986801',blue:'#005cc5',sub:'#57606a',accent:'#4183c4','md-code-bg':'#f8f8f8'}
  if(typeof document!=='undefined'){
    const style=getComputedStyle(document.querySelector('.markdown-live')||document.body)
    for(const name of Object.keys(colors)){
      const color=style.getPropertyValue(`--${name}`).trim()
      if(color&&!/[<>;{}]/.test(color))colors[name]=color
    }
  }
  return {typography:{...typography},colors}
}
