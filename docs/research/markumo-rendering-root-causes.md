# Markumo 图片、HTML 与实时渲染根因审查

2026-10-16，Phase 0 实机研究完成后进行。研究报告见 [typora-interaction-study.md](typora-interaction-study.md)。本文件在本轮项目源码修改之前建立；原有 Markumo 更名改动保留。

## 可信文档与派生视图

`DocumentManager` 的 CM6 EditorState/Text 是原始 Markdown 与共享历史的数据源；Source/Split、代码块使用 CM6。Live 是已经存在的 ProseMirror 视图，经 `MarkdownSourceBridge` 发布局部补丁并检查 expected revision。保持此架构，不另造整篇 contenteditable，也不把预览 DOM 序列化写回文件。

`MarkdownParser` 用 markdown-it 的 block map 建立原文块范围；HTML block 可能是 `html_block`，也可能是带 HTML 标签的 `protected_source`，Controller 的两条 NodeView 路由均会进入 `HtmlBlockView`。不能因为其中一条路由存在就宣称所有输入转换已正确。

## 基线与根因

| 问题 | 基线证据与根因 | 修复方向 |
|---|---|---|
| 图片末尾定位失败 | `project-before.json`：原生选区是 `example`，CM 选区仅为 55–56；`InlineSourceView.focus()` 对 image 用 `indexOf(']')` 固定选择 alt。PM NodeSelection 是一个 atom，无法代表完整图片 raw span | Lezer Image 精确范围给出 sourceFrom/sourceTo；同时将正式 CM selection 设置到 sourceTo，原位编辑器光标到 raw.length；禁止搜索 DOM 文本猜位置 |
| HTML H1 实时输入不转换 | 在独立空段落实际键入 `<h1>输入标题</h1>` 并 Enter，原文正确保留但 `.md-html-preview h1` 为 0，见 `project-before-typed-h1.png`；现有 Markdown 输入规则没有 HTML 段落转换 | 根据当前段落完整源码和正式解析结果转换当前节点，保留 sourceId 与前后块，纳入共享撤销 |
| 已有 HTML H1 不等于所有 H1 正确 | `project-before-html.png` 中初次加载的 HTML H1 已正常显示。这不是“完全缺少 HTML 支持”，而是输入态、节点类别与导航不一致 | 分别测试导入、实时输入、Source 修改、多 Pane 更新；不通过叠加 CSS 掩盖流程问题 |
| HTML 草稿没有实时进入共享文档 | HtmlBlockView 使用 textarea，直到 saveSource 才 setNodeMarkup；update() 会更换 node 引用而保留编辑中的旧 textarea。另一个 Pane 改动同块后，身份检查可能针对更新后的 node 通过，而旧草稿覆盖新内容 | 使用局部 CM6 编辑，事务发布到唯一原文；记录本地提交与外部更新，目标失效/冲突立即收起旧编辑器，不回写旧文档 |
| 行内 HTML 是外置气泡 | HtmlInlineView 在 document.body 添加 input popover，保存时 trim；没有与正文的选区、共享历史、组合输入统一 | 改为当前范围内的局部源码；保留完整原文、空格和 HTML 属性；不把 input.select() 当自然编辑 |
| Outline 只看到 Markdown 标题 | outlineService 只处理 Lezer ATX/Setext 节点，跳过 FencedCode；没有 HTML h1–h6 提取与源码行映射 | 基于真正 HTML 源码范围解析标题，排除围栏/代码/注释，保留确切位置用于导航与折叠 |
| 图片边框没有设置链路 | MarkdownTypography、Rust 设置结构、SettingsModal 均没有 image border 字段；旧全局 `.md-image-preview` 灰框已被 Live 专用样式关闭 | 新增默认 true 的持久化布尔设置，对实际 img 绘制主题细边框，覆盖 Markdown 与 HTML 图片；不套 Mermaid/导出 |
| HTML 图片异步资源与错误提示 | mountHtmlImages 主要依靠 img.isConnected 判断，destroy 后的异步回调没有独立生命周期标识；错误提示将 src/reason 插入 innerHTML | 生命周期代次/失效检查，受控图片加载；错误路径用 textContent，补实际浏览器恶意属性与 URL 测试 |
| 源码范围保真 | inlineSourceRange 使用 Lezer，但 bridge 通用 sourcePosition 不能准确表达 atom 内所有原始字符；HTML inline pair 合并 children.content 会忽略 Markdown 分隔符/转义 | 原文范围与视图位置分离，编辑提交原始 source patch；不得从渲染 HTML 反向生成原文 |
| Mermaid/图片相邻布局 | `project-before-adjacent.png` 的稳定加载状态已不重叠，不能把未复现的静态重叠写成已修复。异步渲染、图片失败/尺寸变化、编辑展开和多栏缩放仍需专项测试 | 保持自然流，检查异步代次和测量通知；新增延迟加载与几何断言，不使用绝对定位或负 margin |

## 本轮验证计划

1. 同一真实 EditorContainer 基线及修改后截图；保持临时文档内容一致。
2. 图片中央/边缘、同路径相邻图片、带 title/中文/emoji/空格、列表/引用/表格；CM selection 与源码范围末尾一致。
3. HTML H1–H6、Setext、行内/块级/嵌套 HTML；键盘进入、Enter/Shift+Enter/Esc/方向键、共享历史与外部 Pane 更新。
4. 默认边框、关闭即时生效、明暗主题、设置重启保留；原文与导出样式不因设置变化。
5. 图表 → 图片 → 标题 → SQL 在延迟加载、滚动、缩放、分栏及编辑时保持几何顺序，不吞原文。
6. 明确 Sanitizer 与静态 SVG 白名单；script/event/javascript/local-file 不能执行或越权，未知/不支持内容仍可编辑原文。
7. typecheck、单测、build、Markdown UI、适用 Windows/WebView2 原生测试。真实 IME 与 Typora Ctrl+点击未完成的证据继续标 UNVERIFIED，不用合成事件冒充原生输入。
