import { describe, it, expect } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'

describe('Fleet Multi-Pane & Independent Markdown Mode (Phase B & C)', () => {
  it('supports opening the same document in multiple panes with independent markdown modes', () => {
    const manager = new DocumentManager([
      { id: 'readme', name: 'README.md', path: 'README.md', text: '# Title\n\nContent' },
    ])
    manager.open('readme', false, 'main')
    expect(manager.getMarkdownMode('readme', 'main')).toBe('live')

    // 1. 在右侧拆分打开副本
    const pane2 = manager.splitPane('right', 'main', 'readme')
    expect(manager.layout.getAllLeafIds()).toEqual(['main', pane2])

    // 新 Pane 初始继承源 Pane 模式
    expect(manager.getMarkdownMode('readme', pane2)).toBe('live')

    // 2. 将右侧 Pane 切换为 source 模式，左侧 Pane 仍保持 live 模式！
    manager.setMarkdownMode('readme', 'source', pane2)
    expect(manager.getMarkdownMode('readme', pane2)).toBe('source')
    expect(manager.getMarkdownMode('readme', 'main')).toBe('live')

    // 3. 将左侧 Pane 切换为 split 模式，右侧 Pane 仍保持 source 模式！
    manager.setMarkdownMode('readme', 'split', 'main')
    expect(manager.getMarkdownMode('readme', 'main')).toBe('split')
    expect(manager.getMarkdownMode('readme', pane2)).toBe('source')

    // 4. 内容修改双向实时同步
    manager.focusPane(pane2)
    manager.dispatch('readme', { changes: { from: 7, insert: ' Updated' } })
    expect(manager.getText('readme')).toBe('# Title Updated\n\nContent')

    // 两个 Pane 看到的 dirty 状态统一
    expect(manager.metadata('readme')?.dirty).toBe(true)

    // 5. 关闭其中一个 Pane 的视图，不销毁文档，也不报错
    expect(manager.close('readme', false, 'main')).toBe('closed')
    // 文档依然存在于 pane2 中
    expect(manager.getState('readme')).toBeDefined()
    expect(manager.getText('readme')).toBe('# Title Updated\n\nContent')

    // 6. 最后一个引用关闭时，有未保存修改，正确触发 dirty 保护
    expect(manager.close('readme', false, pane2)).toBe('dirty')

    manager.dispose()
  })

  it('automatically recycles empty pane when moving the last tab out', () => {
    const manager = new DocumentManager([
      { id: 'doc1', name: 'doc1.txt', path: '', text: '1' },
      { id: 'doc2', name: 'doc2.txt', path: '', text: '2' },
    ])
    manager.open('doc1', false, 'main')
    const pane2 = manager.splitPane('right', 'main', 'doc2')
    expect(manager.layout.getAllLeafIds()).toEqual(['main', pane2])

    // 将 doc2 从 pane2 移回 main
    manager.moveTab('doc2', pane2, 'main')

    // pane2 变空，应自动被回收，恢复为单 Pane
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])
    expect(manager.isSplit).toBe(false)

    manager.dispose()
  })

  it('correctly handles non-markdown files (no markdown mode)', () => {
    const manager = new DocumentManager([
      { id: 'code', name: 'Main.java', path: '', text: 'class Main {}' },
    ])
    manager.open('code', false, 'main')
    expect(manager.metadata('code')?.mode).toBeUndefined()
    // 对 Java 文件调用 setMarkdownMode 应安全返回 false
    expect(manager.setMarkdownMode('code', 'source', 'main')).toBe(false)
    manager.dispose()
  })
})
