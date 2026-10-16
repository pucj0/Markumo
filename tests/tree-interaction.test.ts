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
})
