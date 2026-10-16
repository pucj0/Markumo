export function isMacPlatform(platform = globalThis.navigator?.platform || ''): boolean {
  return /Mac|iPhone|iPad/i.test(platform)
}

/**
 * 规范化按键格式（内部存储统一使用 Mod+Alt+Shift+Key 顺序）
 */
export function normalizeKeybinding(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  const parts = raw.trim().split('+')
  const key = parts.pop() || ''
  if (!key) return null

  const mods = ['Mod', 'Alt', 'Shift'].filter(mod =>
    parts.some(p => p.toLowerCase() === mod.toLowerCase())
  )

  // 校验修饰键合法性
  if (parts.length !== mods.length || parts.some(p => !['mod', 'alt', 'shift', 'ctrl', 'meta', 'cmd'].includes(p.toLowerCase()))) {
    return null
  }

  // 规范化 Key 名称
  let normalizedKey = key
  if (key.length === 1) {
    normalizedKey = key.toUpperCase()
  } else if (/^f([1-9]|1[0-2])$/i.test(key)) {
    normalizedKey = key.toUpperCase()
  } else if (/^arrow(up|down|left|right)$/i.test(key)) {
    normalizedKey = 'Arrow' + key.slice(5).charAt(0).toUpperCase() + key.slice(6).toLowerCase()
  } else if (/^(enter|escape|tab|space|backspace|delete|home|end|pageup|pagedown|insert)$/i.test(key)) {
    normalizedKey = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
  } else if (key === '=' || key === '+') {
    normalizedKey = '='
  } else if (key === '-' || key === '_') {
    normalizedKey = '-'
  } else if (key === '`' || key === '~') {
    normalizedKey = '`'
  } else if (key === '\\' || key === '|') {
    normalizedKey = '\\'
  } else if (key === '/' || key === '?') {
    normalizedKey = '/'
  } else if (key === '[' || key === '{') {
    normalizedKey = '['
  } else if (key === ']' || key === '}') {
    normalizedKey = ']'
  } else {
    normalizedKey = key.toUpperCase()
  }

  if (!normalizedKey) return null
  return [...mods, normalizedKey].join('+')
}

/**
 * 从键盘事件解析并生成规范化快捷键字符串
 */
export function eventToKeybinding(event: KeyboardEvent, platform?: string): string | null {
  // 如果是纯修饰键按下，不构成有效快捷键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return null
  }

  const isMac = isMacPlatform(platform)
  const isMod = isMac ? event.metaKey : event.ctrlKey
  const isAlt = event.altKey
  const isShift = event.shiftKey

  // 获取主要按键
  let key = event.key

  // 针对特定数字键与符号键对齐
  if (event.altKey && /^Digit[0-9]$/.test(event.code)) {
    key = event.code.slice(-1)
  } else if (key === '+' || (event.code === 'Equal' && isShift)) {
    key = '='
  } else if (key === '_' || (event.code === 'Minus' && isShift)) {
    key = '-'
  } else if (key === '|' || (event.code === 'Backslash' && isShift)) {
    key = '\\'
  } else if (key === '?' || (event.code === 'Slash' && isShift)) {
    key = '/'
  } else if (key === '~' || (event.code === 'Backquote' && isShift)) {
    key = '`'
  } else if (key === '{' || (event.code === 'BracketLeft' && isShift)) {
    key = '['
  } else if (key === '}' || (event.code === 'BracketRight' && isShift)) {
    key = ']'
  }

  const normalized = normalizeKeybinding(
    [isMod ? 'Mod' : '', isAlt ? 'Alt' : '', isShift ? 'Shift' : '', key].filter(Boolean).join('+')
  )

  return normalized
}

/**
 * 格式化为给用户展示的独立键帽数组（Keycap）
 * 例如 'Mod+Shift+P' 在 Windows 下输出 ['Ctrl', 'Shift', 'P']
 */
export function formatKeycaps(binding: string, platform?: string): string[] {
  if (!binding) return []
  const isMac = isMacPlatform(platform)
  const parts = binding.split('+')
  return parts.map(part => {
    switch (part) {
      case 'Mod':
        return isMac ? '⌘' : 'Ctrl'
      case 'Alt':
        return isMac ? '⌥' : 'Alt'
      case 'Shift':
        return isMac ? '⇧' : 'Shift'
      case 'ArrowUp':
        return '↑'
      case 'ArrowDown':
        return '↓'
      case 'ArrowLeft':
        return '←'
      case 'ArrowRight':
        return '→'
      case 'Enter':
        return 'Enter'
      case 'Escape':
        return 'Esc'
      case 'Backspace':
        return 'Backspace'
      case 'Delete':
        return 'Del'
      case 'Tab':
        return 'Tab'
      case 'Space':
        return 'Space'
      default:
        return part
    }
  })
}

/**
 * 格式化为单行文本标签
 */
export function keybindingLabel(binding: string, platform?: string): string {
  const caps = formatKeycaps(binding, platform)
  return caps.join(' + ')
}
