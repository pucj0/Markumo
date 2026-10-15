# 四组主菜单重构 — 2026-10-14

用户授权 Phase 6 增量。主菜单保持“文件 / 编辑 / 格式 / 视图”；没有开始下一阶段、提交、推送或发布。上一条“无需测试”时停止了后续验证；接着用户明确授权工作区/编辑体验并要求测试，本轮已完成相关最终复跑，证据见 `WORKSPACE_EDITOR_UPDATE.md`。

## 迁移清单

| 旧入口 | 新入口 |
|---|---|
| 工作区一级菜单 | 文件 → 工作区 → 打开/添加文件夹、最近工作区、搜索、刷新。最近工作区再次折叠。 |
| 帮助 → 快捷键 | 右上设置 → 快捷键。 |
| 打开文档清单 | 主菜单移除；标签和命令面板继续可用。 |
| 最近文件逐项追加 | 文件 → 最近打开折叠子菜单，完整路径悬停；同名以父目录区分。 |
| 重复编码项 | 命令面板按编码打开/重开、另存 UTF-8。 |
| 大写/小写 | 命令面板，快捷键保留。 |
| 重命名/移动/删除/复制路径/文件管理器显示 | 树右键菜单；右键不直接重命名，删除仍需现有确认。 |
| 移除根 | 根右键菜单，保留文件与已打开文档授权语义。新工具栏需求另把忽略开关迁至根右键。 |
| 标签关闭其他/复制路径/分栏 | 标签右键；关闭其他逐个处理最后一份 dirty 文档，取消中止，保存失败保留。 |
| 重复主题/设置/布局/编辑模式按钮 | 主题与设置保留顶部；视图中保留侧栏/大纲/换行/MD模式/分栏/专注。删除顶部工作区名、重复文件名/模式按钮，路径仍在底栏。 |

`MenuNode` 独立判别联合支持 command/submenu/separator/checkbox/radio，稳定 commandId 接 `CommandRegistry` Map。动态 enabled/visible/checked 在模型中解析。`mainMenu.ts` 仅配置层级；业务命令在 shell/控制器，`AppMenu.vue`/`MenuPopup.vue` 不读写文件。可用项不依赖业务数组下标。

支持子菜单 hover/click、160ms 意图延迟、父子相邻通道、方向/Home/End/Enter、Escape 逐级返回、空/全禁用子菜单键盘焦点。 hover 不抢编辑器焦点，执行前恢复选区，弹窗全局单实例。菜单为内容适配宽度，窗口内翻转/夹取，短窗保留标题栏空间并纵向滚动，ResizeObserver 清理。

Markdown 的加粗/斜体/删除线/代码、H1–H6、列表、块、链接/图片迁移现有事务；表格新增真实 GFM 插入事务并支持撤销，非 Markdown/只读/IME 下禁用不适用命令。表格插入源语法，复杂列表/代码上下文仍按 Markdown 解析语义表现，不宣称富文本反向转换。

剪贴板通过 Tauri 官方 `tauri-plugin-clipboard-manager` / `@tauri-apps/plugin-clipboard-manager` 2.4.2，能力仅 read-text/write-text；浏览器使用系统 Clipboard API。已有权限失败提示，复制无修改；剪切先写成功，异步文档/选区/焦点变化或只读时取消修改。Native API 参考 https://v2.tauri.app/plugin/clipboard/ 。没有增加 UI 框架。该插件引入 Rust 平台剪贴板及图像相关传递依赖（锁文件新增37包），没有开放图像剪贴板权限。

快捷键版本3：Mod+B加粗、Mod+I斜体、Alt+1资源管理器、Mod+Alt+B侧栏、Mod+F查找、Mod+R替换、Mod+P快速打开、Mod+Shift+P命令面板、Mod+\分栏、Mod+W关闭。可辨识旧默认迁移；混合旧配置与显式自定义保留，新增动作选择空闲键，记录 customShortcuts。菜单/命令面板/顶部快捷显示读取同一配置，CodeMirror 默认重映射受全局捕获抑制。Mod+R在对话框中也阻止 WebView 刷新。平台匹配与显示区分 Ctrl / Command，macOS原生没有实机验收。

最初停止前前端121/121、Rust37/37、菜单8、剪贴板事务6、Markdown18、选区5、双Pane8通过；基础/原生脚本旧选择器失败，已迁移。最终相邻专项再复跑：149单元、38 Rust、基础9、菜单8、原生编辑13和工作区13均通过，typecheck/build通过。剪贴板专项使用控制提供者，没有覆盖用户系统剪贴板；Windows真实系统剪贴板交互与macOS/Linux原生仍待人工。

文件：`features/shell/{menuModel,mainMenu,clipboard,editorSettings}.ts`，`components/common/{MenuPopup,ContextMenu}.vue`，`components/layout/{AppMenu,TopBar,TabBar,TreeNodeItem,Sidebar,Breadcrumb,EditorContainer}.vue`，`components/modals/DiscardDialog.vue`，`app/useAppShell.ts`、`App.vue`、`editor/commands/clipboard.ts`、`editor/core/DocumentManager.ts`、`editor/markdown/formatCommands.ts`；Rust 插件注册/能力/锁文件、settings与workspace显示授权，以及对应模型/UI/原生测试。状态 REVIEW；未更新安装包。
