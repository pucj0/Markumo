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

- `markdownToolbarState(pane)`：Live 下由 controller 的 `toolbarState()` 提供 heading、marks、列表、引用、codeBlock、inCodeBlock、hasYaml、live、readOnly、composing；Source/Split 使用 `sourceToolbarState()` 从 canonical source 的当前行推断 heading/list/quote，并标记 `live:false`。
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
- 弹出层关闭条件包括：Escape、点击外部、窗口 resize、窗口 blur；菜单有最大高度与滚动，避免被编辑区裁切。模式切换滑块遵守 `prefers-reduced-motion`。
- 响应式使用真实容器宽度：≤1040px 收纳列表；≤860px 收纳插入；≤580px 收纳搜索/宽度/大纲；≤440px 收纳段落下拉；≤360px 收纳文字格式。被隐藏命令仍在 More 中可访问，不出现横向滚动、第二行或布局抖动。
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

该脚本已加入 Smoke 与完整 Regression 列表。

## 视觉检查

`test-results/toolbar-visual/` 保存了浅色/深色、正常宽度、窄窗口、左右拆分、多标签、Live/Source/Split、各弹层与折叠状态的 App 截图。检查环境为实际 Vue App + mocked Tauri IPC，编辑器内核与生产一致。
