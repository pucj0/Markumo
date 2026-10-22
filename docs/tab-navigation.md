# 标签页与路径面包屑验收

## 范围与基线

开始在 main 的 `a716a32` 上审查并扩展原有 TabGroup、DocumentManager 和 Split Tree，保留预览、双击固定、脏标记、拖拽排序/分栏、共享文档及会话恢复。没有引入第二套标签管理、文件读取 API 或 UI 库。

任务期间恢复系统独立提交 `5e28876a7582389d1c0436149932786310fe618a`，共享工作区中的 DocumentManager 修复也已随该提交进入 main。本次保留该历史，并以它为最终提交基线，不回退或混入恢复任务的其他文件。本次对 DocumentManager 仅追加首次显示时没有滚动快照的恢复保护，之前的快照与宿主接管修复沿用该提交。

## 同名区分与标签栏

`tabLabels.ts` 只接收 ID、名称、路径。默认显示文件名；同名组从两段路径后缀开始，逐步增加父级，直到后缀唯一。例如 `components/index.ts`、`utils/index.ts`、`tests/index.ts`。跨盘符且目录链相同的文件会保留盘符；同名工作区根也使用这个规则生成可辨识的根标签。Windows/UNC 比较遵循现有路径显示规范，POSIX 路径保留大小写，完整路径保留在悬停提示中。无路径的重名草稿用文档 ID 区分。

冲突集合是 DocumentManager 中所有实际打开的文档，跨 Pane 的同一文档只计一次。标签顺序仍由各 Pane 的 TabGroup 管理。Vue computed 用名称/路径签名缓存计算结果；编辑、脏标记和激活变化不会重算后缀。未保存点与关闭按钮预留宽度，避免输入导致标签宽度跳动。

横向滚动区与右侧固定菜单、新建按钮分离，拖拽边缘自动滚动继续使用原来的 TabDragService。只有活动 ID、标签顺序或容器尺寸变化时才检查活动标签可见性，普通编辑通知不把用户手动滚动的位置拉回。菜单可按名称/路径筛选，显示未保存标记，提供关闭入口；最多渲染 200 个匹配项，并提示继续筛选。

## MRU 与恢复规则

- `next-tab` / `previous-tab` 保留标签排列顺序，不修改已有自定义快捷键。
- 新增 `recent-tab`，默认 `Mod+Tab`：切到当前 Pane 最近使用的另一个标签；再次执行返回前一个标签。这里是两标签切回，不冒充按住 Ctrl 的多项循环选择器。
- `show-open-tabs` 打开当前 Pane 的文件菜单，可在命令面板/快捷键设置中使用，默认无额外快捷键。菜单按最近使用顺序排列。
- MRU 在现有 TabGroup 中只保存文档 ID，不保存编辑状态。预览替换、关闭和跨 Pane 转移会剔除失效 ID；会话恢复以活动标签优先，其余按恢复后的标签顺序初始化，不新增持久化格式。
- 关闭当前标签沿用右邻优先、没有右邻则左邻的规则。快速关闭后仅在原活动 Pane 且焦点落到 body 时恢复编辑器焦点，不覆盖对话框或其他 Pane 的焦点。

源编辑器切换后使用 CodeMirror 的 scrollSnapshot 恢复测量过的行与像素偏移，解决旧 scrollTop 写入被后续滚动锚点覆盖的问题。快照按文档和 Pane 保存，并校验 Text 版本；Live 捕获位置时清理源码快照。新文件或没有快照的位置在测量结束后转换成原生滚动目标，并校验导航版本和选区，不能覆盖随后执行的行号跳转；测试同时断言新文件顶部为 0 和立即跳到第 220 行后的真实可见坐标。Split Tree 在同一 Vue 更新中重挂宿主时移动原编辑器 DOM，保留原视图/插件；没有新宿主接管时在微任务中释放。正常卸载和 dispose 仍销毁监听器、视图及待接管记录。

## 面包屑架构与授权

App 提供轻量的 WorkspaceNavigation 上下文；Breadcrumb 复用已有 WorkspaceController 和 readDirectory/openFile/revealFileInTree。只有实际处于工作区模式且文档位于真实根目录内，才生成根目录和父级路径段。单文件模式、异常路径、工作区外文档回退为当前文件名，不合成虚构根。根切换、文件移动/重命名、Pane 失活会清除旧菜单。

目录只在点击时读取，不预遍历树。目录网关仍由 Rust 的 root_for_path / validate_under_root 检查授权、符号链接和实际路径；前端额外排除非直接子项、符号链接及含 `.` / `..` 的路径。展示字符串不作为授权。目录最多显示 1000 个安全条目，失败、空目录和截断均有明确反馈。异步请求有 epoch 和工作区版本检查，过时结果不能重新打开菜单。文件树的虚拟滚动容器禁用浏览器自动锚定，避免面板返回时把占位区偏移重复叠加到已恢复的位置。

NavigationPopup 由标签菜单与目录菜单共享，支持筛选、上下键、Enter、Escape、父目录按钮、点击外部关闭和焦点返回。监听器在卸载时移除。目录菜单可以打开文件或定位当前文件到工作区文件树，所有交互都不新增磁盘写操作。

定位入口通过 Sidebar 暴露的既有 locateCurrentFile 完成虚拟列表滚动和高亮，验证了 2200 项目录中第 1900 个文件确实进入可见区。异步定位会校验原文档、Pane 和工作区版本，切换后不展开陈旧目标；鼠标按下菜单动作时保持输入焦点，避免失焦先卸载菜单而丢失 click。

## 与大纲联动

Breadcrumb 复用既有 useDocumentOutline / useOutlineViewport，只提取活动 Pane 当前文档的结构。代码路径来自经过语言适配器确认的 `parentId` 和真实范围，Markdown 来自真实标题层级，最多展示末端三级。点击符号/标题沿用 revealOutline → revealPosition，不切换 Markdown 模式。未完成、超预算或不支持的解析器仅显示文件路径。

复用时补充了语法树快照选择：活动编辑器的 Text 与规范文档相同时，优先读取活动视图的实际增量解析树，避免 forceParsing 已完成但规范快照尚未推进时永久停留在“解析未完成”。没有另建解析器或后台索引。

## 验证与截图

独立命令：`pnpm test:tabs`。13 组真实浏览器检查覆盖三个重名文件、同名多根、中文和 Windows/UNC、100 标签、预览/固定/脏文件、滚动和宽度稳定、MRU/顺序快捷键、连续关闭、真实指针拖拽、同文件多 Pane、非活动 Pane 关闭、按需目录、键盘与失败反馈、陈旧目录请求、移动/重命名、保存元数据、结构导航、布局恢复以及深浅主题和窄窗口。滚动恢复断言实际 scrollTop 与选区，而非仅断言活动文件 ID。

初次专项检查确实发现滚动偏移漂移、目录在无关文档通知时关闭、已完成语法树不可见的问题，均修复后复跑。测试启动时补齐 Tauri mock 的 recovery_save 响应，避免无关的恢复快照错误污染 UI 截图。首轮 Smoke 为 30/31，文件树面板恢复失败；禁用虚拟列表自动锚定后原专项复跑通过。首次全量在菜单键盘改动期间加载了不一致版本，MRU 断言失败，该轮已停止，未完成项不记为通过。随后新增的盘符根目录用例又发现 `displayPathKey('C:/')` 未统一大小写的问题，已修复并通过专项复验。原始记录保留为 `smoke-before-fixes.log`、`workspace-check.log`、`regression-interrupted.log`、`regression-before-root-fix.log`。最终门禁结果待冻结代码后的完整执行记录，不将未运行项目标记为通过。

完整套件还暴露了两项不稳定性：源码 TableWidget 的既有点击断言曾出现 6 与 57 的偏移差异，在不修改其源码和断言的独立复跑中通过；冷端口的 Vite 启动器曾临时优化 `@tauri-apps/api/mocks` 并重载，导致页面混用 CodeMirror 实例和语言加载失败。回归启动器已预优化这个 fixture 依赖，真实冷启动大纲检查通过。记录分别保留在 `smoke-transient-table.log`（30/31）、`table-recheck.log`（复验通过）、`regression-cold-optimizer.log`（41/42）和 `docking-cold-check.log`（修复后冷启动通过）。没有为得到通过结果放宽选区、滚动或结构断言。

截图均为真实 App，不是静态 UI：

| 场景 | 图片 |
| --- | --- |
| 同名标签 | [same-name-tabs.png](images/tab-navigation/same-name-tabs.png) |
| 100 标签与文件筛选 | [dark-open-files.png](images/tab-navigation/dark-open-files.png) |
| 目录菜单 | [directory-menu.png](images/tab-navigation/directory-menu.png) |
| 目录错误反馈 | [directory-error.png](images/tab-navigation/directory-error.png) |
| 代码符号链 | [symbol-breadcrumb.png](images/tab-navigation/symbol-breadcrumb.png) |
| Light | [light-breadcrumb.png](images/tab-navigation/light-breadcrumb.png) |
| 多 Pane | [multi-pane.png](images/tab-navigation/multi-pane.png) |
| 窄双 Pane | [narrow-panes.png](images/tab-navigation/narrow-panes.png) |

## 修改文件

- `src/components/layout/{TabBar,Breadcrumb,EditorPane,EditorPaneItem,Sidebar}.vue`
- `src/components/common/NavigationPopup.vue`
- `src/features/tabs/{TabGroup,tabLabels}.ts`
- `src/features/workspace/navigation.ts`
- `src/features/shell/keybindings/definitions.ts`、`src/features/shell/pathDisplay.ts`、`src/app/useShellCommands.ts`、`src/App.vue`
- `src/editor/layout/TabDragService.ts`、`src/editor/outline/useDocumentOutline.ts`、`src/editor/core/DocumentManager.ts`（后者的前半修复已位于 `5e28876`，本次只追加无快照保护）
- `scripts/tab-navigation-regression.mjs`、`scripts/run-regressions.mjs`、`scripts/regression-server.mjs`、`package.json`
- 本报告及 `docs/images/tab-navigation/` 下的八张截图

没有修改独立 Rust Quality、版本号或远程仓库。
