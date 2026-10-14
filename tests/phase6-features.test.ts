import { describe, it, expect } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { extractOutline } from '../src/editor/outline/outlineService'
import { undo } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { defaultSettings, settingsFrom, validateShortcuts, normalizeShortcut, relativeFilePath } from '../src/features/shell/editorSettings'

describe('Editor Advanced Features, Split Panes & Efficiency (Phase 6)', () => {
  it('splits pane and synchronizes edits on the same document without cursor or selection conflict', () => {
    const text = `Line 1: initial text\nLine 2: content`
    const manager = new DocumentManager([
      { id: 'doc-1', name: 'sample.txt', path: 'sample.txt', text },
    ])
    manager.open('doc-1', false)

    // 1. 开启双 Pane 分栏
    expect(manager.isSplit).toBe(false)
    expect(manager.splitEditor()).toBe(true)
    expect(manager.isSplit).toBe(true)
    expect(manager.secondaryGroup.activeId).toBe('doc-1')

    // 2. 在主 Pane 派发修改并设置光标在第 5 个字符
    manager.dispatch('doc-1', {
      changes: { from: 0, insert: 'MODIFIED: ' },
      selection: { anchor: 5 },
    })

    // 验证底层文本完全同步
    expect(manager.getText('doc-1')).toBe(`MODIFIED: Line 1: initial text\nLine 2: content`)

    // 3. 关闭分栏
    manager.closeSplit()
    expect(manager.isSplit).toBe(false)
    expect(manager.secondaryGroup.activeId).toBeNull()
    expect(manager.getText('doc-1')).toBe(`MODIFIED: Line 1: initial text\nLine 2: content`)

    manager.dispose()
  })

  it('extracts outline accurately from loaded Markdown and code ASTs', async () => {
    // 1. 测试 Markdown 大纲提取
    const mdText = `# Project Title
Introductory paragraph.
## Architecture Overview
Details here.
### Component Details
Sub details.
# Conclusion
`
    const manager = new DocumentManager([
      { id: 'md-doc', name: 'doc.md', path: 'doc.md', text: mdText },
      { id: 'ts-doc', name: 'service.ts', path: 'service.ts', text: 'export class AuthService {}\nexport function login() {}' },
      { id: 'txt-doc', name: 'plain.txt', path: 'plain.txt', text: 'just some plain text without symbols' },
    ])
    manager.open('md-doc', false)
    manager.open('ts-doc', false)
    manager.open('txt-doc', false)
    await manager.setLanguage('md-doc', 'Markdown')
    await manager.setLanguage('ts-doc', 'TypeScript')
    await manager.setLanguage('txt-doc', 'Plain Text')
    ensureSyntaxTree(manager.getState('ts-doc')!, manager.getState('ts-doc')!.doc.length, 1000)
    manager.dispatch('ts-doc', {})

    // Markdown 大纲提取
    const mdOutline = extractOutline(manager.metadata('md-doc')!, manager.getState('md-doc')!)
    expect(mdOutline.length).toBe(4)
    expect(mdOutline[0].name).toBe('Project Title')
    expect(mdOutline[0].level).toBe(1)
    expect(mdOutline[0].lineNumber).toBe(1)
    expect(mdOutline[1].name).toBe('Architecture Overview')
    expect(mdOutline[1].level).toBe(2)
    expect(mdOutline[2].name).toBe('Component Details')
    expect(mdOutline[2].level).toBe(3)
    expect(mdOutline[3].name).toBe('Conclusion')
    expect(mdOutline[3].level).toBe(1)

    // TypeScript 符号大纲提取
    const tsOutline = extractOutline(manager.metadata('ts-doc')!, manager.getState('ts-doc')!)
    expect(tsOutline.length).toBeGreaterThan(0)
    expect(tsOutline.some(i => i.name.includes('AuthService') || i.name.includes('login'))).toBe(true)

    // 纯文本退化无大纲
    const txtOutline = extractOutline(manager.metadata('txt-doc')!, manager.getState('txt-doc')!)
    expect(txtOutline.length).toBe(0)

    manager.dispose()
  })

  it('performs single file replace-all with regex, whole-word and case sensitivity and undoes cleanly in one step', () => {
    const text = `apple Apple pineapple APPLE apple_pie`
    const manager = new DocumentManager([
      { id: 'replace-doc', name: 'test.txt', path: 'test.txt', text },
    ])
    manager.open('replace-doc', false)

    const id = 'replace-doc'

    // 1. 全词匹配 + 大小写敏感替换：只替换两个小写的 "apple"
    const replacedCount = manager.replaceAll(id, 'apple', 'orange', {
      caseSensitive: true,
      wholeWord: true,
      regex: false,
    })
    expect(replacedCount).toBe(1) // 只有单独的 apple，pineapple 和 apple_pie 不是全词
    expect(manager.getText(id)).toBe(`orange Apple pineapple APPLE apple_pie`)

    // 撤销该次全部替换
    undo({
      state: manager.getState(id)!,
      dispatch: tr => manager.dispatch(id, tr),
    })
    expect(manager.getText(id)).toBe(text)

    // 2. 正则表达式替换
    const regexReplaced = manager.replaceAll(id, 'A\\w+', 'FRUIT', {
      regex: true,
      caseSensitive: true,
    })
    expect(regexReplaced).toBe(2) // 匹配 Apple 和 APPLE
    expect(manager.getText(id)).toBe(`apple FRUIT pineapple FRUIT apple_pie`)

    // 一步整体撤销正则替换
    undo({
      state: manager.getState(id)!,
      dispatch: tr => manager.dispatch(id, tr),
    })
    expect(manager.getText(id)).toBe(text)

    manager.dispose()
  })

  it('navigates to line and column accurately using gotoLine', () => {
    const text = `Line 1\nLine 2\nLine 3 with target column\nLine 4`
    const manager = new DocumentManager([
      { id: 'goto-doc', name: 'file.txt', path: 'file.txt', text },
    ])
    manager.open('goto-doc', false)

    // 跳转到第 3 行第 6 列
    manager.gotoLine('goto-doc', 3, 6)
    expect(manager.metadata('goto-doc')?.line).toBe(3)
    expect(manager.metadata('goto-doc')?.column).toBe(6)

    // 超出行范围时自动安全截断到末行
    manager.gotoLine('goto-doc', 999, 1)
    expect(manager.metadata('goto-doc')?.line).toBe(4)

    manager.dispose()
  })

  it('terminates zero-width regex matches, expands groups, preserves literal replacement and rejects invalid regex', () => {
    const manager = new DocumentManager([{id:'r',name:'r.txt',path:'',text:'ab\nab'}]);manager.open('r',false)
    expect(manager.replaceAll('r','^','>',{regex:true})).toBe(2)
    expect(manager.getText('r')).toBe('>ab\n>ab');manager.command('undo')
    expect(manager.replaceAll('r','(a)(b)','$2$1-$&-$$-$12-$0',{regex:true})).toBe(2)
    expect(manager.getText('r')).toBe('ba-ab-$-a2-$0\nba-ab-$-a2-$0');manager.command('undo')
    expect(manager.replaceAll('r','[','bad',{regex:true})).toBe(0)
    expect(manager.getText('r')).toBe('ab\nab')
    expect(manager.replaceAll('r','ab','$1')).toBe(2);expect(manager.getText('r')).toBe('$1\n$1');manager.dispose()
  })
  it('uses AST headings including Setext and never invents headings/symbols in fences or strings', async () => {
    const manager=new DocumentManager([{id:'md',name:'outline.md',path:'',text:'Title\n=====\n\n```md\n# fake\n```\n\n## Real ##\n'},{id:'ts',name:'file.ts',path:'',text:'/*\nfunction fake() {}\n*/\nconst text="class Fake {}";\nexport class Real {}\nexport function real() {}'},{id:'unknown',name:'script.unknown',path:'',text:'class Fake {}'}])
    manager.open('md',false);manager.open('ts',false);manager.open('unknown',false)
    await manager.setLanguage('md','Markdown');await manager.setLanguage('ts','TypeScript');await manager.setLanguage('unknown','Plain Text')
    for(const id of ['md','ts']) {ensureSyntaxTree(manager.getState(id)!,manager.getState(id)!.doc.length,1000);manager.dispatch(id,{})}
    expect(extractOutline(manager.metadata('md'),manager.getState('md')).map(i=>i.name)).toEqual(['Title','Real'])
    expect(extractOutline(manager.metadata('ts'),manager.getState('ts')).map(i=>i.name)).toEqual(['Real','real'])
    expect(extractOutline(manager.metadata('unknown'),manager.getState('unknown'))).toEqual([])
    const items=extractOutline(manager.metadata('ts'),manager.getState('ts'));manager.gotoLine('ts',1)
    expect(extractOutline(manager.metadata('ts'),manager.getState('ts'))).toBe(items)
    manager.dispose()
  })
  it('keeps a shared dirty document until its last tab closes and retains secondary-only documents on collapse', () => {
    const manager=new DocumentManager([{id:'a',name:'a.txt',path:'',text:'a'},{id:'b',name:'b.txt',path:'',text:'b'}]);manager.open('a',false);manager.splitEditor()
    manager.dispatch('a',{changes:{from:0,insert:'edit'}})
    expect(manager.close('a',false,'main')).toBe('closed');expect(manager.getText('a')).toBe('edita')
    expect(manager.close('a',false,'secondary')).toBe('dirty')
    manager.open('b',false,'secondary');manager.dispatch('b',{changes:{from:0,insert:'B'}});manager.closeSplit()
    expect(manager.mainOpenedDocuments.map(d=>d.id)).toEqual(['a','b']);expect(manager.getText('b')).toBe('Bb')
    manager.dispose()
  })
  it('validates settings, rejects shortcut collisions and respects path boundaries', () => {
    const defaults=defaultSettings()
    expect(validateShortcuts(defaults.shortcuts)).toBeNull()
    expect(validateShortcuts({...defaults.shortcuts,save:defaults.shortcuts.open})).toContain('重复')
    expect(validateShortcuts({...defaults.shortcuts,save:'Mod+C'})).toContain('保留')
    expect(normalizeShortcut('shift+mod+p')).toBe('Mod+Shift+P')
    expect(settingsFrom({fontSize:999,indentSize:0,theme:'evil'})).toEqual(defaults)
    expect(relativeFilePath('E:\\root-extra\\a.txt','E:\\root')).toBe('E:\\root-extra\\a.txt')
    expect(relativeFilePath('E:\\ROOT\\sub\\a.txt','e:\\root')).toBe('sub/a.txt')
  })
  it('loads legacy explicit themes and retains the system preference through settings serialization', () => {
    for (const theme of ['dark', 'light', 'system']) {
      const settings = settingsFrom({ theme, fontSize: 17 })
      expect(settingsFrom(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
      expect(settings.theme).toBe(theme)
    }
    expect(defaultSettings().theme).toBe('system')
  })
})
