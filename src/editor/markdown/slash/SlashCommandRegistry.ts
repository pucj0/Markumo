export type SlashCommandCategory = '文本与标题' | '列表与引用' | '插入内容' | '高级组件'

export interface SlashCommandContext {
  mode: 'live' | 'source'
  inTable?: boolean
  inCodeBlock?: boolean
  readOnly?: boolean
  hasYaml?: boolean
  from: number
  to: number
  query: string
  liveEditor?: any
  sourceView?: any
  openTablePicker?: (anchorCoords: { left: number; bottom: number; top: number }, onSelect: (rows: number, cols: number) => void) => void
}

export interface SlashCommand {
  id: string
  label: string
  description: string
  icon: string
  category: SlashCommandCategory
  keywords: string[]
  aliases: string[]
  isAvailable: (context: SlashCommandContext) => boolean
  execute: (context: SlashCommandContext) => boolean | void
}

export const SLASH_CATEGORIES: SlashCommandCategory[] = [
  '文本与标题',
  '列表与引用',
  '插入内容',
  '高级组件',
]

export const SLASH_COMMANDS: SlashCommand[] = [
  // 文本与标题
  {
    id: 'heading-0',
    label: '正文',
    description: '普通段落文本',
    icon: 'paragraph',
    category: '文本与标题',
    keywords: ['paragraph', 'text', 'zhengwen', 'zw', 'putong', 'pt', 'p', '0'],
    aliases: ['p', 'normal', '0'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-0', ctx),
  },
  {
    id: 'heading-1',
    label: '一级标题',
    description: '最高层级大标题',
    icon: 'heading',
    category: '文本与标题',
    keywords: ['h1', 'heading1', 'yijibiaoti', 'yjbt', 'bt1', 'dabiaoti', '1'],
    aliases: ['h1', '1'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-1', ctx),
  },
  {
    id: 'heading-2',
    label: '二级标题',
    description: '章节中标题',
    icon: 'heading',
    category: '文本与标题',
    keywords: ['h2', 'heading2', 'erjibiaoti', 'ejbt', 'bt2', 'zhongbiaoti', '2'],
    aliases: ['h2', '2'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-2', ctx),
  },
  {
    id: 'heading-3',
    label: '三级标题',
    description: '子章节小标题',
    icon: 'heading',
    category: '文本与标题',
    keywords: ['h3', 'heading3', 'sanjibiaoti', 'sjbt', 'bt3', 'xiaobiaoti', '3'],
    aliases: ['h3', '3'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-3', ctx),
  },
  {
    id: 'heading-4',
    label: '四级标题',
    description: '四级标题',
    icon: 'heading',
    category: '文本与标题',
    keywords: ['h4', 'heading4', 'sijibiaoti', 'sijbt', 'bt4', '4'],
    aliases: ['h4', '4'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-4', ctx),
  },
  {
    id: 'heading-5',
    label: '五级标题',
    description: '五级标题',
    icon: 'heading',
    category: '文本与标题',
    keywords: ['h5', 'heading5', 'wujibiaoti', 'wjbt', 'bt5', '5'],
    aliases: ['h5', '5'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-5', ctx),
  },
  {
    id: 'heading-6',
    label: '六级标题',
    description: '六级标题',
    icon: 'heading',
    category: '文本与标题',
    keywords: ['h6', 'heading6', 'liujibiaoti', 'ljbt', 'bt6', '6'],
    aliases: ['h6', '6'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('heading-6', ctx),
  },

  // 列表与引用
  {
    id: 'bullet',
    label: '无序列表',
    description: '创建圆点项目符号列表',
    icon: 'list-bullet',
    category: '列表与引用',
    keywords: ['bullet', 'list', 'ul', 'wuxuliebiao', 'wxlb', 'lb', 'liebiao'],
    aliases: ['list', 'ul', 'bullet'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('bullet', ctx),
  },
  {
    id: 'ordered',
    label: '有序列表',
    description: '创建数字编号列表',
    icon: 'list-ordered',
    category: '列表与引用',
    keywords: ['ordered', 'number', 'ol', 'youxuliebiao', 'yxlb', 'shuziliebiao'],
    aliases: ['ol', 'ordered', 'num'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('ordered', ctx),
  },
  {
    id: 'task',
    label: '任务列表',
    description: '带复选框的待办事项列表',
    icon: 'list-task',
    category: '列表与引用',
    keywords: ['task', 'todo', 'checklist', 'renwuliebiao', 'rwlb', 'daiban', 'db'],
    aliases: ['todo', 'task', 'check'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('task', ctx),
  },
  {
    id: 'quote',
    label: '引用',
    description: '插入段落引用块',
    icon: 'quote',
    category: '列表与引用',
    keywords: ['quote', 'blockquote', 'yinyong', 'yy'],
    aliases: ['quote', 'bq'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('quote', ctx),
  },

  // 插入内容
  {
    id: 'table',
    label: '表格',
    description: '插入自定义行列的表格',
    icon: 'table',
    category: '插入内容',
    keywords: ['table', 'grid', 'sheet', 'biaoge', 'bg'],
    aliases: ['table', 'biaoge', 'grid', 'bg'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('table', ctx),
  },
  {
    id: 'code-block',
    label: '代码块',
    description: '语法高亮代码块',
    icon: 'code-block',
    category: '插入内容',
    keywords: ['code', 'codeblock', 'fence', 'daima', 'daimakuai', 'dm', 'dmk'],
    aliases: ['code', 'daima'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('code-block', ctx),
  },
  {
    id: 'image',
    label: '图片',
    description: '插入图片描述与链接',
    icon: 'image',
    category: '插入内容',
    keywords: ['image', 'picture', 'photo', 'img', 'tupian', 'tp'],
    aliases: ['image', 'img', 'pic'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('image', ctx),
  },
  {
    id: 'link',
    label: '链接',
    description: '插入超链接',
    icon: 'link',
    category: '插入内容',
    keywords: ['link', 'url', 'href', 'lianjie', 'lj'],
    aliases: ['link', 'url'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('link', ctx),
  },
  {
    id: 'rule',
    label: '水平分割线',
    description: '插入页面分隔水平线',
    icon: 'rule',
    category: '插入内容',
    keywords: ['rule', 'divider', 'hr', 'line', 'shuipingfengexian', 'fengexian', 'fgx'],
    aliases: ['hr', 'rule', 'line', 'divider'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('rule', ctx),
  },

  // 高级组件
  {
    id: 'math',
    label: '公式块',
    description: 'LaTeX 数学公式块',
    icon: 'sigma',
    category: '高级组件',
    keywords: ['math', 'latex', 'katex', 'formula', 'gongshi', 'gongshikuai', 'gs'],
    aliases: ['math', 'latex', 'gongshi'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('math', ctx),
  },
  {
    id: 'mermaid',
    label: 'Mermaid 图表',
    description: '流程图、时序图与架构图',
    icon: 'mermaid',
    category: '高级组件',
    keywords: ['mermaid', 'diagram', 'flowchart', 'tubiao', 'liuchengtu', 'lct', 'tb'],
    aliases: ['mermaid', 'diagram', 'chart', 'flowchart'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('mermaid', ctx),
  },
  {
    id: 'toc',
    label: '内容目录',
    description: '基于标题自动生成目录',
    icon: 'outline',
    category: '高级组件',
    keywords: ['toc', 'outline', 'catalog', 'mulu', 'ml', 'neirongmulu'],
    aliases: ['toc', 'mulu'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('toc', ctx),
  },
  {
    id: 'footnote',
    label: '脚注',
    description: '插入文末脚注引用',
    icon: 'footnote',
    category: '高级组件',
    keywords: ['footnote', 'jiaozhu', 'jz'],
    aliases: ['footnote', 'fn', 'jz'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('footnote', ctx),
  },
  {
    id: 'link-reference',
    label: '链接引用',
    description: '文档底部的链接引用定义',
    icon: 'link',
    category: '高级组件',
    keywords: ['reference', 'link-ref', 'ref', 'yinyong', 'ljyy'],
    aliases: ['ref', 'reference'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('link-reference', ctx),
  },
  {
    id: 'yaml',
    label: 'YAML Front Matter',
    description: '文档元数据头（仅顶部）',
    icon: 'yaml',
    category: '高级组件',
    keywords: ['yaml', 'frontmatter', 'meta', 'toubu', 'metadata'],
    aliases: ['yaml', 'meta'],
    isAvailable: ctx => !ctx.readOnly && !ctx.inTable && !ctx.inCodeBlock && !ctx.hasYaml,
    execute: ctx => ctx.liveEditor?.executeSlashCommand?.('yaml', ctx),
  },
]

export function filterSlashCommands(
  commands: SlashCommand[],
  rawQuery: string,
  context: SlashCommandContext
): SlashCommand[] {
  const available = commands.filter(cmd => cmd.isAvailable(context))
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return available
  }

  interface ScoredCommand {
    cmd: SlashCommand
    score: number
  }

  const scored: ScoredCommand[] = []

  for (const cmd of available) {
    let score = 0
    const labelLower = cmd.label.toLowerCase()
    const idLower = cmd.id.toLowerCase()

    if (cmd.aliases.some(a => a.toLowerCase() === query)) {
      score = Math.max(score, 100)
    } else if (idLower === query) {
      score = Math.max(score, 95)
    } else if (labelLower === query) {
      score = Math.max(score, 90)
    } else if (cmd.aliases.some(a => a.toLowerCase().startsWith(query))) {
      score = Math.max(score, 85)
    } else if (labelLower.startsWith(query)) {
      score = Math.max(score, 80)
    } else if (cmd.keywords.some(k => k.toLowerCase().startsWith(query))) {
      score = Math.max(score, 75)
    } else if (labelLower.includes(query)) {
      score = Math.max(score, 70)
    } else if (cmd.keywords.some(k => k.toLowerCase().includes(query))) {
      score = Math.max(score, 65)
    } else if (cmd.description.toLowerCase().includes(query)) {
      score = Math.max(score, 40)
    }

    if (score > 0) {
      scored.push({ cmd, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map(item => item.cmd)
}
