# 启动模式与 Last Session 专项（2026-10-15）

状态：REVIEW。仅覆盖启动、文件关联请求分流、欢迎/安全空状态、会话恢复和必要的窗口授权隔离；不开展 Split Tree 或 Markdown 新功能。保留任务开始时的全部未提交修改。没有提交、推送、构建/发布安装包或更改用户的 Windows 默认应用。

## 原因与结果

原先 `useAppShell` 无条件新建 Untitled，然后恢复 `workspaces.json`，再 drain 全局文件队列。single-instance 回调把文件加入全局队列并聚焦 main，因而文件启动会混入旧工作区，且打扰正在编辑的主窗口。

现在 Rust 先登记每个窗口的 LaunchKind，再经 `initialize_launch` 返回本窗口启动数据。前端按“设置 → 分类后的启动结果 → 根目录/有序真实标签 → 活动标签 → 监听外部拖放/自动保存”的顺序初始化，没有启动草稿。初始化期间快捷键创建/菜单业务操作被拦截。

| 场景 | 实现 |
|---|---|
| 有路径参数首次启动 | File Launch；只打开本批文件，单文件视图、侧栏隐藏，不读取 Last Session、不恢复旧工作区、不创建草稿 |
| 已运行时收到路径 | Rust 工作线程创建 `file-N` WebView 窗口；不把标签加入原窗口，不移动原窗口光标或替换其内容 |
| 无参数启动 | App Launch；从独立 Last Session 恢复根目录、真实标签顺序、活动文件和侧栏布局；无会话显示欢迎页 |
| 只有独立文件的 App Session | 恢复单文件模式和真实标签，不恢复最近使用列表中的其他文件 |
| 文件不存在/读取失败 | 原文件服务返回明确错误；保留可继续新建/打开的安全空状态 |
| 会话损坏/版本无效/部分历史缺失 | 损坏会话跳过；缺失标签逐一跳过，其他根和标签继续恢复，活动标签退到第一项 |
| Ctrl+O/应用内最近打开 | 沿用当前窗口；移除旧逻辑中根据“没有根目录”强制切到 single 的行为 |
| 关闭/保存保护 | 保留 dirty、IME、文件忙、保存忙保护；关闭检查前 flush 会话元数据和设置 |

## 存储与安全

新增应用数据目录 `last-session.json`，schemaVersion=1。存储 kind、roots、tabs[{path,encoding}]、activePath、layout{mode,sidebarVisible,sidebarWidth}。不使用 Recent Files 冒充打开标签，不记录文件正文和未保存草稿；这不是崩溃恢复存储。

`persist_session` 仅接受本窗口的文件 token、编码和布局，不接受任意文件路径。Rust 用仍有效且属于调用窗口的 grant 生成真实路径，并从本窗口 WorkspaceService 获取根目录。文件关联窗口既不创建前端 SessionWriter，也不能通过 Rust 检查写主会话。`persist_layout` 亦忽略临时窗口。

文件 token 增加 owner；每次文件 IPC 在互斥锁内设置实际调用窗口，不信任客户端 label。读取、重开、保存、另存为来源、图片授权、释放均保持窗口边界；销毁窗口时只回收其 grant。WorkspaceService 以窗口分开；临时窗口不写工作区历史存储。搜索取消键和事件订阅也按窗口隔离，避免两窗口相互取消搜索或接收对方目录事件。

恢复没有新增任意路径读写 IPC：仅从 Rust 固定位置存储的会话读取路径，重新经过 `checked_path`、工作区 guard 和原文件解码/大小/版本检查。会话文件路径已记录为 canonical，目标改变时跳过。保存使用已有版本检查和原子替换；损坏文件在用户作出实际会话改变前保留，不由语言包完成等通知重写。

限制：会话 JSON 512 KiB、100 个真实标签、16 个根；继续保留文件服务单文件 16 MiB、批量打开 20 项的保护。恢复有约 48 MiB 的累计文本预算（最多额外读取一个受单文件上限约束的文件）。并行窗口最多16个。共享文档多 Pane 的历史标签去重后恢复到当前单一标签组，本专项不引入分栏持久化。

旧的 `files.json`/`workspaces.json` 保留为各自历史，不被当作 Last Session。旧版本没有真正的打开标签快照，升级后首次无 Session 显示欢迎页，不猜测上次有哪些标签。

## 本专项修改文件

| 文件 | 用途 |
|---|---|
| `src-tauri/src/session.rs`（新） | 启动参数分类、窗口启动登记、schema/预算验证、Last Session 原子存储、从授权 token 生成会话 |
| `src-tauri/src/commands/session.rs`（新） | 分类启动初始化与主窗口会话保存 IPC |
| `src-tauri/src/commands/mod.rs` | 注册 session 模块 |
| `src-tauri/src/lib.rs` | setup 顺序、single-instance 独立窗口、窗口专属拖放队列及销毁清理 |
| `src-tauri/capabilities/default.json` | 将同一组现有最小桌面权限应用到 app-N/file-N 本地窗口 |
| `src-tauri/gen/schemas/capabilities.json` | Tauri 构建生成的对应窗口 capability 元数据 |
| `src-tauri/src/commands/files.rs` | 调用窗口授权上下文、专属 pending 队列、临时窗口布局写入隔离 |
| `src-tauri/src/files/mod.rs` | grant owner、专属释放、token 转已授权会话路径，移除已被窗口队列替代的全局队列 |
| `src-tauri/src/files/images.rs` | 已授权图片不得借用其他窗口的文件 grant；没有新增 Markdown 功能 |
| `src-tauri/src/commands/workspace.rs` | 每窗口工作区服务、授权调用上下文、搜索取消/事件隔离 |
| `src-tauri/src/workspace/service.rs` | 临时窗口可读取历史但不持久化覆盖主工作区历史 |
| `src/features/shell/launchSession.ts`（新） | 启动 IPC、元数据快照、去重/合并/顺序化 SessionWriter；无正文 IPC |
| `src/app/useAppShell.ts` | 移除启动草稿，分类初始化、活动文件恢复、会话监听/关闭刷新及 Ctrl+O 模式保持 |
| `src/features/workspace/WorkspaceController.ts` | 接收已在 Rust 验证恢复的根目录；不再启动时无条件 restoreCurrent |
| `src/features/workspace/tauriWorkspace.ts` | 复用真实 WorkspaceInfo 映射、当前窗口事件订阅 |
| `src/components/layout/WelcomePage.vue`（新） | 紧凑欢迎/加载状态，显式新建、打开文件和打开文件夹 |
| `src/components/layout/EditorContainer.vue`、`src/App.vue` | 接入欢迎页与加载状态，保留已有真实编辑器生命周期 |
| `tests/launch-session.test.ts`（新） | 标签快照、去重、顺序写入、合并与失败重试 |
| `tests/launch-session-ui.mjs`（新） | 生产欢迎页、显式新建、Ctrl+O 模式保持的浏览器检查 |
| `tests/launch-session-native.mjs`（新） | 隔离配置中的10组真实 Windows/Rust/WebView2 启动和会话检查 |
| `src-tauri/src/files/tests.rs` | 跨窗口 grant 拒绝、回收一个窗口不撤销其他窗口授权 |
| `docs/PHASE_PROGRESS.md`、本文件 | 范围、真实证据、人工缺项与限制 |

## 实际测试

| 命令 | 实际结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，15个文件、186个测试 |
| `pnpm build` | PASS；Vite 保留 Tauri API 静态/动态混用的分块提示，无编译错误 |
| `cargo check --offline --manifest-path src-tauri/Cargo.toml` | PASS，无 warning |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml` | PASS，49个 Rust 测试 |
| `node tests/launch-session-ui.mjs` | PASS，2组；Ctrl+O 使用生产快捷键/文件控制器，系统选择器明确是 IPC 合约 fixture |
| `node tests/launch-session-native.mjs` | PASS，10组，真实 Rust IPC、文件、WebView2、可执行程序路径参数和 single-instance 回调 |
| `git diff --check` | PASS |

原生证据：`test-results/launch-session-native/1792030774965/results.json` 和同目录 native.log。覆盖无会话欢迎、工作区多标签/活动顺序、四种文件外部请求、主窗口 dirty 不受干扰、临时窗口拒绝写会话/借用主 token、无效参数路径、退出重启、单独 File Launch 不恢复、历史缺失/损坏降级、独立文件会话重启。

NOT RUN：Windows Explorer 实际双击/“打开方式”注册交互、真实系统文件选择器、系统中文 IME、macOS/Linux、长时内存和崩溃恢复。没有执行安装/卸载/修改系统关联；不能把“可执行程序+路径及真实单实例回调通过”称为安装后的 Explorer 关联验收通过。其他历史 UI 脚本若假定启动即有 Untitled，应按新约定先显式新建再使用，不以旧启动约定作为本次验收标准。

## Windows 人工验收

1. 从最新开发构建无参数启动，无 Session 应看见欢迎页，不能直接输入到无文档编辑器。
2. 打开一个或多个工作区和两个真实文件，选择第一个标签，正常关闭后无参数重启，检查根、顺序和活动文件。
3. 主窗口保留未保存内容，在 Explorer 用 LightEdit 打开 TXT/MD/JS/BAT（需用户自行选择“打开方式”）；应出现独立单文件窗口，主窗口内容、光标、根和标签不变。关闭这个临时窗口后再次无参数启动，仍恢复主会话。
4. 删除一个历史 fixture 或将会话文件备份后改为损坏 JSON，确认可安全继续打开文件；不要用真实用户文件做破坏性测试。
5. Ctrl+O 时确认当前窗口模式、侧栏选择保持；未保存时退出选择“继续编辑”或取消保存，内容仍在。

完成门槛：自动化范围通过，标记 REVIEW；系统 Explorer 关联、IME 和跨平台人工项仍未验收，不标记 DONE。
