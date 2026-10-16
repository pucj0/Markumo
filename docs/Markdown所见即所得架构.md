# Markdown WYSIWYG 架构与实施记录（2026-10-15）

> 2026-10-16 增量：[Typora 本机实操修复](Typora实机交互验收与修复_2026-10-16.md)。InlineSourceView 当前使用原生行内编辑 DOM，保持正文换行与点击光标，替代下段历史中的行内 CM 框；仍由精确 raw patch 验证后进入 PM Transaction/DocumentManager history，Mapping 与语义校验失效时关闭旧界面。普通文件、Source/Split 和围栏代码继续使用 CM6；公式本地实时预览、Mermaid 编辑时保留 SVG、语言候选固定定位、YAML/TOC 默认只显示内容。完整交互/视觉等价仍为 REVIEW/UNVERIFIED。

> 最新增量：[语言与局部编辑整改](统一语言与Typora编辑体验整改_2026-10-15.md)。统一 Registry/高亮、代码搜索选择器与 SVG；InlineSourceView 用 PM Decoration 挂载当前行内范围 CM，精确 raw 补丁进入 DocumentManager history，支持链接/图片/强调，未整段退回源码。标题只加级别标识。下文“仅浮层编辑”“点击才渲染公式/图表”“查找转 Source”等为已被覆盖的历史状态。

状态：**REVIEW**。本次是用户一次性授权的六阶段 Markdown 编辑内核专项，覆盖旧 PRD/AGENTS 中同区 CodeMirror Live、禁止 ProseMirror、逐阶段审批的约束；不推进通用产品 Phase 7/8。开始 HEAD 为 `25d1a64`，未提交、推送或发布。开始时已有 Logo、菜单、标签视觉、打包及进度文档修改，均保留。

## 编辑器与文件生命周期

| 内容/模式 | 生产内核 |
| --- | --- |
| TXT、代码、配置、日志 | 原 CodeMirror 6 |
| Markdown Source | CodeMirror 6 / Lezer |
| Markdown Split | CodeMirror 6 + 既有安全 markdown-it 只读预览 |
| Markdown Live | 按需加载的原生 ProseMirror |
| Live 围栏代码 | ProseMirror CodeBlock NodeView 内嵌 CodeMirror 6 |

采用 ProseMirror 是为了让段落、标题、列表和表格拥有稳定的结构化节点及选区，解决点击后退回整块 Markdown 标记的问题。没有使用 TipTap、Milkdown、Electron 或新的文件保存系统。

`DocumentManager` 继续持有每文档 canonical CM EditorState、行尾 RangeSet、dirty/baseline、token、编码、版本与共享历史。Live 的 PM Transaction 经 `MarkdownSourceBridge` 生成受版本检查的局部源码补丁，再进入同一个 CM 历史；不安装 PM history 或嵌入代码块 history。Source/Live/另一 Pane 的 Undo/Redo 都调用 canonical CM 历史，避免多个撤销栈覆盖同文档。普通输入按 CM 输入事件分组；工具栏结构命令使用 isolateHistory。

每 Pane 独立持有 PM EditorView、选区和滚动。Live→Live 的跨 Pane 同步应用同一组 PM Steps，接收侧选区经 Step mapping 映射，不复制发起侧选区。Source 编辑/Undo 导致源码变化时才重新解析，尽量用 PM 内容差异替换；自身 Live 输入不全文重解析、不重建 EditorView 或 CodeMirror NodeView。异步加载有 Pane/文档/host 身份检查；关闭、换标签、切模式、dispose 都释放 PM、CM、图片与监听。

文件保存仍经 `FileController.saveSnapshot` 和原 Rust 安全服务；不逐键 IPC，不自动保存，冲突/权限错误保留编辑内容。原生验收证据见验收文档。

## 六阶段实现与边界

1. Schema/Parser/Serializer/Source Preservation：CommonMark 基础、GFM 表格、任务、删除线、自动链接、软/硬换行、引用链接；稳定块来源与原始切片；复杂语法局部受保护。详见保真文档。
2. 独立 Live：DocumentManager 动态 import；接入共享历史、模式、Pane、保存及清理；超 1,048,576 UTF-16 字符显示明确提示并使用 Source。组合输入时拒绝保存、切模式和危险生命周期操作，需完成输入后重试。
3. 表格/代码：prosemirror-tables 单元格编辑、矩形选择/粘贴、Tab/Shift+Tab、末单元格 Tab 加行、行列增删/列对齐/右键工具入口/删除表格。代码块内部从 1 行号、现有语言包、语言信息、复制、缩进、共享撤销、边界箭头和 Mod+Enter 前后插段落；围栏不在 Live 显示。
4. 链接/图片/列表/引用：点击链接属性编辑、移除/安全打开；文内锚点；相对链接只通过已有授权工作区入口打开。图片复用 Rust 资源授权、导入、目录规则、粘贴/原生 Drop；路径/替代文字局部修改和删除，失败保留路径。列表/任务/引用使用结构命令、input rules 与真实 checkbox 事务。
5. 排版/设置：860px 居中、16px/1.7、中文字体、标题、表格、代码、深浅主题；独立 CSS token。宽度/字体/字号/行高/代码行号/换行有设置和 Rust 持久化。移除标签图钉，保留固定/取消固定右键操作；全部标签可关闭及中键关闭。
6. 扩展/验证：YAML 局部折叠源码；脚注引用及定义、文内 TOC、Callout 安全显示；行内/块公式通过明确渲染入口加载 KaTeX；Mermaid 在代码块内按需渲染。保留复杂 HTML/未知扩展原文。模型、浏览器、原生和性能证据列于验收文档。

没有宣称完全等价 Typora：查找/替换会明确切 Source；Live 单选区，不提供 CM 多光标；键盘进入链接不自动弹属性浮层；脚注没有完整自动编号/回链；Callout 正文为安全文本显示；任意复杂 HTML 和未知扩展不转成富文本。CodeMirror 旧装饰器模块保留用于隔离模型回归，生产 DocumentManager 不再安装旧 Live 扩展。

## 依赖与安全

直接新增 ProseMirror model/state/view/transform/commands/keymap/inputrules/schema-list/tables/gapcursor/markdown（11 个官方模块）。`prosemirror-markdown` 复用官方 CommonMark 适配器，项目将其 markdown-it 统一到现有 15.0.2，避免第二个运行时；该官方适配器仍声明 v14 类型，因此只有适配边界使用受控 unknown 类型桥接。

扩展新增 KaTeX 0.19.0、Mermaid 11.15.0、DOMPurify 3.4.17。Mermaid 12 要求更高 Node 版本且增加 ELK，因此不采用。Mermaid 的 KaTeX 也统一为同一个 0.19.0。没有增加 Rust crate。

Mermaid/KaTeX 只在对应块明确点击渲染时动态 import，普通 TXT 和常规 Live 不加载。Mermaid strict、8000 字符/200 行/200 边预算；拒绝配置、HTML、自定义样式、图片/资源、外链和回调，输出 SVG 再净化并禁止 foreignObject/a/image/script。KaTeX trust=false、严格模式、宏展开/尺寸/输入长度预算。CSP 没有放宽。重解析不执行用户 HTML；粘贴 HTML 去掉可执行/资源节点与属性，再按 schema 转换。

图片继续使用既有 4MiB/16MP 单图、32MiB Blob/32MP 总解码预算；新增每文档至多 8MiB 原始字节缓存，合并并行 Pane 的读取；token/path 变化清缓存，Pane 销毁撤销 BlobURL。没有静默网络加载或上传。

## 文件用途

| 文件 | 用途 |
| --- | --- |
| `src/editor/markdown/wysiwyg/MarkdownSchema.ts` | 结构化文档、表格、行内扩展、安全 DOM schema |
| `MarkdownParser.ts` | 共享 markdown-it、任务/表格适配、源码块边界与保护 |
| `MarkdownSerializer.ts` | 严格局部序列化、围栏保留、逐单元格补丁 |
| `MarkdownSourceBridge.ts` | 版本来源、原文切片、源码补丁、近似模式选区映射 |
| `MarkdownEditorController.ts` | PM 视图/事务、命令、工具、NodeViews、剪贴板/生命周期 |
| `CodeBlockView.ts` | 嵌入 CM、语言、行号、边界键、同步/销毁 |
| `MarkdownTheme.css` | 独立文档 token/样式，不作用 TXT/代码 |
| `contracts.ts`、`assets.d.ts`、`renderers.ts` | 无 PM 静态运行时的接口、资源类型、延迟扩展渲染 |
| `src/editor/core/DocumentManager.ts` | 双内核协调、共享历史、版本检查、Pane 加载/销毁 |
| `src/components/layout/EditorPane.vue` | 任意 Pane 正确挂载，超预算明确提示 |
| `src/components/layout/TabBar.vue` | 图钉移除、关闭/中键、固定右键保留 |
| `src/editor/markdown/{images,links}.ts` | 图片读取合并、受限相对文档解析 |
| `src/features/shell/editorSettings.ts` | 排版默认值、校验、持久化数据 |
| `src/app/useAppShell.ts`、`src/App.vue`、`src/components/modals/SettingsModal.vue` | 设置接线、Live 剪贴板/图片入口、授权工作区相对链接 |
| `src-tauri/src/commands/settings.rs` | 新设置默认/范围/反序列化/持久化测试 |
| `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`vite.config.ts` | 依赖锁定/去重、测试入口、预优化防开发期首次动态加载重载 |
| `tests/markdown-wysiwyg.test.ts` | 来源保真、结构事务、围栏、表格、扩展、设置/相对路径 |
| `tests/markdown-wysiwyg-{ui,native,performance}.mjs` | 实际浏览器、Windows/Rust/磁盘、性能 |
| `tests/fixtures/markdown-wysiwyg.md` | 中英文、基础/复杂扩展综合人工文档 |
| `tests/editor-browser.mjs`、`tests/markdown-click-ui.mjs` | 原验收命令迁移至新产品行为（含 40 字形点击）；两份已替换的旧 DOM 备份已按用户清理要求删除 |
| `tests/markdown-stage-a.test.ts` | 将资源身份断言从旧 decoration field 迁移至每文档资源，保留另存为/移动安全断言 |
| `开发代理规则.md`、`docs/产品需求文档.md`、`docs/阶段进度与验收台账.md`、`docs/Markdown功能差距矩阵.md` | 授权覆盖、当前状态/差距；历史记录不冒充本轮验收 |

其余开始时已有的 Logo、菜单、`docs/本地打包说明.md` 等修改不属于本专项，不覆盖或撤销。
