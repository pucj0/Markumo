import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeWindowsArtifacts } from './windows-artifacts.mjs'

export const platforms = {
  win32: { name: 'Windows', bundles: ['nsis'] },
  darwin: { name: 'macOS', bundles: ['app', 'dmg'] },
  linux: { name: 'Linux', bundles: ['deb', 'appimage'] },
}
const names = { windows: 'win32', macos: 'darwin', linux: 'linux' }
export function packageOptions(args, host = process.platform) {
  let platform = host, check = false, skipInstall = false, help = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true
    else if (args[i] === '--skip-install') skipInstall = true
    else if (args[i] === '--help' || args[i] === '-h') help = true
    else if (args[i] === '--platform') {
      platform = names[args[++i]]
      if (!platform) throw Error('--platform requires windows, macos or linux.')
    } else throw Error(`Unknown argument: ${args[i]}. Use --help.`)
  }
  if (!platforms[platform]) throw Error(`Unsupported host platform: ${platform}`)
  if (!help && platform !== host) throw Error(`Build ${platforms[platform].name} packages on ${platforms[platform].name}. This script does not cross-compile. See README.md.`)
  return { platform, check, skipInstall, help, ...platforms[platform] }
}

export function buildEnvironment(environment, home = homedir()) {
  const env = { ...environment }
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
  env[key] = join(home, '.cargo', 'bin') + delimiter + (env[key] || '')
  // A build invoked from a dev/test terminal must not embed its data-directory
  // override in the distributed application. Signing/proxy variables stay intact.
  delete env.TAURI_CONFIG
  delete env.MARKUMO_DEV_DATA_DIR
  delete env.MARKUMO_DESKTOP_NO_RELOAD
  return env
}

export function bundleDirectory(targetDirectory, buildTarget) {
  return join(targetDirectory, ...(buildTarget ? [buildTarget] : []), 'release', 'bundle')
}

export function main(args = process.argv.slice(2)) {
  const options = packageOptions(args)
  if (options.help) {
    console.log(`Markumo local packaging
Windows: build.bat [--check] [--skip-install]
macOS/Linux: sh build.sh [--check] [--skip-install]
Optional: --platform windows|macos|linux (must match the host OS)
Default: install locked pnpm dependencies, then build native release installers.
--check: check prerequisites only; no install, compilation or packaging.
--skip-install: use existing node_modules; do not run pnpm install.
Output: Cargo target directory / release / bundle (or its configured target subdirectory).
No installation, Git operations, signing-key generation or publishing is performed.`)
    return
  }
  if (Number(process.versions.node.split('.')[0]) < 18) throw Error('Node.js 18 or newer is required.')
  const project = dirname(dirname(fileURLToPath(import.meta.url)))
  const env = buildEnvironment(process.env)
  if (process.env.TAURI_CONFIG) console.log('[INFO] Ignoring inherited TAURI_CONFIG; using the repository production configuration.')
  function run(command, commandArgs, capture = false) {
    const result = spawnSync(command, commandArgs, { cwd: project, env, windowsHide: true, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
    if (result.error) throw Error(`Cannot run ${command}: ${result.error.message}`)
    if (result.status !== 0) throw Error(`${command} failed (${result.status ?? result.signal}). ${capture ? (result.stderr || '').trim() : 'See the output above.'}`)
    return capture ? result.stdout.trim() : ''
  }
  function pnpm(command) {
    // Fixed strings only: no project paths or user input interpolated into cmd.
    if (process.platform === 'win32') return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `pnpm ${command}`])
    return run('pnpm', command.split(' '))
  }
  console.log(`[Markumo] ${options.name}: ${options.bundles.join(', ')} (${process.arch})`)
  pnpm('--version')
  const rust = run('rustc', ['-vV'], true)
  console.log(run('cargo', ['--version'], true))
  if (options.platform === 'win32' && !/host: .*-windows-msvc/.test(rust)) throw Error('Use the Rust MSVC toolchain on Windows: rustup default stable-msvc. Install Visual Studio Desktop development with C++ and Windows SDK.')
  if (env.CARGO_BUILD_TARGET && !env.CARGO_BUILD_TARGET.includes({win32:'windows-msvc',darwin:'apple-darwin',linux:'linux'}[options.platform])) throw Error('CARGO_BUILD_TARGET does not match this operating system. Unset it before packaging.')
  if (options.platform === 'darwin') run('xcode-select', ['-p'])
  if (options.platform === 'linux') run('pkg-config', ['--exists', 'webkit2gtk-4.1'])
  if (options.check) {
    console.log('[OK] Node, pnpm, Rust/Cargo and basic platform checks passed. No package was built.')
    console.log('The linker/SDK and installer tooling are verified by the actual build. See README.md.')
    return
  }
  if (!options.skipInstall) pnpm('install --frozen-lockfile')
  if (!existsSync(join(project, 'node_modules/@tauri-apps/cli'))) throw Error('Tauri CLI is missing. Run pnpm install --frozen-lockfile first.')
  // Read Cargo configuration through Cargo, including a custom CARGO_TARGET_DIR.
  const metadata = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], true))
  const runner = join(project, 'scripts/tauri.mjs'), buildArgs = [runner, 'build', '--bundles', options.bundles.join(',')]
  if (env.CARGO_BUILD_TARGET) buildArgs.push('--target', env.CARGO_BUILD_TARGET)
  if (options.platform === 'darwin') {
    // Derive ICNS from the existing logo without rewriting source icon assets.
    const icons = join(metadata.target_directory, 'packaging-icons')
    mkdirSync(icons, { recursive: true })
    run(process.execPath, [runner, 'icon', join(project, 'src-tauri/icons/icon.png'), '--output', icons])
    buildArgs.push('--config', JSON.stringify({ bundle: { icon: [join(icons, 'icon.icns'), join(project, 'src-tauri/icons/icon.png')] } }))
  }
  run(process.execPath, buildArgs)
  const output = bundleDirectory(metadata.target_directory, env.CARGO_BUILD_TARGET)
  if (!existsSync(output)) throw Error(`Build exited successfully but no bundle directory was found at ${output}. Check any Cargo build.target configuration.`)
  if (options.platform === 'win32') {
    const config = JSON.parse(readFileSync(join(project, 'src-tauri/tauri.conf.json'), 'utf8'))
    normalizeWindowsArtifacts(metadata.target_directory,config.mainBinaryName||'markumo')
  }
  console.log(`\n[OK] Packaging completed. Output directory:\n${output}`)
  for (const directory of options.platform === 'darwin' ? ['macos','dmg'] : options.platform === 'win32' ? ['nsis'] : ['deb','appimage']) {
    const path = join(output, directory)
    if (existsSync(path)) for (const file of readdirSync(path)) console.log(`  ${join(path, file)}`)
  }
  const config = JSON.parse(readFileSync(join(project, 'src-tauri/tauri.conf.json'), 'utf8'))
  console.log(`Markumo ${config.version}. Installers were built locally; nothing was installed or published.`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main() } catch (error) { console.error(`\n[ERROR] ${error.message}\nSee README.md for prerequisites and troubleshooting.`); process.exitCode = 1 }
}
