import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '@tauri-apps/cli'
import { devOptions } from './devOptions.mjs'
import { spawnSync } from 'node:child_process'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const options = devOptions(process.argv.slice(2), project)
if (['build','bundle'].includes(options.args[0]) && process.platform === 'win32' && !options.args.includes('--help')) {
  const architecture=(process.env.CARGO_BUILD_TARGET||'').startsWith('aarch64')||process.arch==='arm64'?'arm64':'x64'
  const shellBuild=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',`${project}/scripts/build-windows-shell.ps1`,'-Architecture',architecture],{cwd:project,stdio:'inherit',windowsHide:true})
  if(shellBuild.error||shellBuild.status!==0)throw shellBuild.error||Error('Windows Shell extension build failed')
  options.args.push('--config',JSON.stringify({bundle:{resources:{
    'target/windows-shell/MarkumoShell.dll':'shell/MarkumoShell.dll',
    'target/windows-shell/Markumo.Shell.msix':'shell/Markumo.Shell.msix',
    'target/windows-shell/Register.ps1':'shell/Register.ps1',
    'target/windows-shell/Assets/':'shell/Assets/',
  }}}))
}
if (options.directories.length) {
  for (const directory of options.directories) mkdirSync(directory, { recursive: true })
  Object.assign(process.env, options.env)
  console.log(`Markumo development data: ${options.directories[0]}`)
  console.log(options.watch ? 'Code hot reload enabled (default for pnpm tauri dev).' : 'File-test mode (--no-watch): automatic restart and frontend reload disabled.')
}

try { await run(options.args, 'tauri') }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
