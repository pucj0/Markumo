import type { ConversionSettings, LastExportRecord } from './contracts'

const SETTINGS_KEY = 'markumo-conversion-settings-v1'
const LAST_EXPORT_KEY = 'markumo-last-export-v1'

const memoryStore = new Map<string, string>()

function getStorageItem(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key)
    } catch {
      return memoryStore.get(key) || null
    }
  }
  return memoryStore.get(key) || null
}

function setStorageItem(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, val)
      return
    } catch {
      memoryStore.set(key, val)
      return
    }
  }
  memoryStore.set(key, val)
}

export function defaultConversionSettings(): ConversionSettings {
  return {
    askSaveLocation: true,
    embedImagesAsDataUri: true,
    pdf: {
      paperSize: 'A4',
      orientation: 'portrait',
      margins: 'default',
      printBackground: true,
      codeWrap: true,
    },
    html: {
      includeStyles: true,
      embedImages: true,
    },
    png: {
      width: 860,
      scale: 2,
      backgroundColor: '#ffffff',
    },
  }
}

export function loadConversionSettings(): ConversionSettings {
  try {
    const raw = getStorageItem(SETTINGS_KEY)
    if (!raw) return defaultConversionSettings()
    const parsed = JSON.parse(raw)
    const defaults = defaultConversionSettings()
    return {
      ...defaults,
      ...parsed,
      pdf: { ...defaults.pdf, ...(parsed.pdf || {}) },
      html: { ...defaults.html, ...(parsed.html || {}) },
      png: { ...defaults.png, ...(parsed.png || {}) },
    }
  } catch {
    return defaultConversionSettings()
  }
}

export function saveConversionSettings(settings: ConversionSettings): void {
  try {
    setStorageItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save conversion settings:', e)
  }
}

export function loadLastExport(): LastExportRecord | null {
  try {
    const raw = getStorageItem(LAST_EXPORT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !['html', 'html-plain', 'png', 'pdf', 'docx'].includes(parsed.format)) return null
    // History holds UI defaults only. Native capabilities are never restored.
    return { format: parsed.format, targetPath: typeof parsed.targetPath === 'string' ? parsed.targetPath : undefined,
      options: parsed.options && typeof parsed.options === 'object' ? parsed.options : {}, timestamp: Number(parsed.timestamp) || 0 }
  } catch {
    return null
  }
}

export function saveLastExport(record: LastExportRecord): void {
  try {
    const { format, targetPath, options, timestamp } = record
    setStorageItem(LAST_EXPORT_KEY, JSON.stringify({ format, targetPath, options, timestamp }))
  } catch (e) {
    console.error('Failed to save last export record:', e)
  }
}
