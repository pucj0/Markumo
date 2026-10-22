/**
 * Safe Front Matter Parser and Incremental In-Place Updater.
 * Strictly avoids arbitrary object instantiation.
 */

export interface ParsedFrontMatter {
  valid: boolean
  error?: string
  raw: string
  title?: string
  tags: string[]
  created?: string
  updated?: string
  status?: string
  otherCount: number
  fields: Record<string, string | string[]>
}

/**
 * Safely parse front matter YAML scalars and simple lists without external unsafe evaluators
 */
export function parseFrontMatter(rawSource: string): ParsedFrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(rawSource.trim())
  if (!match) {
    return { valid: false, error: '非合法的前置元数据格式', raw: rawSource, tags: [], otherCount: 0, fields: {} }
  }

  const content = match[1]
  const lines = content.split(/\r?\n/)
  const fields: Record<string, string | string[]> = {}
  let currentKey: string | null = null
  let currentList: string[] | null = null

  try {
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip empty or comment lines
      if (!trimmed || trimmed.startsWith('#')) continue

      // List item belonging to currentKey: - item
      if (line.match(/^[ \t]+-\s+(.*)$/) || (trimmed.startsWith('- ') && currentKey)) {
        const itemVal = trimmed.replace(/^-\s+/, '').replace(/^["']|["']$/g, '').trim()
        if (currentKey) {
          if (!currentList) {
            currentList = []
            fields[currentKey] = currentList
          }
          currentList.push(itemVal)
        }
        continue
      }

      currentList = null
      const kv = line.match(/^([a-zA-Z0-9_-]+):(?:\s*(.*))?$/)
      if (kv) {
        currentKey = kv[1]
        let val = (kv[2] || '').trim()
        // Strip inline comments if any
        if (val.includes('#')) {
          val = val.split('#')[0].trim()
        }
        // Strip wrapping quotes
        val = val.replace(/^["']|["']$/g, '').trim()

        if (val.startsWith('[') && val.endsWith(']')) {
          // Flow list: [a, b, c]
          const list = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
          fields[currentKey] = list
        } else if (val) {
          fields[currentKey] = val
        }
      }
    }

    const title = typeof fields.title === 'string' ? fields.title : undefined
    const created = typeof fields.created === 'string' ? fields.created : typeof fields.date === 'string' ? fields.date : undefined
    const updated = typeof fields.updated === 'string' ? fields.updated : undefined
    const status = typeof fields.status === 'string' ? fields.status : undefined

    let tags: string[] = []
    if (Array.isArray(fields.tags)) {
      tags = fields.tags
    } else if (typeof fields.tags === 'string') {
      tags = fields.tags.split(/[\s,]+/).filter(Boolean)
    }

    const knownKeys = new Set(['title', 'tags', 'created', 'date', 'updated', 'status'])
    const otherCount = Object.keys(fields).filter(k => !knownKeys.has(k)).length

    return {
      valid: true,
      raw: rawSource,
      title,
      tags,
      created,
      updated,
      status,
      otherCount,
      fields,
    }
  } catch (err) {
    return {
      valid: false,
      error: String(err),
      raw: rawSource,
      tags: [],
      otherCount: 0,
      fields: {},
    }
  }
}

/**
 * Update a single scalar field in-place, perfectly preserving comments and unrelated fields
 */
export function updateFrontMatterField(rawSource: string, key: string, value: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(rawSource)
  if (!match) return rawSource

  const body = match[1]
  const lines = body.split(/\r?\n/)
  const isCRLF = rawSource.includes('\r\n')
  const newline = isCRLF ? '\r\n' : '\n'

  let found = false
  const updatedLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const kv = line.match(/^([a-zA-Z0-9_-]+):(?:\s*(.*))?$/)
    if (kv && kv[1] === key) {
      found = true
      updatedLines.push(`${key}: ${value}`)
    } else {
      updatedLines.push(line)
    }
  }

  if (!found) {
    updatedLines.push(`${key}: ${value}`)
  }

  const newBody = updatedLines.join(newline)
  return `---${newline}${newBody}${newline}---`
}
