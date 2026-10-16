import { describe, it, expect } from 'vitest'
import { getLanguageSuggestions, getFileIconDefForLanguage } from '../src/editor/languages/suggestions'
import { parseFenceInfo } from '../src/editor/languages'
import { parseMarkdown } from '../src/editor/markdown/wysiwyg/MarkdownParser'

describe('Markdown Code Block & Fence Suggestions (Vitest Suite)', () => {
  it('searches languages with prefix priority and case-insensitivity (including ja -> jade, java, javascript)', () => {
    const results = getLanguageSuggestions('ja')
    const ids = results.map(r => r.id.toLowerCase())
    expect(ids).toContain('jade')
    expect(ids).toContain('java')
    expect(ids).toContain('javascript')

    // 验证前缀/精确优先于非前缀
    const names = results.map(r => r.name.toLowerCase())
    const javaIndex = names.indexOf('java')
    expect(javaIndex).toBeGreaterThanOrEqual(0)

    // 大小写不敏感测试
    const upperResults = getLanguageSuggestions('JAVA')
    expect(upperResults[0].id).toBe('java')
  })

  it('provides icon definitions for common languages and neutral icon for unknown language', () => {
    const targetLangs = [
      'java', 'javascript', 'typescript', 'python', 'go', 'rust',
      'c', 'cpp', 'csharp', 'html', 'css', 'json', 'vue',
      'shell', 'powershell', 'sql', 'php', 'ruby', 'kotlin', 'markdown'
    ]
    for (const lang of targetLangs) {
      const def = getFileIconDefForLanguage(lang)
      expect(def).toBeDefined()
      expect(def.id).not.toBe('unknown')
      expect(def.tone).toBeDefined()
    }

    const unknownDef = getFileIconDefForLanguage('customlang123')
    expect(unknownDef.id).toBe('unknown')
  })

  it('recognizes unregistered languages in parseFenceInfo without throwing', () => {
    const parsed = parseFenceInfo('customlang')
    expect(parsed.label).toBe('customlang')
    expect(parsed.language).toBeUndefined()

    const empty = parseFenceInfo('')
    expect(empty.label).toBe('')
    expect(empty.language).toBeUndefined()

    const java = parseFenceInfo('java')
    expect(java.label).toBe('java')
    expect(java.language?.name).toBe('Java')

    const bash = parseFenceInfo('bash')
    expect(bash.label).toBe('bash')
    expect(bash.language?.name).toBe('Shell')
  })

  it('supports custom language fallback in getLanguageSuggestions when requested', () => {
    const fallbackList = getLanguageSuggestions('customlang', true)
    const customItem = fallbackList.find(item => item.id === 'customlang')
    expect(customItem).toBeDefined()
    expect(customItem?.isCustom).toBe(true)
    expect(customItem?.label).toContain('未注册')
  })

  it('fence regex matches 3 backticks with language without requiring trailing space', () => {
    const fencePattern = /^(`{3,}|~{3,})([^`~\s]*)[ \t]*$/
    expect(fencePattern.test('```')).toBe(true)
    expect(fencePattern.test('```javascript')).toBe(true)
    expect(fencePattern.test('```bash')).toBe(true)
    expect(fencePattern.test('```customlang')).toBe(true)
    expect(fencePattern.test('~~~~python')).toBe(true)

    const match = fencePattern.exec('```java')
    expect(match?.[1]).toBe('```')
    expect(match?.[2]).toBe('java')
  })

  it('parses code_block with exact params and fence from markdown', () => {
    const doc = parseMarkdown('```javascript\nconsole.log(1)\n```').doc
    expect(doc.firstChild?.type.name).toBe('code_block')
    expect(doc.firstChild?.attrs.params).toBe('javascript')

    const customDoc = parseMarkdown('```customlang\nhello\n```').doc
    expect(customDoc.firstChild?.type.name).toBe('code_block')
    expect(customDoc.firstChild?.attrs.params).toBe('customlang')
  })
})
