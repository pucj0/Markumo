# 外部文件变化与冲突处理验收报告

日期：2026-10-20。基线：`7448581`。实现分支：`codex/external-file-conflicts`。

原工作目录存在未提交的 Markdown/媒体工作，且在实施期间被另一个进程改写。因此实现与验收在独立 worktree 完成，未包含或回滚原目录的改动。没有 push。最终提交 SHA 见交付回复；本报告与实现同一提交。

## 1. 原因与改造范围

原有 Rust 条件保存能够阻止已知旧版本覆盖，但没有主动发现外部变化的通道。FileController 只显示短暂错误信息；AutoSaveController 的 failure Map 以 token/磁盘版本为键，会在版本变化、文档变干净或重新启用设置时清除。它不能作为持久冲突状态。原有 reloadFile 重建状态时未转移各 Pane 的位置与选择。

本次保留 Rust 每次写入时的版本校验，新增中央状态管理、原生监听、安全读取、四个处理操作及持久 UI；重用已有恢复、设置、原生另存和编辑器机制。

## 2. 监听方案

采用 `notify 8.2.0` 的 RecommendedWatcher；Windows 为原生目录通知，Linux 为 inotify，macOS 默认 FSEvents。应用只有一个共享实例，按已打开文件的父目录建立非递归订阅，文件映射包含窗口与 token。关闭最后一个文件引用后释放目录订阅；窗口销毁撤销该窗口的订阅和授权。

原生回调使用容量 256 的非阻塞队列；180 ms 合并窗口、有限路径集合、溢出后的全目标复查。读取事件不触发检查。前端再按文档合并提示、串行检查；每次稳定检查最多采样四次，采样间隔 120 ms，两次一致才读取/重载。重命名不猜测新路径，原路径失效时保留缓冲区。

原生与 DOM 窗口焦点通知均触发复查，5 秒节流。初始化、订阅或运行时监测失败会明确显示降级提示；焦点检查与后端保存校验仍然存在。网络盘、WSL 及平台事件丢失不能被宣称为绝对实时，焦点复查是补偿机制。[notify 官方说明](https://docs.rs/notify/8.2.0/notify/)

后端签发监测租约。新前端实例开始后，旧实例的延迟订阅/清理不能撤销新实例；HMR、dispose 与旧工作区异步结果分别由租约、订阅 generation、绑定身份及操作序列保护。

## 3. 接口与授权

FileGateway 扩展：`checkExternal(token)`、`readExternal(token, expectedVersion, encoding)`、`beginExternalWatch()`、`watchExternal(tokens, generation, lease)`、`endExternalWatch(lease)`、事件及焦点监听。对应 Tauri 命令为 `check_external_file`、`read_external_file`、`begin_external_watch`、`watch_external_files`、`end_external_watch`。

全部文件操作只接受当前窗口的现有 token。读取不创建授权、不修改保存基线、不更新 lastDiskVersion、不改变 Dirty、不写原文件，也不改变 Hex 授权语义。保留大小/编码/BOM限制，读取前后验证版本；区分 deleted、permission、conflict、encoding、io 等错误。Windows 用不跟随 reparse point 的句柄及句柄最终路径验证；Unix 对规范路径逐级 openat/NOFOLLOW，避免父目录链接替换绕过授权。读取后再次检查路径和文件身份。

`prepare_target` 在后端拒绝将原文件作为另存目标，包含可识别的同一文件身份别名；前端也检查路径。保存既有目标仍使用选定版本条件检查，未提供 force/null 绕过接口。

## 4. 中央状态机

每个稳定文档 ID 只有一份状态，共享到所有 Pane。记录 token、路径、已知/检测版本、本地修改序号、检查时间、操作、冲突有效性、提醒折叠状态和错误。

| 状态 | 含义/后续 |
|---|---|
| normal | 可按原条件版本保存 |
| checking | 稳定验证期间阻止原路径保存 |
| changed-clean | 外部变化但没有本地修改；按设置自动加载或等待用户 |
| conflict | 本地修改与磁盘变化并存，保存暂停 |
| deleted | 原路径被删除/移动，保留缓冲区和另存入口 |
| unavailable | 读取、编码或稳定性验证失败，保留缓冲区 |
| resolving | 加载准备、确认或读取期间锁定操作 |

通知条折叠不改变状态。标签始终显示标记并能重新展开；普通输入、切换标签/Pane、配置自动保存、收到自己的保存事件都不能解除未解决冲突。

## 5. 四个操作

- **比较差异**：只读 CodeMirror MergeView，左磁盘、右编辑快照，行号、增删改高亮、共同滚动容器、前后变化导航及差异数量。显示获取时间、版本、编码/BOM/EOL；磁盘或本地变化后明确提示刷新。最多保存一个对比快照。
- **保留当前**：仅折叠提醒；文本、Dirty、历史、光标、滚动、保存基线及 lastDiskVersion 不变，Ctrl+S 仍被保护。标签入口在检查进行时也能重新展开提醒。
- **加载磁盘**：显式确认，默认焦点为取消，提供先另存当前内容。确认绑定 token/本地序号/磁盘版本；确认后编辑、保存、IME 或磁盘变化使旧意图失效。已有恢复模块必须确认当前缓冲区已持久写入才允许丢弃；快照与后续正常保存解绑，防止被清除。重载保留标签、布局、模式和合理的各 Pane 选择/位置，并明确重置 Undo 历史。
- **另存为**：复用已有原生对话框和快照完成协议。保持编码/BOM/原始换行语义；取消、失败或继续输入不会丢文本。新绑定撤销旧授权和旧监听；仅保存快照仍等于当前缓冲区时清除 Dirty。原冲突路径在前后端均拒绝，既有新目标仍条件保存。

## 6. 版本与竞态

磁盘事件只是提示。最终读取/写入以 Rust 校验结果为准。文本版本的内容散列相同、仅时间戳改变时，只认可新的元数据版本，不改变文本/Undo/保存内容基线，不误报内容冲突。

所有异步接受点检查绑定身份/操作序列。自动加载还检查读取前的本地修改序号、Dirty、IME、保存和工作区操作。确认加载再次验证用户确认的磁盘版本；读取协议再验证一次。已关闭文档不会被晚到结果重建。两个 Pane 不各自维护磁盘副本。

外部解决操作计入窗口关闭/工作区操作的忙碌计数。实际保存依然在 Rust 临近写入时检查条件版本；Windows 原有保留文件身份的写入锁、回滚备份及非原子写入的既有边界没有被移除。

## 7. AutoSave

AutoSaveController 订阅中央状态并剔除被保护文档；FileController 的手动/自动保存入口再检查相同状态。failure Map 保留为一般错误的补充机制。状态仍被保护时，即使 failure Map 被版本/设置变化清空也不会重新写入；无关文档不受影响。另存新路径或成功加载后恢复正常自动保存。

## 8. Markdown、多 Pane 与特殊格式

文本来自 DocumentManager/CodeMirror 的规范模型和换行序列化器，不使用 ProseMirror HTML。重载继续使用现有状态/视图机制，转移各 Pane 模式、反向选区、多光标及滚动位置。源文件中的 fence、Mermaid、公式和相对图片引用不做转换；Split 随共享模型更新。

图片/PDF/ClassFile 不走文本 Diff 或文本保存；媒体重载按磁盘版本重新挂载查看器并保留阅读状态。Hex 沿用可逆字节保存，禁用文本 Diff。恢复模块不支持的 Hex/超出恢复预算或未启动恢复的窗口，脏缓冲区加载必须先另存，不能假装已获得恢复保护。

## 9. 修改文件

新增：

- `src/features/files/ExternalFileChangeController.ts`
- `src/components/layout/ExternalFileBanner.vue`
- `src/components/modals/ExternalFileDiff.vue`、`ExternalFileDialogs.vue`
- `src-tauri/src/files/external.rs`、`external_tests.rs`
- `scripts/external-file-regression.mjs`、`external-file-native-regression.mjs`
- 本报告。

调整：FileController、AutoSaveController、contracts、tauriFiles、DocumentManager、RecoveryController、WorkspaceController、useAppShell、useShellPreferences、editorSettings、App、EditorPane/EditorPaneItem/TabBar、SettingsModal、Rust files/mod/media、commands/files/settings、lib、依赖锁文件、回归运行器及 testing.md。

## 10. 依赖与体积

新增 JS 依赖 `@codemirror/merge 6.12.2`（MIT），没有引入其他编辑内核；按需加载比较 UI。[官方许可/项目](https://github.com/codemirror/merge)

新增 Rust 直接依赖 `notify 8.2.0`（CC0-1.0），锁文件新增 7 个跨平台包。部分平台依赖在 Windows 上不会编译进程序。

同机同工具链将基线 `7448581` 导出到独立目录构建，与当前 dist 比较全部输出文件：

| 项目 | 基线 | 实现后 | 增量 |
|---|---:|---:|---:|
| 输出文件数 | 377 | 379 | 2 |
| 原始字节 | 12,606,703 | 12,658,216 | 51,513 |
| 逐文件 gzip 字节合计 | 5,480,124 | 5,497,856 | 17,732 |

这测量的是前端资源，不是安装包。未制作前后两套签名安装包，Rust 链接/安装包增量没有测量，不以 dist 数字代替。

## 11. 实测性能与资源

Windows、调试构建、真实 WebView2、独立 identifier/profile、临时文件，单次专项运行；同时可能存在其他测试负载，不能用这三次样本宣称所有平台达到延迟上限：

- 三次写入到编辑区域刷新：172.0 / 333.2 / 332.2 ms。
- Diff 打开后再次写入到过期提示：318.2 ms。
- 一个小文件、1 处差异的比较初始化：9.6 ms（包括 MergeView 构建，不是纯算法耗时）。
- 打开时真实计数：1 个共享 watcher、1 个目录、1 个文件；关闭最后一个文档后：1 个应用级实例、0 目录、0 文件。共享实例保持到应用生命周期结束，并非误报为零实例。
- 可控注入 100 个重复提示后，连同焦点补偿共检查 6 次、正文读取 2 次；未为重复提示逐次读取正文。
- 强制 GC 后 JS heap：9,372,948 → 12,292,016 字节，增量 2,919,068。包含首次加载 Diff、恢复和界面模块，不是 watcher 单独内存，也不是泄漏结论。未做长时间内存斜率或完整原生进程树峰值测量。

Diff 限制两侧合计 256 Ki 字符、20,000 行；算法 scanLimit=500、timeout=40 ms，超出预算不创建比较编辑器，算法降级时标注简化比较。计算仅由用户打开比较触发。[CodeMirror 预算接口](https://codemirror.net/docs/ref/#merge.DiffConfig)

## 12. 验收命令与证据

前端专项包含 30 组：主动提示、干净自动加载、Dirty、自己的保存、条件保存失败、Diff/过期、保留当前、过期确认、读取中编辑、另存输入/原路径拒绝、自动保存暂停/恢复、删除/重建、权限/编码错误、三种 Markdown 模式、跨 Pane 多选区、晚到关闭结果、旧 generation、预算、媒体、恢复、设置、IME、监测降级、无关文件及真实 UI 操作。

Rust 包含真实临时文件监听/原子替换/释放、跨窗口 token、读协议不推进旧保存授权、删除/重命名/重建、BOM/多种编码/混合换行/大小、链接拒绝、独占句柄错误、旧 HMR 租约及设置迁移测试。原有原子保存故障注入、窗口、恢复等测试继续运行。

Windows GUI 专项已通过：使用真实 Rust watcher/IPC/WebView2，自动加载、持久冲突、只读 Diff 两侧/过期、保留当前后 Ctrl+S 不覆盖、默认取消焦点、可靠快照后加载、原子替换、重命名及关闭订阅清理。

最终命令结果见本报告末尾验收记录。日志和截图位于独立 worktree 的 `test-results/external-*`，测试产物不入库。

## 13. 限制与排障记录

- Linux/macOS 原生 GUI 和平台构建未在本机执行；不能将 Windows 的结果宣称为三平台实测。
- 原生 Save As 对话框的选路本次未做 GUI 自动操作；其既有对话框被复用，新增协议由前端可控测试和 Rust 真实文件测试覆盖。
- 真实 IME 交互未人工验收；合成组合事件验证了相同的组合输入保护路径。实际文件 ACL 拒绝使用类型化错误注入，另有 Windows 真实独占锁测试。
- 网络盘事件可靠性、长时间压力、大文件最坏计算/内存曲线、安装包体积仍未测量。
- Cargo 首次下载出现 Schannel TLS 错误。通过 HTTPS 将缺失包放入标准 Cargo 缓存，再以锁定版本构建；没有关闭证书验证、替换依赖源码或提交本机配置。
- Windows 系统 Temp 曾拒绝测试文件创建；最终 Rust 验收使用此 worktree 下专用 TEMP/TMP。共享原目录 target 曾发生构建产物访问冲突，最终改为独立 target。
- 首轮完整回归因新 worktree 缺少媒体合成夹具而未通过；已用项目生成器生成隔离夹具并重跑，不修改真实文件。

## 14. 最终验收记录

| 命令 | 最终结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；保留原有大 chunk / Node 模块外置构建警告 |
| `pnpm test:smoke` | 18/18 组通过，123.55 s |
| `pnpm test:regression` | 29/29 组通过，197.75 s |
| `node scripts/run-regressions.mjs scripts/external-file-regression.mjs` | 最终 30 组专项通过 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 127 通过，0 失败，1 按原有声明忽略的公网网络测试；主程序/Doc tests 通过 |
| `node scripts/external-file-native-regression.mjs` | Windows GUI 专项通过；无 pageerror；关闭后目录/文件计数为 0 |

最终结论：已实现“外部修改即时检测 + 四种安全处理 + 防覆盖保护”。原生监听仍受操作系统/文件系统通知能力约束；未实测平台和性能项目按第 13 节保留限制。
