// Compare a saved pre-change file inventory with the current production build.
// node scripts/media-size-report.mjs path/to/baseline-assets.json [path/to/baseline-installer.json]
import fs from 'node:fs'
import path from 'node:path'
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[{FullName:path.join(dir,entry.name),Length:fs.statSync(path.join(dir,entry.name)).size}])
const before=readJSON(process.argv[2]),after=walk('dist')
const sum=files=>files.reduce((total,file)=>total+file.Length,0)
const main=files=>files.filter(file=>/^index-[^/\\]+\.js$/.test(path.basename(file.FullName))).sort((a,b)=>b.Length-a.Length)[0]?.Length
const installer=fs.readdirSync('src-tauri/target/release/bundle/nsis').find(name=>name.endsWith('-setup.exe'))
const result={dist:{before:sum(before),after:sum(after)},mainJS:{before:main(before),after:main(after)},pdfAssets:sum(after.filter(f=>f.FullName.includes(`${path.sep}pdfjs${path.sep}`)))}
if(process.argv[3])result.installer={before:readJSON(process.argv[3]).Length,after:fs.statSync(path.join('src-tauri/target/release/bundle/nsis',installer)).size}
console.log(JSON.stringify(result,null,2))
