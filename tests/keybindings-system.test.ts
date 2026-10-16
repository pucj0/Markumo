import { describe, it, expect } from 'vitest'
import {
  eventToKeybinding,
  formatKeycaps,
  keybindingLabel,
  checkBindingConflict,
  areScopesMutuallyExclusive,
  keymapPresets,
  getPresetBindings,
  commandMap,
} from '../src/features/shell/keybindings'

describe('Keybinding System & Shortcut Recorder (Fleet + Typora)', () => {
  it('normalizes keyboard events and sorts modifier keys consistently', () => {
    // 模拟 Ctrl + Alt + P
    const event1 = {
      key: 'p',
      code: 'KeyP',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    } as KeyboardEvent
    expect(eventToKeybinding(event1, 'Win32')).toBe('Mod+Alt+P')

    // 模拟 Shift + Ctrl + P (应自动规范化为 Mod+Shift+P 顺序)
    const event2 = {
      key: 'P',
      code: 'KeyP',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    } as KeyboardEvent
    expect(eventToKeybinding(event2, 'Win32')).toBe('Mod+Shift+P')

    // 单纯按 Ctrl、Shift、Alt 键不形成有效快捷键
    const ctrlOnly = {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    } as KeyboardEvent
    expect(eventToKeybinding(ctrlOnly, 'Win32')).toBeNull()

    // 功能键 F1 ~ F12
    const f8Event = {
      key: 'F8',
      code: 'F8',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    } as KeyboardEvent
    expect(eventToKeybinding(f8Event, 'Win32')).toBe('F8')

    // 方向键
    const arrowDown = {
      key: 'ArrowDown',
      code: 'ArrowDown',
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    } as KeyboardEvent
    expect(eventToKeybinding(arrowDown, 'Win32')).toBe('Alt+ArrowDown')
  })

  it('formats keycaps beautifully and adapts to Windows vs macOS platforms', () => {
    // Windows 下 Mod 为 Ctrl
    expect(formatKeycaps('Mod+Shift+P', 'Win32')).toEqual(['Ctrl', 'Shift', 'P'])
    expect(keybindingLabel('Mod+Shift+P', 'Win32')).toBe('Ctrl + Shift + P')

    // macOS 下 Mod 为 ⌘, Shift 为 ⇧, Alt 为 ⌥
    expect(formatKeycaps('Mod+Shift+P', 'MacIntel')).toEqual(['⌘', '⇧', 'P'])
    expect(formatKeycaps('Mod+Alt+ArrowRight', 'MacIntel')).toEqual(['⌘', '⌥', '→'])

    expect(formatKeycaps('Alt+ArrowUp', 'Win32')).toEqual(['Alt', '↑'])
  })

  it('detects conflicts in same scope and allows co-existence across mutually exclusive scopes', () => {
    const currentBindings: Record<string, string> = {
      save: 'Mod+S',
      find: 'Mod+F',
      'heading-1': 'Mod+1', // scope: markdown-live
      'switch-pane': 'Mod+Alt+ArrowRight',
    }

    // 1. 同一作用域（editor）尝试把 'save-as' 绑定到已有的 'Mod+S' (已被 save 占用) -> 冲突！
    const conflict = checkBindingConflict('save-as', 'Mod+S', currentBindings)
    expect(conflict).not.toBeNull()
    expect(conflict?.conflictType).toBe('exact-same-scope')
    expect(conflict?.commandId).toBe('save')
    expect(conflict?.description).toContain('保存文件')

    // 2. 尝试绑定系统硬性保留键（Mod+C 复制） -> 冲突！
    const reservedConflict = checkBindingConflict('new', 'Mod+C', currentBindings)
    expect(reservedConflict).not.toBeNull()
    expect(reservedConflict?.conflictType).toBe('reserved-key')

    // 3. 互斥作用域共存测试：
    // scope 'markdown-live' 与 scope 'editor' 互斥，即使绑定键相同也不产生硬性冲突
    expect(areScopesMutuallyExclusive('markdown-live', 'editor')).toBe(true)
    expect(areScopesMutuallyExclusive('markdown-live', 'markdown-source')).toBe(true)
    expect(areScopesMutuallyExclusive('global', 'global')).toBe(false)
  })

  it('provides complete and valid official presets for LightEdit, Fleet, and Typora', () => {
    const presets = ['lightedit', 'fleet', 'typora'] as const
    for (const presetId of presets) {
      const preset = keymapPresets[presetId]
      expect(preset).toBeDefined()
      expect(preset.name).toBeDefined()
      expect(preset.description).toBeDefined()

      const bindings = getPresetBindings(presetId)
      expect(Object.keys(bindings).length).toBeGreaterThanOrEqual(20)

      // 验证预设中配置的所有命令 ID 都是合法存在的命令
      for (const cmdId of Object.keys(bindings)) {
        expect(commandMap.has(cmdId)).toBe(true)
      }
    }

    // 检查预设之间的差异化特征
    const lightEdit = getPresetBindings('lightedit')
    const fleet = getPresetBindings('fleet')
    const typora = getPresetBindings('typora')

    // Fleet: 快速打开为 Mod+Shift+N，删除行为 Mod+Y
    expect(fleet['quick-open']).toBe('Mod+Shift+N')
    expect(fleet['delete-line']).toBe('Mod+Y')

    // Typora: 转到行为 Mod+J，插入代码块为 Mod+Shift+K，一级标题为 Mod+1
    expect(typora['goto-line']).toBe('Mod+J')
    expect(typora['code-block']).toBe('Mod+Shift+K')
    expect(typora['heading-1']).toBe('Mod+1')

    // LightEdit: 保留常用习惯 (Ctrl+P 打开，Ctrl+Shift+P 面板，Ctrl+F 查找)
    expect(lightEdit['quick-open']).toBe('Mod+P')
    expect(lightEdit['palette']).toBe('Mod+Shift+P')
    expect(lightEdit.find).toBe('Mod+F')
  })
})
