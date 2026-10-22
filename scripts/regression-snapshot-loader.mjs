// Resolve only test imports of Vite through a read-only source snapshot.
const wrapper=new URL('./regression-vite-snapshot.mjs',import.meta.url).href
export async function resolve(specifier,context,nextResolve){
  if(specifier==='vite'&&context.parentURL!==wrapper)return{url:wrapper,shortCircuit:true}
  return nextResolve(specifier,context)
}
