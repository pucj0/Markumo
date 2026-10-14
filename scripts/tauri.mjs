import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '@tauri-apps/cli'
import { devOptions } from './devOptions.mjs'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const options = devOptions(process.argv.slice(2), project)
if (options.directories.length) {
  for (const directory of options.directories) mkdirSync(directory, { recursive: true })
  Object.assign(process.env, options.env)
  console.log(`LightEdit development data: ${options.directories[0]}`)
  console.log(options.watch ? 'Code hot reload enabled (default for pnpm tauri dev).' : 'File-test mode (--no-watch): automatic restart and frontend reload disabled.')
}

try { await run(options.args, 'tauri') }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
