# 工作区替换：协议、保存规则与回归报告

## 实现审查与复用

保留 `workspace/search.rs` 的工作区遍历、忽略规则、分批搜索、取消注册表和 Rust `regex` 引擎；替换预览调用同一 `WorkspaceSearcher::execute_search_roots`，不建立第二套全文索引或前端正则搜索器。搜索仍按行运行，批次为 32 条，最多 1000 处匹配，单文件最大 10 MiB，遍历最多 10 秒/10 万条目。大小写和 Unicode 全词边界共用 `compile_query`。

`SearchQuery` 增加可选 `directory`（已有目录的绝对路径）和 `buffers`（已打开可编辑文本的当前内容、路径及编码）。目录范围参与原遍历的剪枝，不能扩大授权工作区。已有 `include_ignored` 搜索选项保留；替换始终重新执行 `.gitignore` 和内置忽略检查，即使搜索中显示了忽略文件，也不会修改它们。打开文件的缓冲区覆盖磁盘搜索内容，包含“磁盘无匹配、未保存缓冲区有匹配”的情况。

`DocumentManager` 已有单一 CodeMirror 文档状态、多 Pane 同步、行尾跟踪和保存快照；新增入口沿用 `dispatch` 和 `isolateHistory`。`FileController` 已有保存/外部变化状态和自动保存互斥；批次期间使用其 `workspaceBusy` 保护，批次后恢复正常保存行为。

## 前后端协议

TypeScript 类型位于 `src/features/workspace/contracts.ts`，对应 Rust 类型位于 `workspace/search.rs` 和 `workspace/replace.rs`。

| 命令 | 输入 | 输出/效果 |
| --- | --- | --- |
| `preview_workspace_replace` | `query: SearchQuery`、`replacement: string`、`targets: string[]`（空数组为当前有界结果集合） | `ReplacePreview { files, skipped, limited, canceled }`；只读 |
| `validate_workspace_replace` | `path`、预览 `version`、相同 `query` | 重新检查当前窗口工作区授权、目录范围、忽略规则、普通文件及磁盘版本；只读 |
| `apply_workspace_replace` | `request: { query, replacement, path, version, selected: number[] }` | 实际写入的匹配数；每次只写一个未打开文件；失败返回原因 |
| `cancel_workspace_search` | 预览使用的 `searchId` | 复用窗口隔离的取消 token，停止预览剩余工作 |

`ReplaceFile = { path, version, buffer, edits }`；`ReplaceEdit = { from, to, line, column, before, insert, context }`。`from/to` 是从文本起点计算的 UTF-16 偏移，`line/column` 从 1 开始；Rust 内部的 UTF-8 字节范围不传给前端。未打开文件保留原始 CRLF/LF/CR，因此其偏移只用于展示，保存时由 Rust 重算字节范围；已打开文件使用 CodeMirror 的 LF 文本坐标。`selected` 为预览数组中从 0 开始的匹配索引，不是客户端提供的任意写入偏移。

预览与应用固定同一查询和替换值。搜索文字、范围、选项或替换值变化后必须重新预览。单个匹配和单个文件的“替换”按钮也先进入预览，通过选择集合表达应用范围。

## 正则契约

- 工作区搜索与替换统一使用 Rust `regex`，前端只显示和应用返回的编辑项。编辑器内独立的查找替换功能维持原实现，不参与工作区替换计算。
- 普通模式替换字符串完全按字面量处理，包括 `$1`。
- 正则模式使用 `Captures::expand`：`$0`、`$1`、`${1}`、`$name`、`${name}`，`$$` 表示字面量 `$`；不存在或未匹配的捕获组展开为空。含后缀时用 `${1}suffix` 避免最长名称解析歧义。反斜杠不提供 JavaScript 替换转义。
- 按行、从左到右、互不重叠；支持零宽匹配和 Unicode。正则不跨行，`^/$` 是每行边界；不支持 Rust 引擎不接受的环视和反向引用。
- 复用无回溯引擎，编译大小限 1 MiB、DFA 缓存限 2 MiB；在文件/行/匹配边界检查取消和时间。10 秒是协作式预算，单次正在运行的正则调用或系统文件 I/O 不能被抢占；不宣称硬实时超时。
- 共享 `scripts/fixtures/workspace-replace.json`：Rust 测试验证真实捕获展开与字节/UTF-16坐标；浏览器测试用相同向量验证 CodeMirror 事务和撤销。不存在另一套 JavaScript 工作区正则语义。

## 预览与写入规则

1. 侧边栏展开替换输入，展示文件数、匹配总数、每文件数量、上下文和逐匹配的删除/插入内容。全选、取消全选、按文件/匹配选择、文件折叠均在预览内完成。`Ctrl+Shift+F` 聚焦搜索，`Ctrl+Shift+R` 展开并聚焦替换；复用命令注册表和可配置快捷键，默认/Fleet 方案均绑定。Typora 方案仍保留原有搜索键冲突取舍。
2. 默认预览不写盘。前端和后端都不接收“替换全部并绕过预览”的 UI 操作。列表受后端最多 1000 匹配/1000 文件限制，预览区域独立滚动且最多占侧边栏高度 55%，每项展示前 500 字符并标明截断，完整替换值仍由协议保存。
3. 预览只处理当前窗口已授权工作区下的允许文件。每个路径及其祖先拒绝符号链接/Windows reparse point/目录联接；复用已有硬链接限制。PDF、图片及其他媒体通过扩展名和现有媒体内容识别跳过；二进制由原严格解码器跳过。
4. 编码沿用原严格解码/编码器，并要求源字节逐字节往返一致；不允许有损保存或自动切换编码。保留 BOM、现有行分隔符（包含混合行尾）；新插入的真实换行采用匹配所在行的分隔符或文件格式。默认闭合文件自动识别 UTF-8、带 BOM 的 UTF-16 和原有可无损识别的传统编码；已显式按编码打开的缓冲区携带当前编码，支持无 BOM 的 UTF-16。
5. 单文件输入/编码后输出最大 10 MiB，查询及替换字符串各最大 16 KiB，打开缓冲区和预览内容各有 32 MiB 总预算，单批最多 1000 匹配。捕获组展开前以捕获长度和引用数量计算保守的分配上界，超限拒绝；预览时间预算为 10 秒。达到预算会明确显示只处理了有界集合，不能冒充全工作区穷尽结果。
6. 已打开文件：保存预览时的 CodeMirror `Text` 身份、文档 ID 和授权 token；应用前重新验证路径及磁盘版本，返回后再次同步检查身份和只读/输入状态。文本发生编辑（包括编辑后撤销回原内容）都会使旧预览失效。应用为每文件一个隔离 Undo/Redo 单元，同步所有 Pane，仅修改缓冲区，保留 dirty 状态及现有编码/行尾信息；之后遵循用户原有保存/自动保存设置。
7. 未打开文件：持有当前窗口工作区与文件授权锁，拒绝任何窗口已有文件 grant 的路径。重新读取并核对包含内容散列/修改时间的版本；版本变化直接失败，要求重新预览。使用相同查询重新计算捕获及范围，检查选择项的有效性、重复项和输出预算，再执行原 `write_checked_preserving_identity`，不接收前端偏移作为磁盘写入范围。
8. 保存沿用已有权限、版本、路径和失败恢复保护。POSIX 使用现有临时文件原子替换；Windows 沿用保持文件身份的独占写入、备份和失败回滚。Windows 此路径不保证断电时的原子可见性；未引入新的持久事务日志。多个文件不具备全局原子性。

## 成功、失败、取消及限制

- 每文件记录“已修改缓冲区/已保存/失败及原因/已取消未执行”。一个文件失败不会把其他成功写入伪装成回滚；用户可按报告重新预览失败文件。未选中的文件不计为失败。
- 应用串行执行，显示完成进度；取消让剩余文件停止执行，已经发出的单个文件写入会完成或报告其失败。预览取消或迟到响应不会自动成为可应用计划。工作区切换/文件树变更会使预览失效。
- 批次结束后重新运行现有搜索，包含最新打开缓冲区；保留逐文件结果报告。重试需要重新预览。
- 提供打开文档的正常 Undo/Redo，不提供跨文件全局撤销，也不把底层临时回滚备份宣称为用户可用的跨文件备份功能。
- 范围输入目前使用已有目录的绝对路径，未增加 include/exclude glob 配置；原忽略规则继续生效。磁盘上已删除的打开文档及超出搜索文件预算的文档不进入替换。
- 无 BOM 的传统编码仍沿用已有自动探测；如需指定编码语义，先按指定编码打开文件。替换不会绕过原编码的无损往返检查。
- 原保存链路的操作系统级重命名竞争/断电限制继续存在；本功能不声称解决恶意进程在检查与系统调用间持续交换目录的全部竞争。

## 实际修改文件

- `src/components/layout/Sidebar.vue`：展开替换、目录范围、预览选择、差异及进度/结果报告。
- `src/features/workspace/WorkspaceController.ts`、`contracts.ts`、`tauriWorkspace.ts`：统一查询、缓冲区快照、预览/应用协议、取消和刷新。
- `src-tauri/src/workspace/search.rs`、`replace.rs`、`mod.rs`：原搜索扩展、同引擎预览和安全替换。
- `src-tauri/src/commands/workspace.rs`、`src-tauri/src/lib.rs`：窗口授权、文件 grant 互斥及命令注册。
- `src-tauri/src/files/mod.rs`、`media.rs`：仅开放已有严格读盘/编解码能力和媒体识别包装给替换模块；不另写保存器。
- `src/editor/core/DocumentManager.ts`：快照校验、隔离事务及多 Pane 同步复用。
- `src/app/useShellCommands.ts`、`src/features/shell/mainMenu.ts`、`keybindings/definitions.ts`、`keybindings/conflict.ts`：工作区替换菜单及快捷键。
- `scripts/fixtures/workspace-replace.json`、`scripts/workspace-replace-regression.mjs`、`scripts/run-regressions.mjs`：共享契约及专项回归纳入 Smoke/全量回归。
- 本文档：协议、安全规则、限制与验证记录。未修改应用版本或推送远程。

## 验证记录（2026-10-21，Windows）

测试使用系统 Chrome；系统默认临时目录拒绝访问，设置 `TEMP`/`TMP` 到 `test-results/workspace-replace-native/tmp` 后正常运行。测试生成的图标属于既有构建副作用，不纳入功能提交。其他任务的 Markdown 公式编辑器及 `测试.md` 改动不纳入本次提交。

- `pnpm typecheck`：通过。
- `pnpm build`：通过；现有 chunk 大小提示，无构建错误。
- `node scripts/workspace-replace-regression.mjs`：9 组浏览器专项通过；覆盖共享向量、打开缓冲区、部分选择、多 Pane 实际视图、撤销/重做、过期缓冲区、打开文件的混合行尾/BOM、空操作、文件在预览后打开、部分失败、取消、条件变化、快捷键、界面排除和 1000 项有界渲染。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：155 通过、0 失败、1 项既有 ignored；新增替换专项 10 项通过。
- `pnpm test:smoke`：24/24 脚本通过，无失败或跳过。
- 全量回归首轮 30/35；其中 4 项因另一个并行回归进程占用端口失败，1 项因测试期间源码热更新导致页面上下文销毁。保留 `regression-first.log`，不将这些失败记为通过；稳定后重新完整执行。
- `pnpm test:regression` 第二轮：35/35 脚本通过，0 失败、0 跳过；稳定源码后串行运行，并为支持环境变量的测试设置独立的 `MARKUMO_TEST_PORT=25169`。
- 最后一次 `cargo test --lib workspace::replace --manifest-path src-tauri/Cargo.toml`：10/10 专项通过，包含媒体伪装、目录范围、捕获组分配预算及无变化时不重写磁盘的检查。

原始日志位于 `test-results/workspace-replace-native/{build,rust-all,smoke,regression}.log`，浏览器专项结果与截图位于 `test-results/workspace-replace/`（测试产物按仓库原规则忽略）。
