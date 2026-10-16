import { languageRegistry, resolveLanguage } from './index'
import { fileIcons, type FileIconDefinition } from '../../features/shell/fileIcons'

export interface LanguageOption {
  id: string
  name: string
  aliases: readonly string[]
  label: string
  isCustom?: boolean
}

export function getFileIconDefForLanguage(lang: string): FileIconDefinition {
  const key = lang.trim().toLowerCase()
  if (['js', 'javascript', 'mjs', 'cjs'].includes(key)) return fileIcons.javascript
  if (['ts', 'typescript', 'mts', 'cts'].includes(key)) return fileIcons.typescript
  if (['jsx', 'react'].includes(key)) return fileIcons.react
  if (['tsx', 'react-ts'].includes(key)) return fileIcons.reactTs
  if (key === 'vue') return fileIcons.vue
  if (['html', 'htm'].includes(key)) return fileIcons.html
  if (key === 'css') return fileIcons.css
  if (['scss', 'sass', 'less'].includes(key)) return fileIcons.sass
  if (['py', 'python', 'python3'].includes(key)) return fileIcons.python
  if (['go', 'golang'].includes(key)) return fileIcons.go
  if (['rust', 'rs'].includes(key)) return fileIcons.rust
  if (key === 'java') return fileIcons.java
  if (key === 'c') return fileIcons.c
  if (['cpp', 'c++', 'cc', 'cxx'].includes(key)) return fileIcons.cpp
  if (['csharp', 'c#', 'cs'].includes(key)) return fileIcons.csharp
  if (['kotlin', 'kt'].includes(key)) return fileIcons.kotlin
  if (key === 'swift') return fileIcons.swift
  if (['php', 'phtml'].includes(key)) return fileIcons.php
  if (['ruby', 'rb'].includes(key)) return fileIcons.ruby
  if (['sh', 'bash', 'zsh', 'shell'].includes(key)) return fileIcons.shell
  if (['powershell', 'ps1', 'pwsh'].includes(key)) return fileIcons.powershell
  if (['sql', 'mysql', 'postgresql', 'pgsql', 'plsql'].includes(key)) return fileIcons.sql
  if (['json', 'jsonc'].includes(key)) return fileIcons.json
  if (['yaml', 'yml'].includes(key)) return fileIcons.yaml
  if (key === 'toml') return fileIcons.toml
  if (key === 'xml') return fileIcons.xml
  if (['md', 'markdown'].includes(key)) return fileIcons.markdown
  if (['batch', 'bat', 'cmd'].includes(key)) return fileIcons.batch
  if (['docker', 'dockerfile'].includes(key)) return fileIcons.docker
  if (key === 'diff') return fileIcons.text
  return fileIcons.unknown
}

export function createLanguageIconSvg(langKey: string): SVGSVGElement {
  const def = getFileIconDefForLanguage(langKey)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.classList.add('md-lang-icon', `file-icon-${def.tone}`)

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', '1')
  rect.setAttribute('y', '1')
  rect.setAttribute('width', '22')
  rect.setAttribute('height', '22')
  rect.setAttribute('rx', '5')
  rect.setAttribute('fill', 'currentColor')
  rect.setAttribute('opacity', '0.08')
  svg.append(rect)

  if (def.paths && def.paths.length > 0) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('stroke', 'currentColor')
    g.setAttribute('stroke-width', '1.6')
    g.setAttribute('stroke-linecap', 'round')
    g.setAttribute('stroke-linejoin', 'round')
    for (const p of def.paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', p)
      g.append(path)
    }
    svg.append(g)
  }

  if (def.monogram) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', def.id === 'go' ? '14' : '12')
    text.setAttribute('y', def.id === 'rust' ? '15.6' : '16.3')
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('fill', 'currentColor')
    text.setAttribute('font-size', def.monogram.length > 2 ? '8' : def.id === 'rust' ? '10' : '11')
    text.setAttribute('font-family', "Inter, 'Segoe UI', -apple-system, sans-serif")
    text.setAttribute('font-weight', '750')
    text.setAttribute('letter-spacing', '-.6')
    text.textContent = def.monogram
    svg.append(text)
  }

  return svg
}

export function getLanguageSuggestions(query: string, includeCustomFallback = false): LanguageOption[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    // 默认推荐常用语言
    const commonIds = [
      'javascript', 'typescript', 'python', 'java', 'html', 'css',
      'c', 'cpp', 'csharp', 'go', 'rust', 'sql', 'shell', 'json', 'markdown', 'php', 'ruby'
    ]
    const results: LanguageOption[] = []
    for (const id of commonIds) {
      const lang = languageRegistry.find(l => l.id === id)
      if (lang) {
        results.push({ id: lang.id, name: lang.name, aliases: lang.aliases, label: lang.name })
      }
    }
    return results
  }

  const scored: { option: LanguageOption; score: number }[] = []

  for (const lang of languageRegistry) {
    const id = lang.id.toLowerCase()
    const name = lang.name.toLowerCase()
    const aliases = lang.aliases.map(a => a.toLowerCase())
    let score = -1

    if (id === q || name === q || aliases.includes(q)) {
      score = 100 // 精确匹配优先
    } else if (name.startsWith(q)) {
      score = 80 // 名称前缀匹配
    } else if (id.startsWith(q)) {
      score = 75 // ID前缀匹配
    } else if (aliases.some(a => a.startsWith(q))) {
      score = 70 // 别名前缀匹配
    } else if (name.includes(q)) {
      score = 50 // 名称包含匹配
    } else if (id.includes(q)) {
      score = 45 // ID包含匹配
    } else if (aliases.some(a => a.includes(q))) {
      score = 40 // 别名包含匹配
    }

    if (score > 0) {
      scored.push({
        score,
        option: {
          id: lang.id,
          name: lang.name,
          aliases: lang.aliases,
          label: lang.name,
        }
      })
    }
  }

  // 排序：score 降序，名称升序
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.option.name.localeCompare(b.option.name)
  })

  const results = scored.map(s => s.option)

  // 如果需要并且未精确匹配，添加自定义/未注册语言选项
  if (includeCustomFallback && q && !resolveLanguage(q) && !/[\s`~]/.test(q)) {
    results.push({
      id: q,
      name: q,
      aliases: [],
      label: `${q}（未注册，纯文本）`,
      isCustom: true,
    })
  }

  return results
}
