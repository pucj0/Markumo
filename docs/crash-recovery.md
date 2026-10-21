# Crash Recovery — 未保存文档恢复

## 1. 范围与边界

恢复系统独立于 `last-session.json`：

- `last-session.json` 仍只保存文件 token/路径、标签、布局和 Markdown 模式，不保存正文。
- `recovery/` 只保存**脏文本文档**的最后一份有效正文快照。
- 恢复快照不是自动保存；任何恢复动作都不会写原文件，保存仍需用户显式执行。
- 支持普通 TXT/代码、Markdown Source/Live/Split、未命名草稿、多标签、多 Pane 和不同工作区。
- 同一文档在多个 Pane 中只保存一份正文；Pane 位置/模式作为元数据保存。
- 不保存 PDF/图片、ClassFile、Hex 只读内容和干净文档。

## 2. 数据位置与格式

目录：Tauri `app_data_dir()/recovery`。正式 Windows 默认为
`%APPDATA%\com.markumo.app\recovery`；测试使用独立的 app data override，不读写正式用户目录。

每个快照是自包含的 `{32 hex}.json`，不使用用户路径作为文件名：

```json
{
  "schemaVersion": 1,
  "id": "32位十六进制",
  "name": "note.md",
  "path": "E:\\work\\note.md",
  "text": "原始 Markdown/文本正文",
  "encoding": "UTF-8",
  "bom": false,
  "eol": "LF",
  "mode": "live",
  "panes": [{ "pane": "main", "mode": "live" }],
  "diskVersion": "文件打开时的原生版本",
  "diskSize": 1234,
  "diskModifiedNs": 1720000000000000000,
  "charCount": 1234,
  "updatedAt": 1720000000000,
  "checksum": "正文 UTF-8 字节的 SHA-256"
}
```

- `path` 只作展示/重新获取文件授权使用，绝不拼入快照路径。
- `text` 来自 DocumentManager 的 canonical `EditorState.doc`，Markdown 始终是原始 Markdown，不是 ProseMirror DOM/HTML。
- `encoding`/`bom`/`eol` 用于恢复草稿的后续保存。
- `diskSize`/`diskModifiedNs` 在保存快照时由 Rust 从原文件 metadata 读取，只用于启动时快速判断磁盘是否变化。
- `checksum` 覆盖正文 UTF-8 字节；`charCount` 另行核对。

## 3. Rust 存储与安全性质

实现：[src-tauri/src/recovery.rs](../src-tauri/src/recovery.rs)、
[src-tauri/src/commands/recovery.rs](../src-tauri/src/commands/recovery.rs)。

- **原子写入**：复用共享 atomic 写入器的 `write_conversion_checked` 入口（同目录临时文件、写入、`sync_all`、条件原子替换，所有可失败同步在提交前完成）。首次创建使用 `expected=None` 的无覆盖创建；更新先验证现有 JSON/校验和及当前磁盘版本，再携带该版本替换。不修改全局 `atomic::write_checked` 的冲突保护，也不原地覆盖快照。Unix 保证原子可见性，不额外声称断电后的目录项持久性。
- **事务串行化**：稳定的 `.recovery.lock` 使用操作系统文件锁，覆盖读取、更新、删除、清理及隔离，兼容共享 profile 的不同服务实例/进程；崩溃自动释放锁。锁文件不参与限额扫描，也不在 profile 存活期间删除。最低 Rust 版本为 1.89。
- **失败保护**：更新前确认目标仍存在，已删除的 ID 不允许被过期更新重新创建。预算检查排除正在更新的目标，保留它的最后有效版本；写盘失败返回错误，旧快照字节保持不变。
- **完整性**：schema、id、字符数、SHA-256 全部校验；损坏记录被重命名为 `.corrupt-<timestamp>` 并在列表中报告，不冒充有效快照。
- **限额**：最多 64 条、单条正文 8 MiB、总磁盘 64 MiB。按文件 mtime 从最旧开始清理，结果带 warning；写入失败/超限返回显式错误，前端 toast/面板显示，不静默声称已保护。
- **路径**：文件名只能是 32 位十六进制 id；原文件路径通过绝对路径、长度、无 `..` 校验，只作 metadata；没有任何 IPC 输出路径参数。
- **权限**：Unix 目录 0700、文件 0600；Windows 使用用户 profile 下的 app data ACL。快照正文不写日志、遥测或错误消息。
- **命令权限**：`recovery_list/read/save/delete` 只允许 `LaunchStore.owner()` 的主窗口；临时文件关联窗口不获得恢复记录读取权限。
- **无任意读取命令**：本阶段移除了“从恢复记录读取任意原文件”的通道；差异比较只使用当前会话已打开编辑器中的文本。

## 4. 前端调度与生命周期

实现：[RecoveryController.ts](../src/features/recovery/RecoveryController.ts)、
[RecoveryDialog.vue](../src/components/modals/RecoveryDialog.vue)。

- 订阅 `DocumentManager`，比较不可变 `Text` 身份；不按键序列化。
- 脏文本文档在最后一次变化后 **2.5 秒**生成快照；多个高频变化合并为一个 pending，同一个文档只保留最新正文。
- 组合期间（IME）不写；结束后重试。
- 保存成功：`FileController` 在 `snapshot.complete()` 接受后回调 `RecoveryController.onSaved`。只有当前文档已 clean 才删除对应快照；若保存期间又输入，保留并在 2.5 秒后写新快照。`generation` 处理保存/丢弃与进行中恢复写盘竞态。
- 文档明确丢弃：删除对应 active 快照。窗口明确“放弃修改并关闭”：先 flush 最新快照，再 `discardActive` 删除本会话所拥有的快照；未处理的旧记录继续保留。
- 正常关闭/更新准备：`flushCloseState` 先 flush 恢复 pending，再持久化设置/会话；异常退出保留最后有效快照。
- 启动：主窗口在会话恢复完成后调用 `recovery.start()`；仅当存在记录时自动显示恢复面板，普通使用没有额外弹窗。状态栏提供“可恢复 N”入口，关闭面板不等于删除。
- 所有权：启动列表是 unclaimed；路径匹配不会认领。只有用户明确恢复，或当前会话新创建的快照，才成为 document ID 对应的 active recovery。普通保存仅清理该文档拥有的 active ID，同路径旧记录、其他文件和其他 Pane 的文档不受影响。
- 加载磁盘前的检查点：清除旧成功回执，强制刷新精确的当前 Text，取得本次写入的成功回执后才允许继续。成功后解绑为 unclaimed，并立即出现在恢复列表；加载失败、后续普通保存和窗口放弃当前修改均不删除它。检查点失败或写入期间继续编辑时，保留本地正文并阻止加载。
- 恢复：只有 clean 原文档的已授权版本与快照记录的 `diskVersion` 明确一致时才复用。原文件已变化、基线未知、已 dirty、已有 active recovery 或不可打开时创建独立 pathless 草稿（普通保存必须选择另存为目标）。恢复后强制 Dirty，并立即用同一 id 刷新快照。快照写入失败返回 `false`、显示错误并保留旧记录与已打开正文；重试只刷新当前正文，不重新应用旧内容或创建重复文档。
- 多 Pane：恢复时在现有 Pane 打开，或在只有单 Pane 时创建第二个 Pane；按快照的 pane/mode 恢复 Markdown 模式。
- 批量恢复：逐条处理，单条失败不阻止其他条；失败记录保留。
- 差异：只在当前会话已打开该文件时，对当前编辑器文本和恢复文本做有界行级 diff；不通过 IPC 读取任意路径。未打开时明确显示不能比较。

## 5. 快照清理规则

| 事件 | 行为 |
| --- | --- |
| 文档变为 dirty | 2.5s 后写/更新一份快照 |
| 文档保存成功且 clean | 仅删除对应 active 快照，不删除同路径 unclaimed 记录 |
| 保存期间继续输入 | 不删除；新内容再次快照 |
| 文档/窗口明确丢弃 | 删除对应/本会话 active 快照，保留 unclaimed |
| 恢复面板显式丢弃某条 | 删除指定 ID，失败可重新打开面板重试 |
| 应用异常退出 | 保留最后有效快照 |
| 恢复面板关闭/暂不处理 | 不删除 |
| 恢复完成 | 同一 id 立即刷新为新 Dirty 内容的快照 |
| 普通关闭窗口（保存或阻止） | 先 flush，确保最后输入有快照 |
| 更新准备/重启 | 保存成功的文档清理；未保存的保留 |
| 超限 | 清理最旧有效记录并报告 warning；无法清理时返回错误 |
| 损坏/半写入 | 隔离 `.corrupt-*`，不参与列表 |

## 6. UI

状态栏出现 `可恢复 N` 才显示入口。恢复面板是轻量列表，每行显示文件名、路径、快照时间、字符数、模式/Pane 数、原文件存在/删除/磁盘变化状态，操作为：

- 恢复
- 比较（仅当前会话已打开原文件时）
- 丢弃
- 暂不处理（关闭面板）
- 全部恢复

没有单独的恢复中心、没有持久侧栏、没有普通使用弹窗。

## 7. 测试

### Rust（`cargo test --locked`）

- 快照 round-trip、SHA-256、charCount、list summary。
- 损坏 JSON / checksum 不符的隔离与跳过。
- 临时文件不被当作有效快照。
- 超长正文、相对/越界路径、非法名称/ID 拒绝。
- 数量/空间限额清理最旧记录。
- 原文件存在/变化/删除的 disk state。
- 写入失败显式报错。
- Unix 目录/文件权限（条件平台）。
- 同一 ID 连续 A→B→C、重启后读取精确 C 和 SHA-256。
- 第二次写入在临时文件创建/写入/同步/替换处失败，上一有效快照字节不变；重试更新成功。
- 验证后发生竞争版本更新，旧写入失败且竞争版本 B 的有效正文保留。
- 不同服务并发更新、删除不复活、重启后继续更新，以及更新预算失败保留目标。

### 浏览器（`scripts/recovery-regression.mjs`，纳入 Smoke/Regression）

- 2.5s 防抖与高频合并；clean 文档不写；未命名路径为 null。
- 多 Pane 同一文档只写一条正文，panes=2。
- 保存成功清理；保存期间输入保留 dirty。
- 原文件存在时恢复、原文件缺失时创建 pathless 草稿、当前 dirty 时新建恢复草稿（不覆盖）。
- 写盘失败显式错误；关闭面板后再次打开记录仍在。
- B 写入进行中产生 C，随后 B 失败：磁盘仍为上一有效 A，但新排队的 C 不被删除，下一次刷新以同一 ID 持久化精确 C。
- 多文件 `restoreAll`；单条/全部 discard。
- 快速关闭 `flushForClose`。
- 恢复面板渲染、磁盘变化标签、关闭不删除。
- **真实 Markdown Live fixture**：Live 编辑 → 原始 Markdown 快照 → 恢复 Live 草稿；代码语言、图片路径、表格、公式、Mermaid 文本逐字保持。
- 暂不处理 → 多 Pane 编辑并保存原文件 B → 重新打开面板/重建控制器，原恢复稿 A 仍存在；显式丢弃只删除 A。同路径另一恢复稿及其他文件记录独立保留。
- 明确恢复后继续编辑更新同一 ID、成功保存后清理；恢复写入失败返回 false，重试保留用户新编辑；原文件版本变化时创建 pathless 草稿，取消另存为不写原文件也不清理恢复稿。

### 原生（`scripts/recovery-native-regression.mjs`）

真实 release、独立 app data/profile：

1. 新建未命名文本，输入 marker，等待防抖，确认恢复目录 JSON 含 marker。
2. 强制终止进程。
3. 重启 → 恢复面板出现；选择“暂不处理”，再次强制终止。
4. 再次重启 → 记录仍在；点击恢复 → 正文恢复且状态栏仍为 `未保存修改`。
5. 再次重启 → 恢复后的 dirty 内容仍有新快照，不能静默变成已保存。

这是最初实现的探针，只检查旧记录存在不足以证明刷新成功。P0 修复增加以下严格原生测试。

### 连续更新与数据安全原生专项

执行 `node scripts/recovery-update-native-regression.mjs`（Windows、Rust >=1.89、WebView2、pnpm install 后）。脚本自行构建独立 app ID/profile 的 debug 程序，不触碰正式用户目录，不 Mock Rust IPC。

1. 通过真实编辑器输入 A→B→C，每次读取磁盘 JSON，核对同一 ID、精确正文和 SHA-256；强制退出后重启读到精确 C。
2. 选择暂不处理，编辑并实际保存原文件 B；旧 C 仍在磁盘和恢复面板，再次重启仍可恢复。
3. 原文件基线已经变化，恢复到 pathless 草稿。将快照设为只读，从真实 Rust 写盘失败中检查返回 false、面板错误、旧 JSON 字节完全不变和原文件 B 未变。
4. 解除只读，继续编辑 D，核对同一 ID 的精确新正文；再重启读到 D。
5. 显式丢弃并验证 JSON 从磁盘删除；第五次启动面板为空。

专项还覆盖真实外部冲突：C 已成功保存后把快照设为只读，再强制刷新同一 Text，必须阻止加载磁盘；解除只读后加载成功，随后的普通保存不得删除 C。最终执行目录、正文 SHA-256、构建 SHA-256 与结果见[联合验收记录](recovery-external-data-safety.md)。

## 8. 验收命令与结果

```bash
pnpm typecheck
pnpm build
pnpm test:smoke
pnpm test:regression
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/recovery-update-native-regression.mjs
```

本次交付将恢复修复与 External File Change 集成，并将 `scripts/external-file-regression.mjs` 同时加入 Smoke 和完整 Regression。实际基线、首次暴露的问题、所有命令的最终真实结果见[联合验收记录](recovery-external-data-safety.md)。

## 9. 变更文件

新增：

- `src-tauri/src/recovery.rs`
- `src-tauri/src/commands/recovery.rs`
- `src/features/recovery/types.ts`
- `src/features/recovery/tauriRecovery.ts`
- `src/features/recovery/RecoveryController.ts`
- `src/features/recovery/diff.ts`
- `src/components/modals/RecoveryDialog.vue`
- `scripts/recovery-regression.mjs`
- `scripts/recovery-native-regression.mjs`
- `docs/crash-recovery.md`

修改：

- `src-tauri/src/lib.rs`（模块、store、命令注册、app data 配置）
- `src-tauri/src/commands/mod.rs`
- `src/editor/core/DocumentManager.ts`（恢复草稿/替换正文、bom/eol seed）
- `src/features/files/FileController.ts`（保存成功后回调）
- `src/app/useAppShell.ts`（控制器、启动、flush、discard、返回值）
- `src/App.vue`（恢复面板和状态栏入口）
- `src/components/layout/StatusBar.vue`
- `scripts/run-regressions.mjs`（Smoke/Regression 清单）

没有修改 `last-session.json` 协议、文档版本号、自动保存语义或原文件保存路径。

## 10. 风险与限制

1. 2.5 秒防抖窗口内的最后输入在强制断电/立即 kill 时可能丢失；正常关闭路径会 flush，异常退出只能保证“最后有效快照”。
2. 单文档超过 8 MiB 或总快照超过 64 MiB 时不写入，并显式提示；这是保护磁盘而非静默丢弃。极端大文档仍可能没有恢复保护。
3. 恢复只针对主会话窗口；现有架构中的文件关联临时窗口不参与恢复，这是与 `last-session.json` owner 模型一致的边界。
4. 面板磁盘“是否变化”标签使用 size+mtime 快速判断；同 size 且同 mtime 的替换可能漏报。实际恢复复用必须匹配快照记录的原生文件版本，普通保存继续走既有条件写入保护。
5. 差异比较只使用当前会话已打开的编辑器内容，不能对未打开路径做任意读取；未打开时明确显示不可比较。
6. 不恢复完整 Undo/Redo 历史，只恢复 canonical 正文、模式、Pane 和必要元数据；恢复后正文正确性优先。
7. Windows 权限依赖用户 profile 的 app data ACL；没有额外使用 ACL API 重写 DACL。Unix 使用 0700/0600。
8. 损坏快照会被隔离而不是尝试部分恢复；这是安全优先的行为。
9. 恢复快照不是自动保存；任何时候都不会自动覆盖原文件。原文件被外部修改时，恢复后仍需用户显式保存。
10. UNC/网络/设备路径会作为原路径 metadata 保存，但启动列表不会对其做 metadata 请求（避免 UNC 认证/网络阻塞），因此这类记录会显示为不可用并按 pathless 草稿恢复；用户仍可另存为到网络位置。
11. 未实现跨进程多窗口共享恢复 UI；主窗口恢复列表是唯一入口。

## 11. 交付提交

提交信息：`fix(recovery): resolve snapshot lifecycle and external reload integration`。修改文件见联合验收记录。

最终 Commit SHA 以交付回复中的 `git rev-parse HEAD` 为准；本文件不硬编码 SHA，避免提交内容包含自身哈希导致不一致。未 push、未创建 Tag、未修改版本号。
