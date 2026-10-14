import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { devOptions } from '../scripts/devOptions.mjs'
import { resolveConfig } from 'vite'

describe('Desktop development launch policy', () => {
  it('enables hot reload by default while preserving cargo/application arguments verbatim', () => {
    const input = ['dev', '--', '--features', 'test', '--', 'E:\\文件\\name with spaces.txt', '--watch']
    const result = devOptions(input, process.cwd(), {})
    expect(result.args.slice(result.args.indexOf('--'))).toEqual(input.slice(1))
    expect(result.args).not.toContain('--no-watch')
    expect(result.watch).toBe(true)
    expect(result.env.LIGHTEDIT_DESKTOP_NO_RELOAD).toBe('0')
    expect(input).toEqual(['dev', '--', '--features', 'test', '--', 'E:\\文件\\name with spaces.txt', '--watch'])
  })
  it('supports the legacy watch alias and only consumes the launcher option', () => {
    const result = devOptions(['dev', '--watch', '--', '--', '--watch'], process.cwd(), {})
    expect(result.env.LIGHTEDIT_DESKTOP_NO_RELOAD).toBe('0')
    expect(result.args).not.toContain('--no-watch')
    expect(result.args.slice(result.args.indexOf('--'))).toEqual(['--', '--', '--watch'])
  })
  it('does not redirect production commands or overwrite caller environment', () => {
    const env = { TEMP: 'original', WEBVIEW2_USER_DATA_FOLDER: 'original', CARGO_HTTP_PROXY: 'existing' }
    const result = devOptions(['build', '--release'], process.cwd(), env)
    expect(result).toEqual({ args: ['build', '--release'], env, directories: [] })
    expect(result.env).not.toBe(env)
  })
  it('keeps explicitly requested no-watch unique and isolates native regression data', () => {
    const env = { LIGHTEDIT_DEV_DATA_DIR: 'test-results/profile with spaces' }
    const result = devOptions(['dev', '--no-watch'], process.cwd(), env)
    expect(result.args.filter(arg => arg === '--no-watch')).toHaveLength(1)
    expect(result.watch).toBe(false)
    expect(result.env.LIGHTEDIT_DESKTOP_NO_RELOAD).toBe('1')
    const config = JSON.parse(result.args[result.args.indexOf('--config') + 1])
    expect(config.app.appDirectoriesOverride).toBe(resolve(process.cwd(), env.LIGHTEDIT_DEV_DATA_DIR))
    expect(env).not.toHaveProperty('TEMP')
  })
  it('does not interpret application no-watch as a CLI flag, and explicit CLI no-watch wins over the alias', () => {
    const application = devOptions(['dev', '--', '--', '--no-watch'], process.cwd(), {})
    expect(application.watch).toBe(true)
    expect(application.env.LIGHTEDIT_DESKTOP_NO_RELOAD).toBe('0')
    expect(application.args.slice(application.args.indexOf('--'))).toEqual(['--', '--', '--no-watch'])
    const cli = devOptions(['dev', '--watch', '--no-watch'], process.cwd(), {})
    expect(cli.watch).toBe(false)
    expect(cli.env.LIGHTEDIT_DESKTOP_NO_RELOAD).toBe('1')
    expect(cli.args).toContain('--no-watch')
    expect(cli.args).not.toContain('--watch')
  })
  it('loads actual Vite config with frontend watching and HMR disabled only for file tests', async () => {
    const previous = process.env.LIGHTEDIT_DESKTOP_NO_RELOAD
    try {
      process.env.LIGHTEDIT_DESKTOP_NO_RELOAD = '1'
      const desktop = await resolveConfig({}, 'serve')
      expect(desktop.server.watch).toBeNull()
      expect(desktop.server.hmr).toBe(false)
      process.env.LIGHTEDIT_DESKTOP_NO_RELOAD = '0'
      const watched = await resolveConfig({}, 'serve')
      expect(watched.server.watch).not.toBeNull()
      expect(watched.server.hmr).not.toBe(false)
    } finally {
      if (previous === undefined) delete process.env.LIGHTEDIT_DESKTOP_NO_RELOAD
      else process.env.LIGHTEDIT_DESKTOP_NO_RELOAD = previous
    }
  })
})
