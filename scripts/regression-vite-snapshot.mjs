import * as vite from 'vite'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'
import fs from 'node:fs'
export * from 'vite'

const ref=process.env.MARKUMO_TEST_REF
assert(!ref||/^[\w.-]+$/.test(ref))
const root=process.cwd().replaceAll('\\','/')+'/'
const paths=(ref?execFileSync('git',['ls-tree','-r','--name-only',ref,'--','src'],{encoding:'utf8',windowsHide:true}).trim().split('\n'):fs.readdirSync('src',{recursive:true}).map(file=>'src/'+file.replaceAll('\\','/'))).filter(file=>/\.(?:ts|tsx|vue|css|json)$/.test(file))
// Read the Git objects in memory. No second checkout or source-file mutation.
const batch=ref?execFileSync('git',['cat-file','--batch'],{input:paths.map(file=>`${ref}:${file}`).join('\n')+'\n',maxBuffer:32*1024*1024,windowsHide:true}):null
const sources=new Map();let offset=0
for(const file of paths){
 if(!batch){sources.set(path.resolve(file).replaceAll('\\','/'),fs.readFileSync(file,'utf8'));continue}
 const end=batch.indexOf(10,offset),header=batch.subarray(offset,end).toString(),size=Number(header.split(' ').at(-1))
 assert(Number.isInteger(size),header)
 sources.set(path.resolve(file).replaceAll('\\','/'),batch.subarray(end+1,end+1+size).toString())
 offset=end+size+2
}
// Discover literal runtime imports before the browser starts. A cold Vite
// re-optimization during a lazy Live import otherwise consumes interaction
// deadlines and can reload the fixture in the middle of a focus assertion.
const dependencies=new Set(['@tauri-apps/api/mocks'])
for(const [file,source] of sources){
 if(!/\.(?:ts|tsx|vue)$/.test(file))continue
 const scripts=file.endsWith('.vue')?[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]):[source]
 for(const script of scripts){
  const ast=ts.createSourceFile(file+'.ts',script,ts.ScriptTarget.Latest,true)
  const add=value=>{if(value&&!value.startsWith('.')&&!value.startsWith('/')&&!value.includes(':')&&!/\.(?:css|svg)(?:\?|$)/.test(value))dependencies.add(value)}
  const visit=node=>{
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text)
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0].text)
   ts.forEachChild(node,visit)
  };visit(ast)
 }
}
export async function createServer(options={}){
 const config=vite.mergeConfig(options,{optimizeDeps:{include:[...dependencies],entries:[],noDiscovery:true,holdUntilCrawlEnd:false},server:{watch:null,hmr:false},plugins:[{
  name:'committed-regression-source',enforce:'pre',load(id){
   const [file,query]=id.split('?')
   if(query&&file.endsWith('.vue'))return
   if(ref&&file.startsWith(root+'src/')&&sources.has(file)){
    const source=sources.get(file)
    if(query&&new URLSearchParams(query).has('raw'))return `export default ${JSON.stringify(source)}`
    return source
   }
  },
 }]})
 config.optimizeDeps.include=[...new Set([...dependencies,...(options.optimizeDeps?.include??[])])].sort()
 config.optimizeDeps.entries=[]
 const fixturePlugins=(options.plugins??[]).flat().filter(Boolean).map(plugin=>plugin.name??'fixture').join('-').replace(/[^\w-]/g,'-')||'standard'
 config.cacheDir=options.cacheDir??path.resolve('node_modules/.vite-regressions',ref||'working-tree',`${fixturePlugins}-${options.server?.port??1420}`)
 const server=await vite.createServer(config)
 const optimizer=server.environments.client.depsOptimizer
 if(optimizer){await optimizer.init();await optimizer.scanProcessing;optimizer.run();await Promise.all(Object.values(optimizer.metadata.discovered).map(info=>info.processing))}
 return server
}
