# Markdown Live 工具栏

## 位置与显示条件

`MarkdownLiveToolbar.vue` 挂在 `EditorPaneItem` 的 Breadcrumb 之后、编辑正文 `.pane-document` 之前，是固定的 flex sibling，不随正文滚动，也不覆盖正文。仅当：

- 当前 Pane 的活动文档是 Markdown；
- 当前 Pane 模式为 `live`；
- `manager.liveReady(pane)` 为真（Live 编辑器已完成挂载）；
- 设置 `liveToolbar` 未开启隐藏；

时显示。源码/双栏、非 Markdown、超预算文档均不显示。现有 `MarkdownModeSwitcher` 保持在编辑区右上方，工具栏不会替换或移动它；代码块语言选择器位于编辑器内部，工具栏在其上方且不重叠。

## 状态与命令

组件不保存第二套文档模型，只调用 `DocumentManager` 的 Pane 定向 API：

- `markdownToolbarState(pane)`：由 Live controller 的 `toolbarState()` 提供 heading、bold、italic、strike、inlineCode、link、quote、列表、任务、codeBlock、inCodeBlock、hasYaml、readOnly、composing，并补充 canonical history 的 undo/redo 深度。
- `formatMarkdown(format, pane)`：复用现有 ProseMirror 命令；源码 fallback 复用 `markdownFormatTransaction`。
- `markdownHistory(forward, pane)`：复用 canonical CM undo/redo。
- `insertMarkdown(command, pane)`：复用 controller 已有 `insertReference`（脚注/链接引用）、`insertBlock`（公式、TOC、YAML）。
- `liveReady(pane)`：用于避免 Live 异步加载期间的假工具栏。

所有命令显式携带 `pane`，组件实例也只读取自己的 Pane；不会以全局 active pane 代替目标 Pane。

## 交互

- 段落下拉：正文、H1-H6，显示当前 heading level。
- 文字：粗体、斜体、删除线、行内代码；`aria-pressed` 反映当前选区/光标 marks。
- 插入：链接、图片；列表：无序、有序、任务；块级：引用、代码块、表格、水平线；历史：撤销、重做。
- 更多：脚注、链接引用、公式块、内容目录、YAML Front Matter，以及窄窗口下被收纳的插入/列表/块级命令。
- 所有按钮都有 `aria-label` 和含快捷键的 `title`；`role=toolbar`，More 使用 `role=menu`/`menuitem`、`aria-haspopup`、`aria-expanded`。
- `mousedown` 不抢编辑器焦点；点击后用 `focusPane(pane, true)` 同步恢复编辑焦点，不使用延时 hack。选区由现有命令映射保留。
- 工具栏布局是普通流式高度；正文区域高度由 flex 重新计算。窄 Pane 通过 `@container` 隐藏 `.md-toolbar-wide`，把次要命令放进「更多」，不出现横向滚动条。
- 代码块内：所有富文本/块级格式化按钮禁用，撤销/重做仍可用；点击禁用按钮不会改动代码内容。只读：格式化和历史均禁用。IME：`composing` 状态及命令内部 composition guard 阻止修改。

## 设置

`EditorSettings.liveToolbar: boolean` 默认 `true`。前端设置快照/加载与 Rust `EditorSettings` 持久化字段同步；设置页 Markdown 区提供“显示 Live 格式工具栏”复选框。旧设置缺少该字段时使用默认值。

## 测试

`scripts/markdown-live-toolbar-regression.mjs` 使用真实 App + mocked Tauri IPC，覆盖：

- 工具栏位置、仅 Live、模式切换；
- 设置隐藏/恢复；
- 选区保留、heading/bold 激活、焦点恢复、canonical undo/redo、滚动时固定；
- 代码块禁用富文本但保留历史，语言选择器不被挤压；
- 只读禁用；
- 双 Pane 独立状态与目标 Pane 路由，窄 Pane 收纳且无横向滚动；
- More 中脚注、链接引用、公式、TOC、YAML 的真实插入与撤销。

该脚本已加入 Smoke 与完整 Regression 列表。
