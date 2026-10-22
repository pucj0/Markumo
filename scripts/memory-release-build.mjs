// Build a historical frontend on main through a read-only Vite source overlay.
// Rust/lock/config must be identical; no branch checkout or worktree is created.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build } from 'vite'
import { run } from '@tauri-apps/cli'

const arg = name => process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)
const ref = arg('ref'), label = arg('label')
assert(ref && /^[\w.-]+$/.test(ref) && /^(before|after)$/.test(label))
const git = args => execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git(['branch','--show-current']),'main')
assert.equal(git(['diff',ref,'--','src-tauri','package.json','pnpm-lock.yaml','vite.config.ts']),'','Native source, dependencies and build config must match the reference')
const commit=git(['rev-parse',ref]), root=path.resolve('test-results/phase041')
fs.mkdirSync(root,{recursive:true})
const changed=git(['diff','--name-only',ref,'--','src']).split('\n').filter(Boolean)
const originals=new Map(changed.map(file=>[path.resolve(file).replaceAll('\\','/'),execFileSync('git',['show',`${commit}:${file}`],{encoding:'utf8',windowsHide:true})]))
const dist=path.join(root,`dist-${label}`)
await build({logLevel:'warn',plugins:[{name:'memory-reference-overlay',enforce:'pre',load(id){
    const [file,query]=id.split('?')
    if(query&&file.endsWith('.vue'))return
    const source=originals.get(file)
    if(source!==undefined&&query&&new URLSearchParams(query).has('raw'))return `export default ${JSON.stringify(source)}`
    return source
  },
  transform(code,id){
    if(id.replaceAll('\\','/').endsWith('/core/DocumentManager.ts')) {
      const anchor='constructor(seeds: DocumentSeed[] = [], private readonly languageLoader = loadLanguage) {'
      assert(code.includes(anchor),'Production manager probe anchor must exist')
      return code.replace(anchor,anchor+'\nwindow.__nativeManager=this;\n')
    }
    if(!id.replaceAll('\\','/').endsWith('/wysiwyg/CodeBlockView.ts')) return
    assert(code.includes('extensions: ['),'Allocation probe anchor must exist')
    return `import {ViewPlugin as MemoryViewPlugin} from '@codemirror/view';\n`+code.replace('extensions: [',`extensions: [MemoryViewPlugin.define(() => {
      const p=window.__memoryProbe??={created:0,live:0,peak:0};p.created++;p.live++;p.peak=Math.max(p.peak,p.live);
      return {destroy(){p.live--}};
    }),`)
  }}],build:{outDir:dist,emptyOutDir:true}})
const config={identifier:'com.markumo.phase041-audit',app:{appDirectoriesOverride:path.join(root,'native-profile')},
  build:{beforeBuildCommand:null,frontendDist:path.relative(path.resolve('src-tauri'),dist).replaceAll('\\','/')},bundle:{active:false,createUpdaterArtifacts:false}}
const configPath=path.join(root,`config-${label}.json`)
fs.writeFileSync(configPath,JSON.stringify(config,null,2))
await run(['build','--no-bundle','--config',configPath],'tauri')
const binary=path.join(root,`markumo-${label}.exe`)
fs.copyFileSync('src-tauri/target/release/markumo.exe',binary)
const sha256=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(path.join(root,`build-${label}.json`),JSON.stringify({commit,label,binary,sha256:sha256(binary),
  rustTree:git(['rev-parse',`${commit}:src-tauri`]),overlay:changed,
  instrumentation:'Embedded CM allocation counters and a reference to the production manager; identical probes in both builds',
  frontendFiles:fs.readdirSync(path.join(dist,'assets')).sort(),builtAt:new Date().toISOString()},null,2))
console.log(`Built isolated ${label} Release from ${commit}: ${binary}`)
