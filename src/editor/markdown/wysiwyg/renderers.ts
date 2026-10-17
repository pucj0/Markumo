// Load only for documents containing diagrams or formulas.
let serial:Promise<unknown>=Promise.resolve(),identity=0
export async function renderDiagram(host:HTMLElement,source:string,current:()=>boolean=()=>true){
  if(source.length>8000||source.split('\n').length>200)throw new Error('图表超过 8000 字符 / 200 行安全预算，请编辑源码。')
  if(/%%\{|^\s*---|@\{|<|https?:|url\s*\(|\b(?:click|href|callback|linkStyle|classDef|style)\b/im.test(source))throw new Error('图表中的配置、资源、样式、外链和回调未启用。')
  const request=serial.then(async()=>{
    const [{default:mermaid},{default:purify}]=await Promise.all([import('mermaid'),import('dompurify')])
    mermaid.initialize({startOnLoad:false,securityLevel:'strict',maxTextSize:8000,maxEdges:200,htmlLabels:false,flowchart:{htmlLabels:false},theme:document.body.classList.contains('light')?'default':'dark'})
    const id=`markumo-diagram-${++identity}`
    try{
      const {svg}=await mermaid.render(id,source)
      if(!host.isConnected||!current())return
      const cleaned=purify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','a','image','script','iframe'],FORBID_ATTR:['href','xlink:href','onclick','onload']})
      host.innerHTML=cleaned
    }finally{document.getElementById('d'+id)?.remove()}
  })
  serial=request.catch(()=>{});await request
}
export async function renderMath(host:HTMLElement,source:string,displayMode=false,current:()=>boolean=()=>true){
  if(source.length>4096)throw new Error('公式超过 4096 字符预算，请编辑源码。')
  const [{default:katex}]=await Promise.all([import('katex'),import('katex/dist/katex.min.css')])
  if(!host.isConnected||!current())return
  // KaTeX generates its own HTML/MathML with trust disabled; no user HTML enters
  // the host. Expansion limits bound pathological macro input.
  katex.render(source,host,{displayMode,trust:false,strict:'error',throwOnError:false,maxExpand:200,maxSize:20})
}
