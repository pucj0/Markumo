# LightEdit — Typora 视觉对齐与排版验收标准 (Typora Visual Parity)

> 最新记录：[语言与编辑体验整改](统一语言与Typora编辑体验整改_2026-10-15.md)。真实新图涵盖明暗页面、Java/Bash、语言列表、链接/图片/H3 与表格，位于 `test-results/language-experience/`，另有真实原生截图。H1 现为 2.2em、表格 padding 6px/12px、代码背景取得有效主题 token；普通/内嵌 Token 实际颜色已测。下方旧 34.4px/8.8px 为历史测量。Typora 窗口读取被拒绝，**同设置对照仍全部 UNVERIFIED**，新增截图不等于完成比较。

> 2026-10-15 复验更正：本文后续表格是目标规格，不是实际 Typora 对比结果。本轮使用统一 fixture 生成了真实明暗区域截图和 CSS/几何数据，但本机 Typora 窗口读取被权限拒绝，全部同设置视觉项 **UNVERIFIED**。H1 实测 2.15em（34.4px）与下方目标 2.2em 不同；表格 padding 实测 8.8px/13.6px 与目标 6px/12px 不同。完整分项记录、截图位置与限制见 [本轮复验报告](Typora体验复验与修复_2026-10-15.md)。

版本：2026-10-16  
视觉参考：用户提供的 Typora 截图与官方标准主题排版。

---

## 1. 视觉规格总览

| 视觉元素 | Typora 官方标准参考 | LightEdit 实现目标 | 样式规范 |
| :--- | :--- | :--- | :--- |
| **文档容器** | 页面居中，适度留白 | `.md-document` 居中对齐 | `max-width: 860px; margin: 0 auto; padding: 48px 48px 160px;` |
| **正文字体栈** | 优雅无衬线，中西文混排协调 | 适配中西文字体层级 | `-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif` |
| **正文字号/行高**| 16px / 1.7 | `var(--md-font-size: 16px)` / `1.7` | 段落间距 `margin-bottom: 1.1em` |
| **标题层级 (H1-H6)**| H1 2.2em，H2 1.65em（带底边框），H3 1.35em | 遵循 Typora 经典层级与下划线 | H1 2.2em, H2 1.65em (border-bottom 1px solid line), H3 1.35em, H4 1.15em |
| **代码块 (Fences)** | 浅灰/深色柔和背景，无突兀粗边框，块内行号，右下角语言 | 块内行号 + 右下角可点击语言标签 | 背景 `--md-code-bg`, 圆角 6px, 内边距 10px 14px, 行号浅色等宽 |
| **表格 (Tables)** | 细线网格，表头浅底加粗，自适应宽 | 极细边框，单元格间距自然，内容溢出横向滚动 | `border-collapse: collapse; border: 1px solid var(--line); th: background var(--side)` |
| **图片 (Images)** | 纯图片展示，独立成段居中，点击显示轻量蓝框/浮动工具 | 独立图片居中，去除所有路径文字和卡片包裹 | `display: block; margin: 16px auto; max-width: 100%; border-radius: 4px;` |
| **超链接 (Links)** | 强调色，下划线，悬浮微动效，无原始符号 | 醒目强调色与悬浮下划线，点击就地浮层 | 颜色 `var(--accent)`, 点击浮出 `.md-link-popover` |
| **任务列表 (Tasks)**| 优雅复选框，去除列表黑点，紧随文本 | 统一 Checkbox 居中对齐 | `accent-color: var(--accent); list-style: none;` |
| **数学公式 (Math)** | 优先显示 KaTeX 渲染结果，点击显示编辑条 | 默认直接渲染公式，点击局部内联编辑 | 优雅数学排版字体，无点击前纯净展示 |
| **图表 (Mermaid)** | 优先显示 SVG 图表，支持局部切换源码 | 默认渲染 SVG 图表，提供右上角源码编辑切换 | 独立容器，自适应缩放 |
| **查找/替换浮层** | 停靠右上角，浮动不挤压排版，带数量指示 | 浮动在编辑器右上角 | `position: absolute; top: 12px; right: 24px; z-index: 20;` |

---

## 2. 交互组件视觉规范

### 2.1 跟随式表格工具栏 (`.md-table-floating-bar`)
- 仅在光标处于表格单元格内部时显示。
- 采用绝对定位停靠在表格正上方，带有轻微阴影与圆角（`box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 6px;`）。
- 按钮采用紧凑图标与微缩文字，悬浮带有高亮底色。

### 2.2 链接编辑浮层 (`.md-link-popover`)
- 位于被点击的 `<a>` 标签下方，箭头指示。
- 内含文本与 URL 两个极简输入框，以及“打开”、“复制”、“移除”三个快捷按钮。
- `Ctrl+Click` 直接打开，不呼出浮层。

### 2.3 图片悬浮工具栏 (`.md-image-toolbar`)
- 图片获得焦点或被选中时，在其正下方浮出轻量工具栏。
- 允许修改图片路径、修改替代文本、重载或删除。
- 普通阅读模式下图片完全无边框与按钮污染。

### 2.4 代码块语言徽标 (`.md-code-lang-tag`)
- 停靠在代码块右下角，半透明静默显示当前语法（如 `javascript` / `java` / `sql`）。
- 鼠标悬浮或点击时展开为输入搜索栏。
- 复制代码按钮在鼠标滑入代码块右上角时平滑显现。
