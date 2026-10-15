# LightEdit（暂定名）——Fleet 风格轻量通用文本编辑器

> **2026-10-15 Markdown 编辑内核决议（覆盖本文旧 Live 技术约束）**：用户明确授权 Markdown Live 改用按需加载的原生 ProseMirror，代码块使用 CodeMirror 6 NodeView，GFM 表格使用 prosemirror-tables。普通文本、代码、Markdown Source/Split 编辑侧仍用 CodeMirror 6；Rust/Tauri/Vue/TS/Vite 保持。源码是持久化权威，Live 事务必须经过 Source Preservation 桥接和既有 DocumentManager/FileController；禁止打开/切模式改写源码、独立保存或独立撤销栈。本专项六个内部阶段连续授权，不推进通用 Phase 7/8。本文后续同区 CM/光标展开/禁止 ProseMirror 的历史条款由本决议取代。实现与限制以 `MARKDOWN_WYSIWYG_ARCHITECTURE.md`、`MARKDOWN_SOURCE_PRESERVATION.md`、`MARKDOWN_WYSIWYG_ACCEPTANCE.md` 为准；测试未通过的能力不能沿用旧 SUPPORTED 结论。

> 项目定位：**本质是通用桌面文本编辑器，不是 Markdown 专用软件。** 参考 JetBrains Fleet 的界面布局、快速导航和工作区体验；参考 Typora/Obsidian Live Preview 的 Markdown 即时排版。技术栈固定：**Rust + Tauri 2 + Vue 3 + TypeScript + Vite + CodeMirror 6**。
>
> 该文档可以直接交给编程 AI。每个 Phase 后都必须提供实现摘要、修改文件、测试与风险说明。程序采用本地优先、无服务端、无账户依赖。

---

## 0. 全局 AI 开发指令（每个 Phase 都有效）

你是负责架构、UX、实现和测试的高级桌面软件工程师。将本项目设计为一个像 Fleet 一样开箱即用、键盘优先、快速而安静的通用文本编辑器；Markdown 是强化的文件类型，但非产品入口或全局默认形态。

**不可违背的约束：**

1. 技术栈限定 Rust + Tauri 2 + Vue 3 + TypeScript + Vite + CodeMirror 6。Rust 仅处理桌面能力、文件安全、工作区/搜索/文件监听等，所有输入、撤销、选择和编辑器渲染均发生在 CodeMirror 6；不要使用 Electron、Monaco、ProseMirror、TipTap、Ace，也不要编写自制文本编辑器。
2. 用户既能**直接打开单个文件**，也能**直接打开文件夹作为工作区**；新建临时文件无需项目、账号、数据库。单文件模式与工作区模式共用文档模型，UI 状态独立于文件打开方式。不能因为用户打开一个文件就自动构造工作区。
3. 至少支持：纯文本、Markdown、JSON、JSONC、YAML、TOML、JS/TS/JSX/TSX、Vue、HTML、CSS、Python、Go、Rust、SQL、XML、INI、CSV、日志及无扩展名文件（可手动切语言模式）。**打开任何可识别的文本文件都必须能编辑和保存**；高亮语言包按需加载。
4. Markdown 文件默认 **Live Preview 即时排版**，同时提供源码/双栏。使用 CodeMirror 6 `StateField`、`ViewPlugin`、`Decoration`、`WidgetType`、语法树实现；源文本与语法标记永远是唯一真相。不通过 HTML 反向转换 Markdown，不因切换视图修改文本，不用嵌套 `contenteditable` 或每段 textarea 代替正式编辑内核。
5. Markdown 的 inline heading/strong/emphasis/code/link/task-list/quote/list 等提供循序实现；编辑区光标进入语法范围时应显示可编辑源码，移开后恢复即时排版。表格、复杂嵌套块、数学及 mermaid 在稳定实现前优雅退化为源码或只读预览，不得破坏源文。解析器增量更新、仅装饰可视范围，避免光标抖动；中文 IME 输入必须正确。
6. 文件读写必须考虑：UTF-8/BOM、编码异常提示、CRLF/LF、末尾换行、只读文件、权限错误、外部修改、覆盖确认、原子替换可行性与异常恢复。默认禁止静默覆盖外部已修改文件，关闭未保存标签时必须确认。
7. 所有文件读写都只针对用户明确选择的文件/目录及授权范围；Rust 命令验证规范化路径、符号链接和目录访问限制，避免任意路径穿越。渲染 Markdown 的 HTML 必须禁用原始脚本或经过严格净化；WebView 保持最小权限。
8. UI 参考 Fleet 体验，但不要 1:1 复刻商标和资产：紧凑顶部栏、左侧轻量 Activity Bar、可折叠文件树、紧凑 Tabs、面包屑、主编辑区、可选 Outline/搜索、窄状态栏、命令面板。可以直接进入编辑，绝不强制展示巨大欢迎页。
9. 单一文档使用唯一标识和明确的 `uri/path/dirty/encoding/eol/language/editorState/lastDiskVersion`。切换 tab 须保留光标、选择、滚动、撤销历史；不能用简单重建 `EditorView` 丢失状态。
10. 所有耗时任务（大文件打开/搜索、目录扫描、文件监视）不能阻塞 UI。文件树按需展开，忽略 `.git/node_modules/dist/target` 等；搜索支持取消、超时、边界控制与结果分批。
11. 插件、AI、LSP、终端、Git 集成、代码运行不是 MVP 的必需功能，不要未经请求加入，以免背离轻量目标。后续可预留扩展点但不预埋重框架。
12. 不能只展示好看的 Mock。每个 Phase 必须交付能运行的功能、自动化测试和复现步骤，测试失败不能宣称完成。每次新增 UI 按需提供键盘访问和缩放适配。

---

## 1. 产品画像及范围

### 使用场景（按优先级排序）

| 优先级 | 场景 | 验收体验 |
| --- | --- | --- |
| P0 | 右键/拖拽/快捷键打开 `.txt`, `.json`, `.rs` 等文本 | 直接打开，立即获得可编辑光标，无项目要求 |
| P0 | 打开文件夹作为工作区 | 左侧文件树按需展开；双击 pin 标签，单击 preview tab；切换稳定 |
| P0 | 新建草稿、编辑、保存/另存为 | `Ctrl+N`, `Ctrl+S`，文件标题 dirty 状态准确，安全写入 |
| P0 | `.md` 即时排版 | 所见即编辑；标题、粗体、列表、待办等光标进入后显示原语法 |
| P0 | 源码编辑任意文本 | 行号、语法高亮、括号匹配、缩进、折叠、查找/替换、撤销恢复 |
| P0 | 命令面板/快速打开 | `Ctrl+Shift+P`, `Ctrl+P`；操作快速、支持键盘导航 |
| P0 | 多标签与单文件/工作区切换 | 不丢内容/位置；单文件模式无强制左栏 |
| P1 | 分栏编辑（同文档/不同文档） | 各 pane 独立滚动和状态，同文件共享文档更改模型 |
| P1 | 工作区全文搜索 | 结果分批、排除规则、单击定位行列 |
| P1 | 临时草稿与异常恢复 | 异常退出后可恢复未保存文本，用户可放弃 |
| P1 | 外部修改通知/冲突处理 | 未改动文件可自动刷新，已改动时可比较/保留/覆盖 |
| P1 | 主题、字体、缩放、自动换行 | 文件类型分别保留可配置体验 |
| P2 | 大文件优化、精细语法服务 | 保证不崩溃并显示降级提示 |
| P2 | Markdown 表格/数学/图片高级交互 | 满足稳定性标准后分阶段推出 |
| P3 | LSP、Git、插件、AI、终端 | 单独讨论，不纳入本次项目基线 |

### 内容类型判定

- `.md/.markdown`：默认 **Live Preview**；可切 Source / Split；按工作区与文件记忆最后使用视图。
- `.txt/.log/.csv`：纯文本，默认自动换行可配置；支持大文件降级/分页只读。
- 代码及配置文件：CodeMirror 6 + 懒加载语言包 + 行号 + 折叠 + 括号匹配；不得自动渲染成富文本。
- 无扩展名/不识别类型：纯文本 + 状态栏「语言模式」选择器。
- 二进制/明显超阈值文件：友好提示或只读预览，不能尝试完整渲染导致卡死。

### 明确非目标

不实现复杂调试器、构建系统、智能工程分析、服务器协同、云同步、依赖账号。产品对外自称 lightweight text editor，不自称 IDE。

---

## 2. UI/UX 规范：Fleet 味道，但更加专注

```
┌───────────────────────────────────────────────────────────────────────────┐
│  [≡] LightEdit / 项目名       [⌕ Search / Quick Open]     [Layout] [Theme]│ ← 44-48px
├────┬──────────────────┬───────────────────────────────────────────────────┤
│ ▣  │ EXPLORER         │ [ README.md ] [ main.ts ] [ settings.json ]   [+]│ ← 38-40px Tabs
│ ⌕  │ ▼ project        ├───────────────────────────────────────────────────┤
│ ▤  │   ▸ src          │ src > main.ts                [语言] [分栏] […]  │
│ ⚙  │   ▾ docs         ├───────────────────────────────────────────────────┤
│    │      README.md   │  1 │ const app = createApp(...)              │
│    │   package.json   │  2 │ // ...                                  │
│    │   settings.json  │  3 │                                         │
│    │                  │      CodeMirror 6 主编辑区域                 │
│    │                  │                                             │
├────┴──────────────────┴───────────────────────────────────────────────────┤
│ ⎇ workspace   UTF-8   LF  TypeScript   Ln 8, Col 12   Spaces: 2   ⇄ 100% │ ← 24px
└───────────────────────────────────────────────────────────────────────────┘
```

- **Activity Bar**：默认 40–44px，文件、搜索、Outline、设置；不显示 Git/终端占位入口。
- **Sidebar**：建议默认 248px，可拖拽宽度 190–420px；单文件模式可默认隐藏，用户可手动开启「最近文件」。
- **Tabs**：区分临时预览与固定标签；保存状态小圆点；中键关闭；右键菜单（关闭其他/右侧/复制路径/在文件管理器显示）。
- **Editor**：代码文本默认单栏；Markdown 默认 Live Preview；切换 `.ts` 后自动隐藏 Markdown 视图选择。
- **Breadcrumb**：独立文件显示路径简写；工作区显示相对路径；点击可快速定位目录。
- **Statusbar**：UTF-8/BOM、LF/CRLF、缩进（Tabs/Spaces）、语言、行列、文档字符数、是否只读。
- **Search**：`Ctrl+F` 当前文档，`Ctrl+H` 替换，`Ctrl+Shift+F` 工作区全文；`Ctrl+P` 文件快速跳转，`Ctrl+Shift+P` 命令面板。
- **Editor split**：最多两 pane 作为初版，避免无限嵌套复杂布局；pane 与 tab group 生命周期明确。
- **风格**：深浅主题齐备；低对比 chrome、高可读正文；窄工具条、少描边少阴影，主题 CSS Variables，支持 125%/150% Windows DPI。
- **响应式**：窄窗口自动收起 Outline/Sidebar，不允许主编辑区低于合理最小宽度。

---

## 3. 技术架构、模块边界和数据流

```text
Tauri 2 / Rust shell
  src-tauri/src/
    commands/{files,workspace,search,settings}.rs
    domain/{document,encoding,paths,search_result}.rs
    services/{file_service,workspace_service,watcher,search_service,session}.rs
    infrastructure/{atomic_write,encoding_detection,fs_scope}.rs
                ↑ invoke: Open/Save/Search/Watch（有限事件）
Vue3 + TS frontend
  src/app/                AppShell, window-layout, routes?（不需要 router）
  src/features/explorer/  folder tree, context menus, drag-drop
  src/features/tabs/      tab groups, documents, state management
  src/features/search/    palette, find/replace, global search
  src/features/settings/  preferences & keymap
  src/editor/core/        editor manager, EditorState cache, CodeMirrorView
  src/editor/languages/   lazy language loader + file detection
  src/editor/markdown/    live-preview, decoration, syntax, preview
  src/editor/commands/    keybinding dispatcher, command registry
  src/styles/             tokens, themes, editor skins
                ↓
        CodeMirror 6 EditorState / EditorView
```

**强制解耦边界：**

- 文档存储：统一 `Document` 业务模型和独立的 `EditorState` 缓存；`Document` 对应真实文件或 untitled URI，UI pane 不等于 document。
- 编辑过程：CodeMirror `Transaction` 是唯一文本变更机制；Vue/Pinia 仅存可序列化的文档元数据、标签和布局，不能把每次输入 `v-model` 到大字符串触发全 App 更新。
- 文件 I/O：Rust `OpenDocument` 返回 text + metadata（编码、EOL、mtime/Hash 等）；编辑不跨 IPC；保存时取 CodeMirror 当前文本并异步发送；写入后验证磁盘版本。异步保存要处理先后顺序，避免较旧版本完成后标记新版本为已保存。
- 语言识别：先扩展名、后模式手选、可选轻量首行/shebang；支持手动覆盖；语言包动态 import + Compartment 重配置，不重建文档状态。
- 配置：前期 JSON + 安全写入；最近文件和工作区状态分别持久化；不引入 SQLite 除非有必要的基准结果。
- 事件：Rust 仅发送外部文件变化/搜索结果批次；窗口与文档内的编辑状态直接 TS 管理。
- 测试：Rust 单测 + 集成测试、Vitest + Vue Testing Library、Playwright（WebView 端可行性评估）或分离的浏览器端 UI E2E；涉及真实磁盘的安全测试要跑独立 fixture 目录。

### Rust 核心接口草案（以实际设计调整）

```ts
type FileInfo = { uri: string; name: string; language: string; encoding: string; bom: boolean; eol: 'LF'|'CRLF'|'CR'|'MIXED'; diskVersion: string; readOnly: boolean };
type OpenResult = { meta: FileInfo; text: string };
type SaveRequest = { uri: string; text: string; expectedDiskVersion?: string; encoding: string; bom: boolean; eol: 'LF'|'CRLF'|'CR'; generation: number };
type SaveResult = { diskVersion: string; generation: number };
// 目录列表、文件监控、搜索均支持明确 scope、任务取消和类型化错误
```

---

## 4. Markdown Live Preview 专门规范（第一等公民，不是单独编辑器）

**基于 CodeMirror 6 的分层架构：**

1. `@codemirror/lang-markdown` + Lezer 提供语法树。利用 `syntaxTree(state)` 确定节点并建立 Decoration 范围。
2. `StateField` 持有 decoration set，`ViewPlugin` 按 viewport、文档变化、选区变化和输入法状态更新，避免每次全量渲染整篇。
3. **装饰优先**：heading font size/weight, bold/italic typography、inline code、链接、分割线、列表/quote。对 Markdown 标记用 `Decoration.replace` 处理，选区接近时恢复原始标记；不要修改底层文本文字。
4. **原子与交互**：Task checkbox 通过 transaction 修改 `[ ]` / `[x]`；点击链接应默认不夺走光标或改变文档，Ctrl/Cmd+Click 时打开可验证的 URL；代码块先保持可编辑源码和语法高亮。
5. **复杂块降级**：表格先以源语法编辑，并可分栏预览；图片先以可选 widget 预览、保留文本；公式、Mermaid 采用明确按需模块，默认安全。
6. `markdown-it` 仅用于**只读预览或双栏右侧**，启用安全策略（默认 `html: false`，且对扩展产生的 HTML 做净化），通过滚动同步映射定位；绝不反推源码。
7. 必测：中文 IME 连续输入、跨节点选择、多光标、撤销重做、删除格式标记、复制纯文本、Markdown 代码围栏编辑、超长文件、快速模式切换、标签来回切换、嵌套列表/表格退化。

### 模式语义

- **Live**：单一 CodeMirror 编辑视图，视觉排版 + 原始文本事务。默认仅 Markdown 出现。
- **Source**：同一文档的原始 Markdown CodeMirror 视图，保留编辑历史与选区。
- **Split**：CodeMirror 源码（左）+ markdown-it 只读渲染（右），编辑实时同步，滚动可选联动。
- 任何其他文件默认 **Text/Code**，不出现 Markdown 模式按钮。

---

## 5. 文件系统安全、用户信任与性能预算

- **无损**：清楚声明支持的编码；无法无损解码时阻止误保存并提示「以指定编码重新打开」；遇到 UTF-16 可识别后转码，但保存保留用户选择的目标编码。混合换行/无末尾换行应尽量保持原样，不能悄悄全部转为 LF；如果转换，必须经过明确的选择。
- **原子保存**：同目录临时文件 + flush/sync + 具备平台兼容的原子替换/备份回退策略；注意 Windows 文件占用、权限/ACL 保留、Linux/macOS fsync 目录差异。失败不得损坏旧文件。
- **外部更改**：fs 监听 + debounce + 文件签名；未编辑可提示刷新，dirty 状态则保留用户版本并提供「重新加载/比较/另存为/覆盖」。
- **异常恢复**：崩溃恢复快照周期性、保留版本、加密不作虚假承诺；明确用户控制与清理策略，绝不偷偷上传文本。
- **大文件**：先测量，>5–10MB 文本、单行 >1MB 或高行数文件触发性能降级建议（关闭 Live、语法包/多余装饰、减少实时扫描）；极大文件用只读分块模式或告知限制，不在主线程加载不可控体积。阈值可配置、可根据测试调整。
- **指标目标（需在固定测试环境基准记录，非虚假保证）**：常见文本编辑响应不明显掉帧；1MB 文本打开/搜索顺畅；冷启动尽量约 1–2s；按平台记录内存/安装体积。禁止编造运行数据。

---

# 6. AI 实施方式：8 个 Phase，每个独立验收

> 用法：首次提供「第 0–5 节全局上下文」，然后一次只粘贴下面**一个 Phase**。如果 AI 不熟悉当前仓库，要求先检查真实代码，**不允许直接假设已有文件**。每次回答包含：技术说明、变更清单、测试命令与结果、尚未完成的部分。

## Phase 1 — 建立 Tauri2 桌面骨架与 Fleet 风格壳

**可直接复制给编程 AI：**

```text
你是 LightEdit 项目的主程。阅读本产品文档第 0-5 节，严格执行全局约束。先检查仓库实际结构并列出计划，再实施 Phase 1。

目标：建立 Rust + Tauri 2 + Vue 3 + TS + Vite 项目，具有精致、紧凑的 Fleet 风格壳：标题栏（保留平台原生拖拽/窗口按钮）、左侧 Activity Bar、Explorer、标签栏、Breadcrumb、编辑器容器、状态栏、命令面板、设置弹窗、明暗主题、Sidebar resize、单文件/工作区两种布局。

要求：不接入虚构后端，不用巨型 UI 库；所有按钮可触发合理动作（未实现部分明确 disable）；UI 不应强制展示 Markdown；默认示例打开普通代码/纯文本文件。创建可扩展但不过度抽象的 src/features/ 结构。提供基本快捷键（Ctrl+N、Ctrl+P、Ctrl+Shift+P、Ctrl+B 可选）。Windows 首发，设计保留 macOS/Linux。

验收：pnpm build / cargo check / tauri dev 能按实际环境运行；主题、Sidebar 宽度、模式切换、命令面板可操作；无页面溢出和明显控制台报错。完成后停止，不执行 Phase 2。
```

## Phase 2 — CodeMirror 6 统一编辑器内核、多类型与多标签

```text
基于当前真实仓库实施 Phase 2；不要重写 Phase 1 UI，遵守第 0-5 节。

引入 CodeMirror 6，统一所有类型的编辑内核；实现 DocumentManager、TabGroup 与 EditorState 缓存。支持 untitled、txt、log、md、json、yaml、toml、js/ts、vue、html/css、py、go、rs、sql 等文件的语言识别；利用动态 import 按需启用语言包。支持行号、软换行、缩进、语法高亮、折叠、括号匹配、基础自动补全、撤销/重做、搜索/替换；区分 preview tab 和 pinned tab。Tab 切换保留文本/光标/滚动/撤销记录。无扩展名文件用 Plain Text；状态栏切换语言模式即时生效。

验收：同时打开 txt、md、json、ts、rs 等示例并编辑；文件类型不会误进入 Markdown 排版；相互切换与分组不会丢撤销栈；测试复杂输入、中文 IME。完成后停止。
```

## Phase 3 — Rust 安全文件 I/O、单文件和最近使用

```text
基于现有代码实施 Phase 3。将新建、打开、另存为、保存、拖拽打开、最近文件与外部程序打开文件参数连到 Rust/Tauri 2；Tauri IPC 只用于明确的文件 I/O。实现编码/BOM/EOL 侦测、可选编码重开、只读检测、权限错误处理、dirty 状态、关闭确认、文件名冲突、原子写入和磁盘版本检测；存储近期文件列表和独立文件布局偏好。单文件模式无需创建工作区。禁止示例 Mock 冒充真实 I/O。

测试真实 fixture：UTF-8 BOM / CRLF / 无末尾换行 / 中文 / 文件无权限 / 保存冲突 / 退出前 dirty / Windows 文件占用。失败必须保留用户内容。输出测试及已知限制并停止。
```

## Phase 4 — 工作区文件树、快速打开、搜索

```text
实施 Phase 4。支持目录选择即工作区、按需展开树、折叠、相对路径 Breadcrumb、文件新建/重命名/删除/移动与用户确认、Ctrl+P 快速打开、Ctrl+Shift+P 命令面板、Ctrl+Shift+F 工作区搜索、结果定位和搜索取消。文件树默认不做全目录扫描；遵守 .gitignore 和常见无关目录忽略规则，可由用户覆盖。Rust 搜索异步且分批返回；对 symlink 防环路与授权路径做安全处理。多个工作区最近历史不互相污染。

验收：万级文件结构下 UI 不阻塞；重命名打开中的文件更新 tab/path；工作区切换不丢 dirty 数据；取消搜索后不继续输出旧结果。仅完成本阶段。
```

## Phase 5 — Markdown Live Preview 核心（必做）

```text
实施 Phase 5，这是 P0 核心，不允许只做侧栏 HTML 预览。Markdown 文件默认 Live Preview，并可选 Source 和 Split；其他类型全部保持普通 CodeMirror 文本模式。

基于 @codemirror/lang-markdown 的 Lezer 语法树、Decoration/StateField/ViewPlugin/WidgetType 实现即时排版。第一批最小正确集合：H1-H6、粗体、斜体、删除线、行内代码、引用、无序/有序列表、任务复选框、水平线、链接。激活相关范围时可恢复源码，光标移开后重排。代码围栏保持可编辑源码并高亮。复杂表格/图片优雅退化，禁止篡改原语法。创建独立扩展模块和专用测试，包括 IME、多光标、撤销、选区、拷贝、嵌套列表、长文、快速切换视图。

Split 采用同一 CodeMirror 文本作为源，右侧 markdown-it 安全渲染只读 HTML。保持内容零转换、零隐藏篡改；不能用每段 textarea、嵌套 contenteditable 或另一个富文本内核伪造 Live Preview。

验收：手工更改复杂 md 文件，三种模式来回切换，磁盘 diff 与预期原文本编辑一致；10 次连续撤销/重做、中文输入、复制粘贴不出错。仅完成本阶段。
```

## Phase 6 — 编辑器进阶功能、分栏与使用效率

```text
实施 Phase 6：双 pane 分栏（水平分栏优先），相同/不同文档分别打开，组之间拖放标签和快捷切换；每个 pane 保存视图/滚动，统一 Document 保持一致。实现 go-to-line、find next/previous、whole-word/regex、replace-all、大小写切换、文件路径复制、Reveal in Explorer、快捷键配置、Zoom/word wrap/字体与缩进配置、可选 Outline。Markdown Outline 从语法树获取标题；代码 Outline 先轻量实现，未配语言解析器时隐藏/退化。

验收：分栏同文档修改无数据冲突；Regex 替换可预期；命令面板快捷键不与编辑器冲突；各设置重启后生效。停止。
```

## Phase 7 — 恢复、外部修改、性能优化

```text
实施 Phase 7：临时草稿与 crash recovery、失焦/定时备份（不自动覆盖真实文件）、file watcher 与脏文件冲突提示、磁盘写入竞态处理；大文件检测和安全降级；按需语法包；初次启动/打开文件/多标签切换/1MB、10MB、超长单行/万文件目录搜索的基准脚本与实测报告。

明确关闭未保存文件 UX，建立针对权限错误、BOM/CRLF/编码、文件树 symlink、原子保存失败、Markdown Live IME 和撤销行为的自动回归用例。真正修复瓶颈，不能仅写「已优化」。停止。
```

## Phase 8 — 桌面成品验收、正式打包

```text
实施 Phase 8：核对 Windows 原生标题栏/菜单/快捷键/文件关联/启动参数、签名与安装包配置（无证书时不要假装已签名）；校验 macOS/Linux 可构建性，并注明未经测试平台。完成 dark/light、高 DPI、触控板、键盘无障碍、页面缩放和主题一致性。制作应用图标和 about 页；完善错误日志与导出诊断（不得上传文件正文）；依赖安全审计；生成 Release 工件、版本与 changelog。

交付 README 安装与使用、所有测试命令和输出、性能报告、已知问题、下个版本 backlog。不要声称达到特定包体积/内存目标，除非展示实际环境测量值。完成后停下等待用户验收。
```

---

## 7. 按顺序逐 Phase 的验收口令

- 完成每阶段后让 AI 输出：`变更文件（含路径）`、`设计取舍`、`执行过的命令与结果`、`手工验证步骤`、`剩余风险`、`下一阶段是否安全启动`。
- 不要要求 AI 一次做完所有 Phase，防止只生成大量不可运行的代码。
- 每阶段遵守当前仓库实际 API 版本并查官方文档验证，禁止硬编码一个尚未证实存在的 Tauri 插件。
- 若用户提交新代码供评审：先看真实 diff/测试，再写下一阶段增量提示词，不要凭空说已验证。

## 8. 设计原型的性质

配套 HTML 原型用于**验证 UX**：多类型文件、工作区/单文件、Tabs、文件树、命令面板、主题、查找、文本编辑和 Markdown Live/Split 的**交互示意**。其代码区域为浏览器模拟编辑容器，不是正式 CodeMirror；不提供真正 Tauri 文件系统读写，导入是浏览器 File API，保存通过下载。正式软件必须按文档 Phase 2–5 实现真实 CodeMirror + Rust 文件后端。

## 官方参考

- Tauri 2 文档：https://v2.tauri.app/
- CodeMirror 6 文档：https://codemirror.net/docs/
- CodeMirror Extensions：https://codemirror.net/docs/extensions/
- Vue 3：https://vuejs.org/
- JetBrains Fleet 设计参考：https://www.jetbrains.com/fleet/
- Fleet 发展说明（2025-12）：https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/
