// Isolated Release acceptance build. Only test-time references are injected;
// native commands, stores, CSP and editor components are the production sources.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {build} from 'vite'
import {run} from '@tauri-apps/cli'
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim()
assert.equal(git('branch','--show-current'),'main')
const root=path.resolve('test-results/repair05-native')
fs.mkdirSync(root,{recursive:true})
const profile=fs.mkdtempSync(path.join(root,'profile-'))
const dist=path.join(root,'dist')
await build({logLevel:'warn',plugins:[{name:'repair05-observation',enforce:'pre',transform(code,id){
 if(id.replaceAll('\\','/').endsWith('/src/App.vue')){
  assert(code.includes('= useAppShell()'))
  return code.replace('= useAppShell()','= (globalThis.__repairShell = useAppShell())')
 }
 if(id.replaceAll('\\','/').endsWith('/src/main.ts'))return `import {invoke as acceptanceInvoke} from '@tauri-apps/api/core';\nimport {generateDocx as acceptanceDocx} from './features/document-conversion/docxWorkerClient';\n`+code+`\nglobalThis.__repairNative={invoke:acceptanceInvoke,generateDocx:acceptanceDocx};`
}}],build:{outDir:dist,emptyOutDir:true}})
const config={identifier:'com.markumo.repair05-audit',app:{appDirectoriesOverride:profile},
 build:{beforeBuildCommand:null,frontendDist:path.relative(path.resolve('src-tauri'),dist).replaceAll('\\','/')},bundle:{active:false,createUpdaterArtifacts:false}}
const configPath=path.join(root,'config.json')
fs.writeFileSync(configPath,JSON.stringify(config,null,2))
const workspace=process.cwd()
await run(['build','--no-bundle','--config',configPath],'tauri')
process.chdir(workspace)
const binary=path.join(root,'markumo-acceptance.exe')
fs.copyFileSync('src-tauri/target/release/markumo.exe',binary)
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const files=git('ls-files','src','src-tauri').split('\n').filter(p=>fs.statSync(p).isFile())
fs.writeFileSync(path.join(root,'build.json'),JSON.stringify({commit:git('rev-parse','HEAD'),binary,profile,sha256:hash(binary),
 sourceHashes:Object.fromEntries(files.map(p=>[p,hash(p)])),instrumentation:'Test-only references to actual useAppShell, Tauri invoke and DOCX worker client. No native IPC mock or alternate editor.'},null,2))
console.log('Built isolated native acceptance Release:',binary)
