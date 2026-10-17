import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'

export const platforms=[
  {target:'x86_64-pc-windows-msvc',key:'windows-x86_64',name:'windows_x86_64',update:'.exe',extra:[]},
  {target:'x86_64-unknown-linux-gnu',key:'linux-x86_64',name:'linux_x86_64',update:'.AppImage',extra:['.deb']},
  {target:'aarch64-apple-darwin',key:'darwin-aarch64',name:'macos_aarch64',update:'.app.tar.gz',extra:['.dmg']},
  {target:'x86_64-apple-darwin',key:'darwin-x86_64',name:'macos_x86_64',update:'.app.tar.gz',extra:['.dmg']},
]
export function validate(tag=process.env.RELEASE_TAG){
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8')),config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'))
  const cargo=/^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync('src-tauri/Cargo.toml','utf8'))?.[1]
  if(!/^v\d+\.\d+\.\d+$/.test(tag||'')||tag!==`v${pkg.version}`||pkg.version!==config.version||pkg.version!==cargo)throw Error('Release tag, package.json, Cargo.toml and tauri.conf.json versions must match (vX.Y.Z).')
  if(!config.bundle.createUpdaterArtifacts||!config.plugins?.updater?.pubkey)throw Error('Signed updater artifacts and a public key are required.')
  return pkg.version
}
function walk(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(folder,entry.name)):[path.join(folder,entry.name)])}
export function collect(folder,version,tag,repository){
  const assets=[],manifest={version,notes:`Markumo ${version}`,pub_date:new Date().toISOString(),platforms:{}}
  for(const platform of platforms){
    const files=walk(path.join(folder,`bundles-${platform.target}`))
    for(const extension of [platform.update,...platform.extra]){
      const found=files.filter(file=>file.endsWith(extension))
      if(found.length!==1)throw Error(`Expected exactly one ${extension} for ${platform.target}, found ${found.length}.`)
      const file=found[0],name=`Markumo_${version}_${platform.name}${extension==='.exe'?'-setup.exe':extension}`,bytes=fs.readFileSync(file)
      if(!bytes.length)throw Error(`Empty installer: ${file}`)
      assets.push({name,bytes})
      if(extension===platform.update){
        const signature=fs.readFileSync(file+'.sig','utf8').trim()
        if(!signature||!/^[A-Za-z\d+/=\r\n]+$/.test(signature))throw Error(`Missing or invalid update signature: ${file}`)
        assets.push({name:name+'.sig',bytes:Buffer.from(signature+'\n')})
        manifest.platforms[platform.key]={url:`https://github.com/${repository}/releases/download/${tag}/${name}`,signature}
      }
    }
  }
  assets.push({name:'latest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')})
  assets.push({name:'SHA256SUMS',bytes:Buffer.from(assets.map(asset=>`${createHash('sha256').update(asset.bytes).digest('hex')}  ${asset.name}`).join('\n')+'\n')})
  return {assets,manifest}
}
async function publish(){
  const tag=process.env.RELEASE_TAG,version=validate(tag),repository=process.env.GITHUB_REPOSITORY
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('GITHUB_REPOSITORY is required.')
  const {assets}=collect('.release-artifacts',version,tag,repository)
  const notesFile=`docs/releases/${tag}.md`,body=fs.existsSync(notesFile)?fs.readFileSync(notesFile,'utf8'):`Markumo ${version}`
  const token=process.env.GITHUB_TOKEN;if(!token)throw Error('GITHUB_TOKEN is required.')
  async function api(url,method='GET',data,raw=false){
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':raw?'application/octet-stream':'application/json'},body:data===undefined?undefined:raw?data:JSON.stringify(data),signal:AbortSignal.timeout(180000)})
    if(!response.ok)throw Error(`GitHub ${method} ${new URL(url).pathname}: HTTP ${response.status}`)
    return response.status===204?null:response.json()
  }
  const endpoint=`https://api.github.com/repos/${repository}/releases`
  const releases=await api(endpoint+'?per_page=100');let release=releases.find(item=>item.tag_name===tag)
  if(release&&!release.draft)throw Error(`${tag} is already published; release a new version instead of replacing installers.`)
  if(!release)release=await api(endpoint,'POST',{tag_name:tag,name:`Markumo ${version}`,body,draft:true,prerelease:false})
  const existing=await api(`${endpoint}/${release.id}/assets?per_page=100`)
  for(const asset of assets){
    const old=existing.find(item=>item.name===asset.name);if(old)await api(`https://api.github.com/repos/${repository}/releases/assets/${old.id}`,'DELETE')
    await api(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(asset.name),'POST',asset.bytes,true)
    console.log(`Uploaded ${asset.name} (${asset.bytes.length} bytes)`)
  }
  release=await api(`${endpoint}/${release.id}`,'PATCH',{draft:false,prerelease:false,make_latest:'true',body})
  console.log(`Published ${release.html_url}`)
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{if(process.argv[2]==='validate')console.log(`Validated Markumo ${validate()}`);else if(process.argv[2]==='publish')await publish();else throw Error('Usage: node scripts/release.mjs validate|publish')}
  catch(error){console.error(error.message);process.exitCode=1}
}
