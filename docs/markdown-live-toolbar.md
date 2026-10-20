# Markdown Live 工具栏

## 位置与显示条件

`MarkdownLiveToolbar.vue` 挂在 `EditorPaneItem` 的 Breadcrumb 之后、编辑正文 `.pane-document` 之前，是固定的 flex sibling，不随正文滚动，也不覆盖正文。当前 Pane 的活动文档为 Markdown 时，Live/Source/Split 三种模式均显示；非 Markdown、超预算文档不显示。设置 `liveToolbar` 可整体隐藏工具栏。

工具栏已合并原编辑区右上角的独立 `MarkdownModeSwitcher`，不再存在 `.pane-mode-control`。模式切换使用分段式背景滑块；代码块语言选择器位于编辑器内部，工具栏在其上方且不重叠。

## 布局

- 高度 44px，横向填满 Pane；按钮 32×32，Lucide 风格 17px SVG，间距 4px。
- 左侧分组依次为：正文/H1-H6 下拉；粗体、斜体、删除线、行内代码；有序/无序/任务列表、引用；链接、图片、表格、代码块、数学公式；More。
- 右侧依次为：搜索与替换、内容宽度、Live/Source/Split 分段模式切换、大纲、折叠。
- 撤销/重做不占用工具栏按钮，保留原有快捷键和菜单功能。
- 工具栏是可折叠的普通流式高度；折叠后只保留右上角小型展开入口，不遮挡正文，展开/收起不改变编辑选区。

## 状态与命令

组件不保存第二套文档模型，只调用 `DocumentManager` 的 Pane 定向 API：

- `markdownToolbarState(pane)`：Live 下由 controller 的 `toolbarState()` 提供 heading、marks、列表、引用、codeBlock、inCodeBlock、hasYaml、live、readOnly、composing；Source/Split 从该 Pane 的 CM state（尚未挂载时使用其保存的 selection）读取 heading/list/quote，并标记 `live:false`。代码块通过 CM Markdown 语法树识别，覆盖反引号/波浪线围栏、未闭合及嵌套围栏、缩进代码块、跨块及多选区；任一选区与代码块相交即限制富文本操作。命令入口也执行同一保护。
- `formatMarkdown(format, pane)`：复用现有 ProseMirror 命令；源码 fallback 复用 `markdownFormatTransaction`。
- `markdownHistory(forward, pane)`：复用 canonical CM undo/redo；工具栏不放置按钮，快捷键与菜单仍可用。
- `insertMarkdown(command, pane)`：复用 controller 已有 `insertReference`（脚注/链接引用）、`insertBlock`（公式、TOC、YAML）；这些二级插入仅实时模式可用。
- `insertMarkdownTable(rows, columns, pane)`：实时模式创建真实 PM 表格；源码模式写入等尺寸 Markdown 表格。
- `markdownFind(pane)`：在当前 Pane 打开 Live/源码搜索面板。
- `liveReady(pane)`：保留用于 Live 异步加载判断。

所有命令显式携带 `pane`，组件实例也只读取自己的 Pane；不会以全局 active pane 代替目标 Pane。

## 交互

- 段落菜单：正文、H1-H6，当前值显示在触发按钮；键盘可打开、选择并回到编辑区。
- 文字格式：粗体、斜体、删除线、行内代码；`aria-pressed` 反映当前选区/光标 marks。
- 链接插入 `[链接](https://example.com)`，图片插入 `![图片描述](image.png)`；插入后直接打开对应行内 Markdown 源码编辑框，避免只留下不可编辑的占位文字。点击 Live 中的链接/图片占位也会重新打开该编辑框。
- 列表：有序、无序、任务、引用；插入：链接、图片、表格、代码块、公式。表格按钮打开 5×6 可视化尺寸选择器，hover/focus 预览，点击一次插入。
- 公式按钮打开只包含实际支持「公式块」的二级菜单，不提供无实现的占位项。
- More 菜单分组收纳脚注、链接引用、公式块、内容目录、YAML Front Matter，以及窄 Pane 下被收纳的格式/列表/插入命令、搜索、大纲和宽度预设。
- 所有按钮都有 `aria-label` 和含快捷键的 `title`；`role=toolbar`，菜单使用 `role=menu`/`menuitem`、`aria-haspopup`、`aria-expanded`。
- `mousedown` 不抢编辑器焦点；操作后用 `focusPane(pane, true)` 同步恢复编辑焦点，不使用延时 hack。选区由现有命令映射保留。
- 弹出层通过 Teleport 挂到 body，按触发按钮的视口坐标定位并钳制到视口内；保持原样式、最大高度和菜单内部滚动，避免 Pane overflow 裁切。关闭条件包括 Escape、点击外部、窗口/Pane resize、窗口 blur、外层滚动。菜单支持上下/左右方向键、Home/End、Tab 和 Escape；长菜单自动滚动显示焦点项，表格上下移动一行，输入滑块保留原生键盘行为。Escape 返回触发按钮，Tab 移到工具栏相邻按钮；不改动编辑选区和编辑区滚动。模式切换滑块遵守 `prefers-reduced-motion`。
- 响应式通过 ResizeObserver 测量真实 flex 项、文字、分隔线和工具占用，按列表→插入→搜索/宽度/大纲→段落→文字格式逐步收纳，保留 More、模式和折叠。没有固定视口断点；12px 展开迟滞避免边界像素误差引发反复收纳。保留 44px 单行，隐藏命令仍可从 More 访问。
- 宽度滑块在本地立即显示拖动值，通过 requestAnimationFrame 每帧最多提交一次偏好更新；change、blur、关闭弹层和组件卸载同步提交最后一个待处理值。设置预设使用相同入口。工具栏及 Pane 不直接重复调用 manager，只有应用偏好 watcher 更新 typography 并沿现有串行保存队列持久化；不重建编辑器、文档或历史。
- 代码块内：所有富文本/块级格式与表格/公式按钮禁用；搜索、模式、宽度、大纲、折叠仍可用；点击禁用按钮不会改动代码内容。只读：格式化禁用，导航/视图工具可用。IME：`composing` 状态及命令内部 composition guard 阻止修改。

## 设置

`EditorSettings.liveToolbar: boolean` 默认 `true`。前端设置快照/加载与 Rust `EditorSettings` 持久化字段同步；设置页 Markdown 区提供“显示 Markdown 格式工具栏”复选框。折叠是当前 Pane 的临时视图状态。

## 测试

`scripts/markdown-live-toolbar-regression.mjs` 使用真实 App + mocked Tauri IPC，覆盖：

- 44px 全宽布局、32×32 按钮、17px 图标、左侧分组、右侧工具、无旧 `.pane-mode-control`；- 设置隐藏/恢复；Live/Source 模式切换及滑块；
- 选区保留、段落菜单、bold 激活、焦点恢复、键盘 undo/redo、滚动时固定；
- 可视化表格尺寸选择、公式二级菜单、链接/图片可编辑 Markdown 语法；
- 代码块禁用富文本、语言选择器不被挤压；
- 只读禁用；
- 双 Pane 独立模式/工具栏状态、目标 Pane 路由、窄 Pane 收纳且无横向滚动；
- More 中脚注、链接引用、公式、TOC、YAML 的真实插入与撤销；
- 搜索/宽度/大纲/折叠，resize/blur 关闭弹层且不丢选区。
- Source/Split 的多种代码围栏及边界、多选区；同文件双 Pane 不同光标下的标题/列表/引用状态和命令路由；
- 连续高频宽度输入的逐帧合并、最终持久化、编辑器实例/选区/正文/滚动/Undo 栈不变；
- 240/320/480/768/1024px Pane、240px 视口菜单边界及命中测试、响应式边界抖动；
- 菜单方向键、Home/End/Tab/Escape、表格网格键盘移动；中文 composition 期间禁用命令和模式切换，Live/Source/Split 连续切换后的选区与 Undo/Redo。

该脚本已加入 Smoke 与完整 Regression 列表。

## 视觉检查

`test-results/toolbar-visual/` 保存了浅色/深色、正常宽度、窄窗口、左右拆分、多标签、Live/Source/Split、各弹层与折叠状态的 App 截图。检查环境为实际 Vue App + mocked Tauri IPC，编辑器内核与生产一致。

## 本次交互修复验收（2026-10-20）

审查基线为 `11366a7`；实际实现基于当前 HEAD `0afdede48071d1b49e19231d3e5ee3209ff037fe`，保留已有链接、图片、末尾段落和 CI 修复。隔离分支为 `codex/markdown-toolbar-refine`，未纳入共享目录中的恢复模块及用户文档改动。

新增 6 组专项，使本脚本共 18 组：语法树代码块边界、同文件双 Pane、连续宽度更新、5 种 Pane 宽度、菜单键盘导航、中文 composition 与连续模式切换。宽度组除确定性高频 input 外，还使用 Chromium 鼠标实际拖动滑块，并验证最终设置保存请求；Live 和 Source/Split 均检查实例、正文、选区、滚动及历史。响应式组检查真实尺寸、横向溢出、菜单边缘命中、视口边界、主题文字色及展开迟滞。

测试使用真实 Vue、CodeMirror 和 ProseMirror，Tauri IPC 采用 mock。中文测试使用包含中文数据的 composition 事件及编辑器命令，覆盖输入中保护与结束后格式化/撤销；未宣称验证系统输入法候选窗口或原生偏好文件落盘。

| 命令 | 最终结果 | 证据（工作区 test-results/） |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `toolbar-refine-typecheck.log` |
| `pnpm build` | PASS，Vite 43.70s | `toolbar-refine-build.log` |
| `pnpm test:smoke` | PASS，17/17，421.42s | `toolbar-refine-smoke.log` |
| `pnpm test:regression` | PASS，28/28，318.55s | `toolbar-refine-regression.log` |

专项结果写入 `test-results/markdown-toolbar/results.json`；五种 Pane 截图为同目录的 `pane-{240,320,480,768,1024}.png`。已实际查看 240px 和 1024px 截图。

构建仍有既有的大 chunk 及 Node 模块 externalized 提示，退出码为 0。首轮完整 Smoke 为 17/17（270.13s），其日志保留为 `toolbar-refine-smoke-first.log`；收尾修改后再次执行完整 Smoke 和 Regression，最终结果见上表。最终四条规定命令全部通过，工具栏专项共 18 组、浏览器错误为 0。

开发过程发现并修复了围栏缩进/引用前缀位置漏判、菜单尚不可见时聚焦失败、Teleport 后继承异常文字颜色及短视口菜单焦点不可见的问题。首轮旧滑块测试要求 input 后同步更新，改为等待新的逐帧更新结果，再断言精确值；并新增每帧调用次数、真实拖动、最后一个值持久化等更严格检查。选区测试使用浏览器原生 DOM 选区，并等待编辑器提交后采样，避免把尚未处理的 selectionchange 当作最终选区。首轮日志保留为 `toolbar-refine-focused-first.log`。

收尾的一轮测试与另一个工作目录的 Regression 同时运行，出现选区预置超时和 `1434` 端口占用；该轮已中止，未作为通过证据。日志保留为 `toolbar-refine-smoke-contention.log`、`toolbar-refine-selection-timeout.log`、`toolbar-refine-port-contention.log`。工具栏专项改用 OS 分配端口；完整复跑设置 `MARKUMO_TEST_PORT=16589`，为支持此配置的既有脚本隔离端口，未改变任何断言或超时要求。

修改文件：

- `src/editor/markdown/formatCommands.ts`
- `src/editor/core/DocumentManager.ts`
- `src/editor/markdown/wysiwyg/contracts.ts`
- `src/editor/markdown/wysiwyg/MarkdownEditorController.ts`
- `src/components/layout/MarkdownLiveToolbar.vue`
- `src/components/layout/EditorPaneItem.vue`
- `scripts/markdown-live-toolbar-regression.mjs`
- 本文档

独立提交：`fix(markdown): refine toolbar state and responsive behavior`；Commit SHA 由交付回复给出。未 push。
