import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED_EXTENSIONS = [
  'txt', 'md', 'markdown', 'json', 'jsonc', 'xml', 'yaml', 'yml',
  'js', 'jsx', 'ts', 'tsx', 'vue', 'html', 'css', 'scss',
  'java', 'py', 'go', 'rs', 'sql', 'log', 'ini', 'cfg', 'conf', 'properties',
  'sh', 'bat', 'cmd'
]

describe('Windows File Associations & Context Menu Configuration', () => {
  const projectRoot = process.cwd()
  const tauriConfPath = join(projectRoot, 'src-tauri/tauri.conf.json')
  const hooksPath = join(projectRoot, 'src-tauri/windows/installerHooks.nsh')

  const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
  const hooksContent = readFileSync(hooksPath, 'utf8')

  it('declares all 29 supported file extensions under bundle.fileAssociations in tauri.conf.json', () => {
    expect(tauriConf.bundle?.fileAssociations).toBeInstanceOf(Array)
    const declaredExts = new Set<string>()
    for (const assoc of tauriConf.bundle.fileAssociations) {
      expect(assoc.ext).toBeInstanceOf(Array)
      for (const ext of assoc.ext) {
        declaredExts.add(ext.toLowerCase().replace(/^\./, ''))
      }
      expect(assoc.role).toBe('Editor')
    }

    for (const reqExt of REQUIRED_EXTENSIONS) {
      expect(declaredExts.has(reqExt), `Extension .${reqExt} must be declared`).toBe(true)
    }
  })

  it('configures windows.nsis.installerHooks pointing to windows/installerHooks.nsh', () => {
    expect(tauriConf.bundle?.windows?.nsis?.installerHooks).toBe('windows/installerHooks.nsh')
    expect(existsSync(hooksPath)).toBe(true)
  })

  it('safe APP_ASSOCIATE macro overrides default behavior to avoid hijacking default handlers', () => {
    // Must undef and redefine APP_ASSOCIATE
    expect(hooksContent).toContain('!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND')
    expect(hooksContent).toContain('!macro APP_UNASSOCIATE EXT FILECLASS')

    // Must write to OpenWithProgids
    expect(hooksContent).toContain('Software\\Classes\\.${EXT}\\OpenWithProgids')

    // Must NOT write to Software\Classes\.${EXT} default value
    expect(hooksContent).not.toMatch(/WriteRegStr\s+SHCTX\s+"Software\\Classes\\\.\$\{EXT\}"\s+""/)
    expect(hooksContent).not.toMatch(/WriteRegStr\s+SHELL_CONTEXT\s+"Software\\Classes\\\.\$\{EXT\}"\s+""/)
  })

  it('NSIS_HOOK_POSTINSTALL registers Applications\\lightedit.exe and SupportedTypes for all 29 extensions', () => {
    expect(hooksContent).toContain('!macro NSIS_HOOK_POSTINSTALL')
    expect(hooksContent).toContain('Software\\Classes\\Applications\\${MAINBINARYNAME}.exe')
    expect(hooksContent).toContain('FriendlyAppName')
    expect(hooksContent).toContain('SupportedTypes')

    for (const ext of REQUIRED_EXTENSIONS) {
      expect(hooksContent).toContain(`!insertmacro LightEdit_RegisterExt "${ext}"`)
    }
  })

  it('NSIS_HOOK_POSTINSTALL registers Capabilities for Windows 10/11 Default Apps', () => {
    expect(hooksContent).toContain('Software\\LightEdit\\Capabilities')
    expect(hooksContent).toContain('ApplicationName')
    expect(hooksContent).toContain('ApplicationDescription')
    expect(hooksContent).toContain('Software\\RegisteredApplications')
    expect(hooksContent).toContain('"Software\\LightEdit\\Capabilities"')
  })

  it('NSIS_HOOK_POSTINSTALL registers SystemFileAssociations right-click menu with proper quotes', () => {
    // "使用 LightEdit 打开" in right-click context menu
    expect(hooksContent).toContain('"使用 LightEdit 打开"')
    expect(hooksContent).toContain('SystemFileAssociations\\text\\shell\\LightEdit')
    expect(hooksContent).toContain('SystemFileAssociations\\.${EXT}\\shell\\LightEdit')

    // Command must properly quote executable and parameter: '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
    expect(hooksContent).toContain('\'"$INSTDIR\\${MAINBINARYNAME}.exe" "%1"\'')

    // Shell Change Notification to refresh Explorer
    expect(hooksContent).toContain('Shell32::SHChangeNotify')
  })

  it('NSIS_HOOK_PREUNINSTALL cleans up only LightEdit keys and preserves other associations', () => {
    expect(hooksContent).toContain('!macro NSIS_HOOK_PREUNINSTALL')
    expect(hooksContent).toContain('DeleteRegValue SHCTX "Software\\RegisteredApplications" "${PRODUCTNAME}"')
    expect(hooksContent).toContain('DeleteRegKey SHCTX "Software\\LightEdit\\Capabilities"')
    expect(hooksContent).toContain('DeleteRegKey SHCTX "Software\\Classes\\Applications\\${MAINBINARYNAME}.exe"')
    expect(hooksContent).toContain('DeleteRegKey SHCTX "Software\\Classes\\SystemFileAssociations\\text\\shell\\LightEdit"')

    for (const ext of REQUIRED_EXTENSIONS) {
      expect(hooksContent).toContain(`!insertmacro LightEdit_UnregisterExt "${ext}"`)
    }

    // Must NOT delete generic extension keys like Software\Classes\.txt or UserChoice
    expect(hooksContent).not.toMatch(/DeleteRegKey\s+SHCTX\s+"Software\\Classes\\\.\$\{EXT\}"$/m)
    expect(hooksContent).not.toMatch(/UserChoice/)
  })
})
