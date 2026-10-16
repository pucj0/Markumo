import { describe, it, expect } from 'vitest'
import { defaultSettings, settingsFrom, persistedSettings } from '../src/features/shell/editorSettings'

describe('Tree Click Mode and Preferences', () => {
  it('defaults to double click mode for fleet-like behavior', () => {
    const settings = defaultSettings()
    expect(settings.treeClickMode).toBe('double')
  })

  it('persists and restores treeClickMode correctly', () => {
    const custom = settingsFrom({ treeClickMode: 'single' })
    expect(custom.treeClickMode).toBe('single')
    const persisted = persistedSettings(custom)
    expect(persisted.treeClickMode).toBe('single')

    const backToDouble = settingsFrom({ treeClickMode: 'double' })
    expect(backToDouble.treeClickMode).toBe('double')

    const fallback = settingsFrom({ treeClickMode: 'invalid' })
    expect(fallback.treeClickMode).toBe('double')
  })

  it('enforces exact schema contract between frontend persistedSettings and backend EditorSettings', () => {
    const persisted = persistedSettings(defaultSettings())
    const persistedKeys = Object.keys(persisted).sort()

    // 必须与 Rust `src-tauri/src/commands/settings.rs` 中 `EditorSettings` 的字段严格一一对应
    // Rust 启用了 #[serde(deny_unknown_fields)]，前端任何多出或缺失的字段都会导致整个设置保存失败
    const expectedRustContractKeys = [
      'theme',
      'uiFontSize',
      'fontSize',
      'fontFamily',
      'wordWrap',
      'showOutline',
      'indentSize',
      'useTabs',
      'defaultMdMode',
      'markdownTypography',
      'autoSave',
      'autoSaveDelay',
      'treeClickMode',
      'keymapPreset',
      'imageRules',
      'documentImageRules',
      'settingsVersion',
      'shortcutVersion',
      'customShortcuts',
      'shortcuts',
      'fileModes',
    ].sort()

    expect(persistedKeys).toEqual(expectedRustContractKeys)

    // 内部对象 markdownTypography 的字段也必须严格匹配
    const mdKeys = Object.keys(persisted.markdownTypography).sort()
    const expectedMdKeys = ['width', 'fontSize', 'fontFamily', 'lineHeight', 'codeLineNumbers', 'codeWrap', 'imageBorder'].sort()
    expect(mdKeys).toEqual(expectedMdKeys)

    // 内部对象 imageRules 的字段也必须严格匹配
    const imgKeys = Object.keys(persisted.imageRules).sort()
    const expectedImgKeys = ['location', 'customDirectory', 'relative', 'dotPrefix', 'escape'].sort()
    expect(imgKeys).toEqual(expectedImgKeys)
  })
})
