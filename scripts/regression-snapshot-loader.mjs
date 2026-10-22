// Prepare deterministic test Vite hosts; source snapshots remain opt-in.
const wrapper=new URL('./regression-vite-snapshot.mjs',import.meta.url).href
export async function resolve(specifier,context,nextResolve){
  if(specifier==='vite'&&context.parentURL!==wrapper)return{url:wrapper,shortCircuit:true}
  return nextResolve(specifier,context)
}
