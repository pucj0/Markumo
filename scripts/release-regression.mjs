import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
import {createHash} from 'node:crypto'
import {collect,platforms,validate} from './release.mjs'

assert.equal(validate('v1.0.0'),'1.0.0')
assert.throws(()=>validate('v0.1.0'),/must match/)
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'markumo-release-'))
try{
  for(const platform of platforms){
    const directory=path.join(folder,`bundles-${platform.target}`);fs.mkdirSync(directory)
    for(const extension of [platform.update,...platform.extra]){
      const file=path.join(directory,'fixture'+extension);fs.writeFileSync(file,'installer fixture')
      if(extension===platform.update)fs.writeFileSync(file+'.sig',Buffer.from('signature fixture').toString('base64'))
    }
  }
  const result=collect(folder,'1.0.0','v1.0.0','pucj0/Markumo')
  assert.equal(result.assets.length,9)
  assert.equal(result.assets.some(asset=>asset.name.endsWith('.sig')),false)
  assert.deepEqual(JSON.parse(result.assets.find(asset=>asset.name==='latest.json').bytes),result.manifest)
  const checksums=result.assets.find(asset=>asset.name==='SHA256SUMS').bytes.toString()
  assert.equal(checksums.includes('.sig'),false)
  for(const asset of result.assets.filter(asset=>asset.name!=='SHA256SUMS'))assert.ok(checksums.includes(`${createHash('sha256').update(asset.bytes).digest('hex')}  ${asset.name}\n`))
  for(const platform of platforms)assert.equal(result.manifest.platforms[platform.key].signature,Buffer.from('signature fixture').toString('base64'))
  assert.deepEqual(Object.keys(result.manifest.platforms),platforms.map(p=>p.key))
  assert.match(result.manifest.platforms['darwin-aarch64'].url,/v1\.0\.0\/Markumo_1\.0\.0_macos_aarch64\.app\.tar\.gz$/)
  const signature=path.join(folder,`bundles-${platforms[0].target}`,'fixture.exe.sig')
  fs.unlinkSync(signature);assert.throws(()=>collect(folder,'1.0.0','v1.0.0','pucj0/Markumo'))
}finally{fs.rmSync(folder,{recursive:true,force:true})}

const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const server=await createServer({server:{port:1423,strictPort:true}});await server.listen()
let browser
try{
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://localhost:1423')
  await page.evaluate(()=>{window.projectLinks=[];window.open=(...args)=>{window.projectLinks.push(args);return null}})
  await page.getByRole('button',{name:'在 GitHub 查看 Markumo'}).click()
  assert.deepEqual(await page.evaluate(()=>window.projectLinks),[['https://github.com/pucj0/Markumo','_blank','noopener,noreferrer']])
  const result=await page.evaluate(async()=>{
    const {AppUpdater,updateState}=await import('/src/features/shell/AppUpdater.ts')
    let installs=0,downloads=0,relaunches=0,closed=0,allowed=false
    const update={version:'1.1.0',body:'Release notes',async download(progress){downloads++;progress({event:'Started',data:{contentLength:20}});progress({event:'Progress',data:{chunkLength:20}})},async install(){installs++},async close(){closed++}}
    const state=updateState(),controller=new AppUpdater(state,{check:async()=>update,beforeInstall:async()=>allowed,relaunch:async()=>{relaunches++}})
    await controller.check();const available=state.phase==='available'
    await controller.install();const guarded=state.phase==='downloaded'&&installs===0&&state.received===20
    allowed=true;await controller.install();const installed=state.phase==='ready'&&downloads===1&&installs===1&&relaunches===1
    controller.dispose();await Promise.resolve()
    const failure=updateState(),failed=new AppUpdater(failure,{check:async()=>{throw Error('offline')},beforeInstall:async()=>true,relaunch:async()=>{}})
    await failed.check();const offline=failure.phase==='error'&&failure.error.includes('offline');failed.dispose()
    let release;const pending=new Promise(resolve=>release=resolve),late=updateState(),cancelled=new AppUpdater(late,{check:()=>pending,beforeInstall:async()=>true,relaunch:async()=>{}})
    const checking=cancelled.check();cancelled.dispose();release(update);await checking
    const corrupt=updateState();let corruptInstalled=false
    const signatureFailure=new AppUpdater(corrupt,{check:async()=>({...update,download:async()=>{throw Error('signature verification failed')},install:async()=>{corruptInstalled=true}}),beforeInstall:async()=>true,relaunch:async()=>{}})
    await signatureFailure.check();await signatureFailure.install();signatureFailure.dispose()
    return {available,guarded,installed,offline,closed,signatureRejected:!corruptInstalled&&corrupt.phase==='available'}
  })
  assert.deepEqual(result,{available:true,guarded:true,installed:true,offline:true,closed:3,signatureRejected:true})
  assert.deepEqual(errors,[])
  console.log('PASS: complete release manifest, missing-signature rejection, GitHub link, update progress, dirty guard, retry without re-download, offline recovery and resource cleanup')
}finally{await browser?.close();await server.close()}
