# 富文本复制与右键菜单

在「设置 → Markdown → 默认复制行为」调整：

- **当复制纯文本时复制 Markdown 源码**：默认开启。普通复制同时写入 `text/plain` 和语义化 `text/html`；文本目标得到 Markdown，支持 HTML 的目标得到富文本。关闭后，纯文本目标得到可见文字。
- **无文字选中时，复制或剪切光标所在的一整行**：默认关闭。开启后按逻辑行操作，不按屏幕自动换行切分。

两项设置通过现有首选项文件保存；旧设置文件自动使用上述默认值。多个富文本窗格共享设置，各自保留选区。

## 右键菜单

Markdown 富文本正文提供 Google 搜索、剪切/复制/粘贴/删除图标行，复制格式子菜单，格式图标行，标题子菜单和插入子菜单。正文源码模式、普通文本、媒体查看器以及嵌入的源码输入控件保留原有右键行为。

复制子菜单支持 Markdown、HTML 代码和简化格式；粘贴为纯文本会把 Markdown 标记作为字面文字插入。普通文本粘贴到富文本时解析为 Markdown。复制输出由文档模型生成，不包含工具栏、行号、编辑控件或事件属性。HTML 经过 DOMPurify 清理。

富文本正文快捷键（macOS 使用 Command）：

| 操作 | Windows / Linux |
| --- | --- |
| 复制为 Markdown | Ctrl+Shift+C |
| 粘贴为纯文本 | Ctrl+Shift+V |
| 一级至六级标题 | Ctrl+1 至 Ctrl+6 |
| 段落 | Ctrl+0 |
| 插入图像 | Ctrl+Shift+I |
| 插入表格 | Ctrl+T |
| 插入代码块 | Ctrl+Shift+K |
| 插入公式块 | Ctrl+Shift+M |

插入子菜单还支持脚注、链接引用、水平分割线、内容目录、YAML Front Matter 和上下段落。脚注、目录、公式、YAML 等继续使用现有扩展节点及其显示方式。

菜单支持方向键、Home/End、Enter、Escape，靠近边缘时调整位置。切换文档、外部同步、关闭编辑器、滚动、窗口缩放或失焦时清理菜单。异步剪切/粘贴发现选区或文档已变化时取消修改；关闭编辑器或切换到只读后不再写入。

## 实现与验证

- `LiveClipboard.ts` 统一系统复制事件和应用菜单命令；完整文档复制保留原始 Markdown，部分选区按文档结构序列化。
- `LiveContextMenu.ts` / `.css` 负责菜单布局、键盘操作和清理，沿用应用主题变量。
- `MarkdownEditorController.ts` 复用现有格式命令、文档桥接和撤销历史。`DocumentManager` 分发各窗格的首选项。
- 前后端首选项模型增加 `markdownClipboard`；Tauri 仅增加 `clipboard-manager:allow-write-html` 权限。
- 无新依赖，PDF.js 和富文本控制器仍动态加载。

执行 `node scripts/rich-clipboard-regression.mjs` 运行 14 项无界面浏览器验证（按现有测试约定可设置 `MARKUMO_PLAYWRIGHT_MODULE` 和 `MARKUMO_CHROME`）。测试使用隔离剪贴板，不读取或修改用户的系统剪贴板。截图和结果写入忽略目录 `test-results/rich-clipboard/`。

另已执行 `pnpm typecheck`、`pnpm build`、Cargo check/test（8 项通过），以及空 Markdown、发布控制器和 20 轮媒体切换回归。真实 Windows/macOS/Linux 应用之间的系统剪贴板互通仍需桌面人工验收。

## 大纲定位

左右大纲使用统一的 `DocumentManager.revealOutline`：点击后将标题滚动到当前编辑窗格顶部附近（24px 留白），重复点击和点击已可见标题也会对齐。源码使用 CodeMirror 的定向滚动效果，富文本只滚动所属的 `.markdown-live`，Markdown 双栏沿用源码与预览的滚动同步。

Markdown 标题提取按文档快照缓存，独立于 CodeMirror 的增量语法树，解决富文本模式下长文档后半部分标题遗漏。仍保留 1Mi 字符与 1000 项预算，代码符号大纲沿用原解析器。

`node scripts/outline-navigation-regression.mjs` 验证 5 组场景：远距离与重复点击、左右大纲、源码光标位置、双栏预览同步、左右分栏独立滚动。`scripts/outline-regression.mjs` 验证原有安全渲染和折叠行为。

额外检查了工作区原有的未提交多表格工具栏测试：第 4 项（第一张表格工具栏可见性）仍失败；使用本次修改前的控制器及原有排版改动重跑，同样失败。该既有问题与本次剪贴板和大纲定位修改分别保留。
