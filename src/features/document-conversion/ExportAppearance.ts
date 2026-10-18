import { defaultMarkdownTypography, type MarkdownTypography } from '../../editor/markdown/wysiwyg/contracts'
import { syntaxRoles } from '../../editor/core/syntaxTheme'
import syntaxCss from '../../styles/syntax.css?raw'
const lightDefaults = new Map(Array.from((/body\.light\s*\{([^}]+)\}/.exec(syntaxCss)?.[1] || '').matchAll(/--(syntax-[\w-]+):\s*(#[\da-f]+)/g), match => [match[1], match[2]]))

export interface ExportAppearance { typography:MarkdownTypography; colors:Record<string,string> }
export function exportAppearance(typography=defaultMarkdownTypography()):ExportAppearance {
  const colors:Record<string,string>={ink:'#333',editor:'#fff',line:'#dfe2e5',muted:'#777',pink:'#c73369',green:'#22863a',yellow:'#986801',blue:'#005cc5',sub:'#57606a',accent:'#4183c4','md-code-bg':'#f8f8f8'}
  for (const role of syntaxRoles) colors[`syntax-${role}`] = lightDefaults.get(`syntax-${role}`) || '#353e4c'
  if(typeof document!=='undefined'){
    const style=getComputedStyle(document.querySelector('.markdown-live')||document.body)
    for(const name of Object.keys(colors)){
      const color=style.getPropertyValue(`--${name}`).trim()
      if(color&&!/[<>;{}]/.test(color))colors[name]=color
    }
  }
  return {typography:{...typography},colors:Object.fromEntries(Object.entries(colors).filter(([,value])=>value))}
}
