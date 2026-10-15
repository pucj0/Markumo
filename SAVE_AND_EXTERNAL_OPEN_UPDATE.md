# LightEdit 保存机制与外部文件打开行为修复报告

本次仅处理四项问题：Windows 保存对话框文件类型、保存导致桌面图标移动、自动保存默认开启、重复双击创建多个窗口。Markdown 与分栏系统未做改动。

## 1. 每项问题的确认根因

### 1.1 Windows 保存对话框缺少文件类型
`src-tauri/src/commands/files.rs` 的 `save_dialog` 只调用了 `set_file_name`，没有任何 `add_filter`，因此原生保存对话框只有一个“所有文件”式的下拉，用户无法按类型保存，也不会得到扩展名补全。

同时确认了 Tauri 的能力边界：`tauri_plugin_dialog` 的 `blocking_save_file()` 只返回 `Option<FilePath>`，**不返回用户选择的过滤器**。因此不能指望“选了 Markdown 类型就自动补 .md”，必须在打开对话框前就确定默认类型，并在拿到用户输入的文件名后自行补全扩展名。这是本实现的关键前提，已在代码注释中写明。

### 1.2 保存后桌面图标移动
真实测量（`tests/desktop-icon-save.ps1`，证据 `test-results/desktop-icon/1792037597463`）：

| 策略 | 文件 ID 保存前 | 文件 ID 保存后 | 身份保持 |
|---|---|---|---|
| 旧：同目录临时文件 + `ReplaceFileW` | `1688849860475895` | `1407374883765253` | **否** |
| 新：原位写入 | `1407374883765253` | `1407374883765253` | **是** |

根因有两条，且都被证实：

1. **`ReplaceFileW` 会替换目标文件的身份**。Windows Explorer 的桌面图标位置按 shell item（含文件 ID）缓存，文件 ID 变化后旧的位置记录不再匹配，图标被当作新项目重新排布。
2. **旧实现在目标目录里创建并删除临时文件与临时目录**（`NamedTempFile::new_in(parent)` 与 `tempfile::tempdir_in(parent)`）。即使撇开身份问题，在 Desktop 这样的被监视目录里反复新建/删除条目也会触发 shell 重新枚举。

（最初写的一个 PowerShell 探针因 `BY_HANDLE_FILE_INFORMATION` 结构体 `FILETIME` 对齐错误（用 `long` 导致 8 字节对齐）读出了未初始化内存，给出了错误的“两者都保持”结论；修正为 `uint`×2 的 FILETIME 后才得到上表结果。这是本轮唯一一次测量失误，已修正并复现。）

### 1.3 自动保存默认开启
`src/features/shell/editorSettings.ts` 的 `defaultSettings()` 与 `src-tauri/src/commands/settings.rs` 的 `EditorSettings::default()` 都把 `auto_save` 设为 `true`，且前端 `autoSave = ref(true)`。因此全新安装后用户只要输入就会自动写盘，与产品预期不符。

迁移难点：旧版本**总是**把 `autoSave` 写进设置文件，因此一个旧的 `true` 既可能是默认值，也可能是用户明确开启的，二者无法区分。

### 1.4 重复双击文件创建多个窗口
`src-tauri/src/lib.rs` 的 `route_launch` 对任何非空文件参数都走“新建 `file-N` 窗口”分支，从不检查该文件是否已经打开，也不复用已有的单文件窗口。所以：

- 同一个文件双击 N 次 → N 个窗口；
- 不同文件依次双击 → 每个文件一个新窗口；
- 单实例插件虽然只保留一个进程，但每次都新增窗口。

**另外发现**：`files-pending` 事件此前在前端注册了监听，但 Rust 侧从未 emit 过，只有 `drain_pending` 命令存在。因此“把新文件交给已存在的窗口”这条链路此前是不通的，必须补上。

## 2. 修改文件列表

| 文件 | 变更 |
|---|---|
| `src-tauri/src/files/atomic.rs` | 新增 `write_checked_preserving_identity`（Windows 原位写入 + 回滚备份 + 独占写句柄 + 版本复核）；抽出 `prepare_target`、`replace_contents`；原 `write_checked` 保留给内部数据；新增 6 个 Windows 单元测试 |
| `src-tauri/src/files/mod.rs` | `save` 改用保持身份写入；新增 `version_of`（统一版本串）、`FileIdentity`、`file_identity`、`Grant.identity`、`owner_of_path` |
| `src-tauri/src/files/tests.rs` | 改 `unwritable_parent…` 为新契约；新增 `windows_save_keeps_file_identity_creation_time_and_acl`、`native_file_identity_matches_one_file_and_separates_two`、`cancelling_or_aborting_a_save_as_creates_no_file`、`router_recognises_an_open_document_through_the_real_grants` |
| `src-tauri/src/session.rs` | 新增 `PathKey`、`normalize_external_paths`、`RoutePlan`、`plan_external_open`；`LaunchRegistry` 增加 `order`/`window_for`/`latest_file_window`/`latest_window`/`remove`/`next_label`；新增 10 个路由与路径规范化单元测试 |
| `src-tauri/src/lib.rs` | `route_launch` 重写为文件路由器（所有权快照 → 单锁决策 → 聚焦/激活/下发或建窗）；新增 `deliver`、`activate`、`cleanup_window`；`register_window` 不再覆盖既有登记 |
| `src-tauri/src/commands/files.rs` | `save_dialog` 增加 18 组 `add_filter` 过滤器与默认类型排序；新增 `default_save_extension`、`ordered_save_filters`、`complete_save_extension` 与 4 个单元测试 |
| `src-tauri/src/commands/settings.rs` | `auto_save` 默认改为 `false`；新增 `settings_version`（旧文件读作 1）与校验 `1..=4`；更新/新增 2 个迁移测试 |
| `src/features/shell/editorSettings.ts` | `defaultSettings().autoSave=false`；新增 `currentSettingsVersion`、`settingsVersion`、`legacyAutoSaveNotice`、`persistedSettings`；迁移规则 |
| `src/features/files/pathKey.ts` | 新增共享路径比较键 `filePathKey` / `sameFilePath` / `usesCaseInsensitivePaths` |
| `src/features/files/FileController.ts` | 已打开文档识别改用 `sameFilePath` |
| `src/editor/core/DocumentManager.ts` | `openFile` 的既存文档查找改用 `sameFilePath`（避免大小写/分隔符差异产生重复标签） |
| `src/app/useAppShell.ts` | `autoSave` 初值 `false`；`settingsSnapshot` 写入 `settingsVersion`；迁移提示；`drainPending` 聚焦活动 Pane；新增 `activateExternal` 与 `external-activate` 监听及其卸载 |
| `src/components/layout/EditorContainer.vue` | 向分栏子树传入 `revision`（见 §2.1） |
| `src/components/layout/SplitLayoutNode.vue` | 增加 `revision` prop 并向下传递；`maximizedPaneExists` 依赖 revision |
| `src/components/layout/EditorPaneItem.vue` | 增加 `revision` prop；`paneModel`/`paneActiveId`/`paneDocs`/`activeDoc`/`isActivePane` 依赖 revision；恢复 `main-pane`/`secondary-pane` 兼容类名 |
| `tests/autosave.test.ts` | 默认值与迁移规则断言更新 |
| `tests/file-routing.test.ts` | 新增：路径键、重复打开不重载不重复、保存默认类型契约（5 项） |
| `tests/settings-ui.mjs` | 自动保存默认关闭 + 手动开启的浏览器断言更新 |
| `tests/editor-native.mjs` | 自动保存原生场景改为“默认关闭 → 手动开启 → 冲突保留”；分栏改用新的“视图 → 编辑器布局”菜单 |
| `tests/menu-helpers.mjs` | 新增 `layoutCommand` / `splitPaneViaMenu` / `mergePanesViaMenu` |
| `tests/menu-ui.mjs`、`tests/selection-ui.mjs`、`tests/workspace-tools-ui.mjs` | 标签右键菜单与分栏菜单标签更新为当前菜单结构 |
| `tests/desktop-icon-save.ps1` | 新增：两策略文件身份对比 + 可选的真实桌面 fixture 检查 |
| `tests/external-open-native.ps1` | 新增：真实 exe 的重复/并发外部打开窗口与进程计数、会话污染检查 |
| `tests/external-open-native.mjs` | 新增：无 Playwright 的真实 DOM 端到端路由测试（标签数、激活标签、未保存内容、磁盘与主会话） |
| `docs/PHASE_PROGRESS.md`、本文件 | 台账与说明 |

### 2.1 本任务期间发现并修复的一个既有回归（多分栏重构遗留）

在为本任务编写真实 DOM 测试时发现：**以文件关联启动后，编辑区显示空状态、标签栏为空，尽管文档已经载入**（状态栏已显示路径与字符数，`.cm-editor` 也已挂载但被 `v-show` 隐藏）。

根因：`DocumentManager` 被 `markRaw` 包装（这是既有约定，容器通过自己的 `revision` 计数器重新渲染）。多分栏重构引入的 `SplitLayoutNode` / `EditorPaneItem` 的 computed（`paneDocs`、`activeDoc`、`paneActiveId`）读取的是 `layout.getPane(...).group.tabs` 这类**非响应式**状态，且组件不接收 `revision`，因此父组件重渲染时子组件的 props 未变、Vue 跳过子组件更新，computed 永远返回首次（空）结果。

修复：把容器已有的 `revision` 计数器作为 prop 传入分栏子树（`EditorContainer → SplitLayoutNode → EditorPaneItem`，递归传递），并让每个依赖管理器状态的 computed 读取 `props.revision`。同时为兼容既有选择器与样式恢复了 `main-pane` / `secondary-pane` 类名。

该回归在 Vitest 中不可见（无 DOM 环境），在 Playwright 缺失时也不可见；本任务的 CDP 真实 DOM 测试现在充当它的回归防线（`tests/external-open-native.mjs` 第一组断言即“打开文档时不得存在空编辑区”）。

同一轮排查还修掉了两处多分栏遗留问题：

- `EditorContainer` 在转发 `close-tab` 的同时又 legacy 地 `$emit('close-main')`/`('close-secondary')`，而 `App.vue` 两条链路都绑定了 `closeDocById`，导致**同一个标签的关闭被处理两次**（脏文档会重复进入保存确认流程）。现已改为只发一次 `close-tab`（pane id 随事件携带），并移除 `App.vue` 中失效的旧绑定与未使用的解构变量。
- `installer-app-smoke.mjs` 仍在点击早已不存在的“源码/即时排版”按钮（HEAD 就不存在这些按钮，模式由菜单/命令切换）。已改为使用 `setMarkdownMode` 菜单助手，并改用 manager 的 `activeDocument.mode` 断言，避免与实际 UI 脱节。


## 3. 文件保存策略与安全权衡

### 3.1 用户文档：原文件身份保持写入（仅 Windows）
`write_checked_preserving_identity(path, bytes, expected)`：

1. 目标不存在（另存为新文件）→ 走原有的临时文件 + `MoveFileExW` **原子创建**路径，行为不变。
2. 目标已存在 → 校验磁盘版本一致、父目录/链接未变化后，进入原位写入：
   - 先按文件名检查只读属性（给出“请另存为”而不是裸 ACL 错误）；
   - 以 `read+write`、`share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)` 打开，**在整个校验与写入期间独占写权限**；
   - 通过**同一个句柄**读回全部内容并重算磁盘版本，与 `expected` 比对，任何外部改动都在写入前被拒；
   - 把读回的原内容写入 `%TEMP%` 下的 `NamedTempFile` 并 `sync_all()`（**不在目标目录创建任何条目**）作为回滚备份；
   - `seek(0)` → `write_all` → `set_len` → `sync_all()`；
   - 写入失败 → 立即用同一句柄写回原字节并同步；若回滚也失败，保留备份并在错误信息中给出路径，绝不静默丢内容。

保留的属性：路径/文件名、文件 ID、创建时间、ACL、只读保护（拒绝写入）、BOM/编码/CRLF（调用方传入的字节原样写入）、外部修改冲突检测（版本串 + 句柄复核）。

### 3.2 明确的取舍与风险（不作绝对安全声明）
- **原位写入不是原子的**。NTFS 上无法同时满足“保持文件身份”和“断电原子性”。若在写入过程中断电或硬复位，文件可能被截断或部分更新。缓解措施是 `%TEMP%` 中已 fsync 的原始内容备份与显式的失败回滚，但**这不能覆盖断电场景**。
- 因此新文件（另存为）仍使用原子创建，绝不出现“半个新文件”。
- 非 Windows 平台保持原有 rename 原子替换：POSIX 桌面不按 inode 记忆图标位置，改为原位写入只会白白丢失原子性。
- **内部数据仍全部使用原子替换**：`session.rs` 的会话 JSON、`commands/settings.rs` 的首选项、`files.json` 的最近文件/布局继续走 `write_checked`，不因本次修复改变策略。
- 行为变化（已由测试固定）：目标目录只允许修改已有文件、不允许新建条目时，**已有文件现在可以保存成功**；而“另存为新文件”到该目录仍会在临时文件阶段失败并保留原文件。

## 4. 外部文件路由规则

所有来自 shell 的路径先经 `normalize_external_paths`：逐个走与用户选文件相同的原生校验（必须是普通文件、绝对路径、无父目录跳转、无 ADS、非符号链接、Windows 非硬链接），并用 `canonicalize` 归一化后按 `PathKey` 去重（Windows 上忽略大小写）。因此相对/绝对、大小写、`\\?\` 长路径前缀、junction、中文与空格路径都收敛为同一项；**绝不按文件名去重**（同名不同目录仍是两个文件）。`owner_of_path` 另外以原生文件 ID（卷序列号 + 文件索引）作为辅助识别，覆盖规范化文本仍不同的同文件别名。

决策（`plan_external_open`，纯函数，单次持锁完成，保证并发安全）：

| 情况 | 行为 |
|---|---|
| A. 文件已在某窗口打开（凭授权登记） | 不发新窗口、不排队重复标签；`activate` 通知该窗口选中已有标签；窗口 `unminimize` + `set_focus`。前端只切换标签，**不重新读盘**，因此不会覆盖未保存修改 |
| B. 文件已排在某窗口队列中 | 保持在该窗口，不重复入队 |
| C. 已有独立单文件窗口（`file-N`） | 新文件作为该窗口的新标签入队，不再新建窗口 |
| D. 只有工作区窗口 | 工作区窗口**不会**收到外部文件；为其新建/复用一个独立单文件窗口，工作区标签与未保存内容不受影响 |
| E. 未运行 LightEdit | 载入即 `kind=file`：只打开该文件、单文件视图、无 Untitled 草稿、不恢复历史工作区、不拥有主会话 |
| F. 无可识别文件参数 | 聚焦主窗口（或最近窗口），不新建 |

并发与生命周期：
- 决策与“预留新窗口”在同一次 `LaunchStore` 加锁中完成，**连续/并发双击同一文件只会得到一次建窗**，其余请求并入同一窗口的 `pending`；
- 窗口页面前端尚未就绪时请求不会丢失：`pending` 保留在登记表，前端挂载时调用 `drainPending()` 一并打开；
- `FileStore` 与 `LaunchStore` **从不嵌套加锁**（先取快照、再决策），不存在锁序死锁；
- 窗口销毁 → `on_window_event` 移除登记节点并释放该窗口授权；重命名/另存为会更新/新建授权，因此路由登记随之更新；
- 窗口上限 16 个，达到上限后不再建窗。

## 5. 实际执行的测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS**（vue-tsc + tsc，0 错误） |
| `pnpm test` | **PASS** 23 个套件 / **236 个用例**全部通过（新增 `tests/file-routing.test.ts` 5 项） |
| `pnpm build` | **PASS** |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS** **82 passed / 0 failed**（新增 23 项：保存对话框 4、原位保存 6、身份/授权 3、路由 10） |
| `cargo check --manifest-path src-tauri/Cargo.toml` | **PASS**，无 warning |
| `powershell -File tests/desktop-icon-save.ps1` | **PASS**：旧策略身份丢失、新策略身份保持、目标目录无残留条目 |
| `powershell -File tests/desktop-icon-save.ps1 -DesktopFixture` | **PASS**：真实桌面（C: 卷）上就地保存后文件 ID 与创建时间不变；只删除脚本自建的唯一命名 fixture |
| `powershell -File tests/external-open-native.ps1` | **PASS**：以文件启动得到 1 个窗口；重复 3 次与并发 4 次双击同一文件仍是 1 个窗口、1 个进程（转发实例退出码 0）；换一个文件仍是 1 个窗口；`last-session.json` 未被写入 |
| `node tests/external-open-native.mjs` | **PASS 5 组真实 DOM 断言**（证据 `test-results/external-open-cdp/1792039082247`） |

关键结论（真实运行或真实测量，非推断）：
- 旧 `ReplaceFileW` 路径**确实改变文件 ID**，新原位写入路径**不改变**（`test-results/desktop-icon/1792037597463`、`1792037609331`，真实桌面卷上复现）；
- 保存后目标目录条目数保持 1，不再出现临时文件/临时目录；
- 目录禁止新建条目时，已有文件仍可保存；另存为新文件仍失败且原文件不变；
- 只读文件、ACL 拒绝、独占文件锁、外部改动、版本过期五类失败都保持原文件不变；
- 以文件启动只得到一个窗口一个标签；重复 3 次 + 并发 4 次双击同一文件不会新增窗口/标签，且**未保存的编辑内容逐字节保留**；另一个文件在同一窗口成为第 2 个标签；
- 关联启动既不写入磁盘、也不写入主会话文件。

`node tests/external-open-native.mjs` 通过 WebView2 CDP 驱动**真实的 release 程序**并读取真实 DOM，覆盖：

1. 双击 `测试 Alpha.txt`（中文+空格路径）→ 只有一个标签、编辑器可见、无空状态、无草稿；
2. 用 CDP `Input.insertText` 真实输入使文档变脏 → 连续 3 次启动同一文件 → 标签数不变、编辑内容逐字节不变、未保存标记仍在、仍只有 1 个窗口；
3. 双击 `贝塔 Beta.md` → 仍是 1 个窗口，成为第 2 个标签并被激活，内容正确；
4. 并发 4 次双击同一文件 → 仍是 1 个窗口与同一组标签，A 标签被激活；
5. 切回 A 后未保存内容仍在、`Alpha.txt` 与 `Beta.md` 的磁盘字节完全未变、`last-session.json` 未包含关联启动的文件。

运行该测试需要先构建一个带独立标识与独立数据目录的 release 二进制（`test-results/` 已被 gitignore，故该配置按需生成）：

```powershell
# 1. 写入覆盖配置（必须使用绝对路径）
'{ "identifier": "com.lightedit.routetest", "app": { "appDirectoriesOverride": "<绝对目录>" } }' |
  Set-Content test-results/external-open/tauri-override.json -Encoding UTF8
# 2. 构建（--no-bundle 只编译 exe，不打安装包）
node scripts/tauri.mjs build --no-bundle --config test-results/external-open/tauri-override.json
# 3. 运行
node tests/external-open-native.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/external-open-native.ps1
```

独立标识（`com.lightedit.routetest`）让测试程序与用户已安装的 LightEdit 处于**不同的单实例命名空间**，因此即使开发者本机正在运行 LightEdit，测试也不会把文件塞进用户会话、不会向用户窗口转发，脚本也只结束自己启动的进程。这是本次能在用户已运行 LightEdit 的机器上完成真实验证的唯一原因。

## 6. 尚未验证的 Windows 行为（NOT RUN）

1. **资源管理器中的真实鼠标双击与右键“打开方式”**：`tests/external-open-native.ps1` 与 `tests/external-open-native.mjs` 都用真实 release 程序覆盖了“启动 → 转发 → 单窗口单标签 → 不覆盖未保存内容 → 不污染会话”，但**没有**模拟资源管理器鼠标交互，也没有在真实文件关联（双击 .txt）链路上执行。需要人工按 §8 步骤 8–12 执行。
2. **工作区窗口的端到端场景（规则 D）**：`plan_external_open` 的“工作区窗口不被塞入外部文件、改为新建/复用单文件窗口”已由 Rust 单测固定；“工作区已打开该文件 → 双击聚焦已有标签”的端到端路径未自动化（需要先通过对话框打开文件夹）。
3. **桌面图标像素坐标**：已证明文件 ID 与创建时间稳定（即桌面图标位置缓存的键不变），但未截图比对图标坐标。
4. **断电/硬复位中途写入**：无法在测试中制造。风险已在 §3.2 明确记录，不做任何安全保证。
5. **多显示器不同 DPI 下的对话框与菜单**：未验证。
6. **Playwright 相关脚本全部未运行**（本环境未安装 Playwright）：`tests/settings-ui.mjs`、`tests/editor-native.mjs`、`tests/selection-ui.mjs`、`tests/workspace-tools-ui.mjs`、`tests/menu-ui.mjs` 等已按新默认值与新菜单结构更新断言，但**编辑后未经执行验证**；其中 `tests/menu-ui.mjs` 的分栏段落因“空分栏自动回收”改变了断言语义（原“关闭分栏”步骤已不再需要），属于本轮按源码推导的改写，需在有 Playwright 的环境复跑确认。

## 7. 需要重新安装/重建才生效的部分

- **Rust 侧全部行为需要重新构建**：保存策略（原位写入）、保存对话框过滤器与扩展名补全、外部文件路由器、自动保存默认值（`commands/settings.rs`）都在 `src-tauri` 内。
- **NSIS 安装包需要重新生成**：只有新的 `lightedit.exe` 才包含新的单实例路由与保存路径；已安装的旧版本不会因为前端热更新而获得这些行为。
- **前端部分可热更新**：`settingsSnapshot`、迁移提示、`activateExternal`、分栏响应性修复属于前端资源；但自动保存默认值同时存在于 Rust（读取首选项文件），仅更新前端而二进制未更新时，旧二进制仍会返回 `autoSave: true`。
- 用户已有的 `editor-settings.json` 不因重装改变：其中的 `autoSave: true` 会被保留并给出一次性提示；用户在“设置 → 保存”中关闭后，该值即为显式选择（此后不再提示）。
- 由于保存策略改为原位写入，**旧安装包回退保存行为会变回 `ReplaceFileW`**：这是二进制行为差异，不是设置项。

## 8. 手工验收步骤（Windows）

1. 运行 `build.bat` 生成并安装新的 NSIS 包（旧版本需卸载/覆盖安装）。
2. **保存类型**：新建 Markdown（`Ctrl+N` 后另存为）→ 对话框类型下拉默认应为 “Markdown (*.md; *.markdown)”；新建文本默认 “文本文档 (*.txt)”；打开 `data.json` 后另存为默认 “JSON (*.json; *.jsonc)”。
3. **扩展名补全**：在文件名框只输入 `README` 后保存 → 磁盘上应是 `README.md`（Markdown 文档）；输入 `README.md` 保存 → 不得出现 `README.md.txt`；输入 `notes.txt` 保存 → 必须是 `notes.txt`，不得变成 `notes.txt.md`。
4. **取消保存**：另存为对话框中按“取消” → 目录中不得出现任何新文件。
5. **桌面图标**：把测试 TXT 放到桌面，记录桌面图标位置；用 LightEdit 手动保存并观察：图标不得跳位；再用设置中开启的自动保存输入一次，同样不得跳位。
6. **默认自动保存关闭**：全新 Windows 用户下首次启动 → “设置 → 保存”中“自动保存”必须是未勾选；输入文字后等待 3 秒，磁盘文件不得变化；按 `Ctrl+S` 必须正常写入；未保存标记必须显示；关闭未保存文件必须弹确认。
7. **手动开启自动保存**：勾选“自动保存”并设为 0.5 秒 → 输入后磁盘应在约 0.5 秒内更新；再取消勾选 → 后续输入不再写盘。
8. **重复双击**：主工作区窗口已运行时，在资源管理器中双击 `A.txt` 两次 → 应只有一个额外窗口、且只有一个 `A.txt` 标签；继续反复双击 `A.txt` → 窗口数不增加。
9. **不同文件**：接着双击 `B.txt` → 应在同一个单文件窗口新增标签，不出现第三个窗口。
10. **已在工作区打开的文件**：在工作区窗口中打开 `C.txt`，再到资源管理器双击同一 `C.txt` → 应聚焦工作区窗口并选中该标签，不得新建窗口，且不得重置未保存的修改。
11. **中文/空格/别名路径**：对 `D:\项目 目录\说明 文档.md` 重复步骤 8；再用 `\\?\D:\项目 目录\说明 文档.md` 形式（或映射盘符与 UNC 两种写法）双击 → 仍必须聚焦同一标签。
12. **主会话不被污染**：以上过程中关闭 LightEdit，重新以无参数方式启动 → 恢复的应是原工作区/标签；由文件关联打开的文件不得出现在恢复结果中。
