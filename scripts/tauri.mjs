import { mkdirSync,readFileSync } from 'node:fs'
import { dirname,join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { run } from '@tauri-apps/cli'
import { devOptions } from './devOptions.mjs'
import { normalizeWindowsArtifacts } from './windows-artifacts.mjs'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const options = devOptions(process.argv.slice(2), project)
if (options.directories.length) {
  for (const directory of options.directories) mkdirSync(directory, { recursive: true })
  Object.assign(process.env, options.env)
  console.log(`Markumo development data: ${options.directories[0]}`)
  console.log(options.watch ? 'Code hot reload enabled (--watch): saving application source may restart the editor.' : 'Stable desktop mode: automatic restart and frontend reload disabled. Use pnpm tauri:watch for code hot reload.')
}

try {
  await run(options.args, 'tauri')
  if(process.platform==='win32'&&['build','bundle'].includes(options.args[0])&&!options.args.some(arg=>arg==='--help'||arg==='-h')){
    const metadata=JSON.parse(execFileSync('cargo',['metadata','--no-deps','--format-version','1','--manifest-path','src-tauri/Cargo.toml'],{cwd:project,encoding:'utf8',windowsHide:true}))
    const config=JSON.parse(readFileSync(join(project,'src-tauri/tauri.conf.json'),'utf8'))
    normalizeWindowsArtifacts(metadata.target_directory,config.mainBinaryName||'markumo')
    console.log('Windows installers and executable: set to Medium integrity.')
  }
}
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
