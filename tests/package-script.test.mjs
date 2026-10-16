import {describe,it,expect} from 'vitest'
import {join} from 'node:path'
import {packageOptions,buildEnvironment,bundleDirectory} from '../scripts/package.mjs'

describe('Native package entry points',()=>{
  it.each([['win32',['nsis']],['darwin',['app','dmg']],['linux',['deb','appimage']]])('selects real %s bundle formats', (host,bundles)=>{
    expect(packageOptions([],host).bundles).toEqual(bundles)
  })
  it('refuses unsupported/cross-host targets and unknown options',()=>{
    expect(()=>packageOptions(['--platform','macos'],'win32')).toThrow('on macOS')
    expect(()=>packageOptions(['--platform','all'],'win32')).toThrow()
    expect(()=>packageOptions(['--platform'],'win32')).toThrow()
    expect(()=>packageOptions(['--fake'],'linux')).toThrow()
    expect(()=>packageOptions([],'android')).toThrow()
  })
  it('offers side-effect-free check/help options',()=>{
    expect(packageOptions(['--check','--skip-install'],'linux')).toMatchObject({check:true,skipInstall:true})
    expect(packageOptions(['--help','--platform','macos'],'win32').help).toBe(true)
  })
  it('preserves signing/proxy variables but removes inherited development config without mutating its input',()=>{
    const input={Path:'original',TAURI_CONFIG:'dev override',LIGHTEDIT_DEV_DATA_DIR:'test profile',MARKUMO_DEV_DATA_DIR:'new profile',MARKUMO_DESKTOP_NO_RELOAD:'1',APPLE_SIGNING_IDENTITY:'Developer ID',CARGO_HTTP_PROXY:'http://localhost:7897'}
    const env=buildEnvironment(input,'user home')
    expect(env.Path).toContain(join('user home','.cargo','bin'));expect(env.TAURI_CONFIG).toBeUndefined()
    expect(env.LIGHTEDIT_DEV_DATA_DIR).toBeUndefined();expect(env.APPLE_SIGNING_IDENTITY).toBe('Developer ID');expect(env.CARGO_HTTP_PROXY).toBe(input.CARGO_HTTP_PROXY)
    expect(input.TAURI_CONFIG).toBe('dev override')
    expect(env.MARKUMO_DEV_DATA_DIR).toBeUndefined();expect(env.MARKUMO_DESKTOP_NO_RELOAD).toBeUndefined()
  })
  it('reports native and explicitly configured Cargo output paths',()=>{
    expect(bundleDirectory('target')).toBe(join('target','release','bundle'))
    expect(bundleDirectory('other target','aarch64-apple-darwin')).toBe(join('other target','aarch64-apple-darwin','release','bundle'))
  })
})
