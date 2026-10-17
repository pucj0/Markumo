import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {normalizeWindowsArtifacts} from './windows-artifacts.mjs'
if(process.platform!=='win32'){console.log('SKIP: Windows mandatory-integrity regression');process.exit(0)}
const workspace=path.resolve('.markumo-media-test');fs.mkdirSync(workspace,{recursive:true})
const folder=fs.mkdtempSync(path.join(workspace,'integrity-regression-'))
const icacls=path.join(process.env.SystemRoot,'System32/icacls.exe')
const labels=file=>execFileSync(icacls,[file],{encoding:'utf8',windowsHide:true})
const medium=/S-1-16-8192|Medium Mandatory Level|中强制级别/
try{
  const files=[]
  for(const prefix of ['', 'x86_64-pc-windows-msvc']){
    const release=path.join(folder,prefix,'release'),installers=path.join(release,'bundle/nsis');fs.mkdirSync(installers,{recursive:true})
    for(const file of [path.join(release,'markumo.exe'),path.join(installers,'Markumo_1.0.0_x64-setup.exe')]){
      fs.writeFileSync(file,'unchanged signed bytes')
      execFileSync(icacls,[file,'/setintegritylevel','L'],{stdio:'pipe',windowsHide:true});files.push(file)
    }
    execFileSync(icacls,[installers,'/setintegritylevel','(OI)(CI)L'],{stdio:'pipe',windowsHide:true})
  }
  normalizeWindowsArtifacts(folder)
  for(const file of files){assert(medium.test(labels(file)),`Output is not Medium: ${file}`);assert.equal(fs.readFileSync(file,'utf8'),'unchanged signed bytes')}
  const inherited=path.join(path.dirname(files[1]),'next-build.exe');fs.writeFileSync(inherited,'next build')
  assert(medium.test(labels(inherited)),'The next build inherited Low integrity again')
  console.log('PASS: Low-to-Medium output labels, explicit Windows targets, inherited labels and unchanged signed bytes')
}finally{
  if(path.dirname(folder)!==workspace)throw Error('Unexpected regression output directory')
  fs.rmSync(folder,{recursive:true,force:true})
}
