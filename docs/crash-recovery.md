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

- **原子写入**：复用 `files::atomic::write_checked`（同目录临时文件、写入、`sync_all`、原子替换）。崩溃最多留下临时文件，扫描只接受 `{id}.json`。
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
- 文档明确丢弃：删除对应快照。窗口明确“放弃修改并关闭”：先 flush 最新快照，再 `discardAll` 删除。
- 正常关闭/更新准备：`flushCloseState` 先 flush 恢复 pending，再持久化设置/会话；异常退出保留最后有效快照。
- 启动：主窗口在会话恢复完成后调用 `recovery.start()`；仅当存在记录时自动显示恢复面板，普通使用没有额外弹窗。状态栏提供“可恢复 N”入口，关闭面板不等于删除。
- 恢复：先读取快照；若原文件存在且当前会话有对应 clean 文档，复用其文件 token/版本并替换正文；若当前文档已 dirty，创建新的 `recovered-<id>` 草稿，绝不覆盖用户新编辑；原文件缺失/不可打开时创建 pathless 草稿（保存必须走另存为）。恢复后强制 Dirty，并立即用同一 id 写新快照。
- 多 Pane：恢复时在现有 Pane 打开，或在只有单 Pane 时创建第二个 Pane；按快照的 pane/mode 恢复 Markdown 模式。
- 批量恢复：逐条处理，单条失败不阻止其他条；失败记录保留。
- 差异：只在当前会话已打开该文件时，对当前编辑器文本和恢复文本做有界行级 diff；不通过 IPC 读取任意路径。未打开时明确显示不能比较。

## 5. 快照清理规则

| 事件 | 行为 |
| --- | --- |
| 文档变为 dirty | 2.5s 后写/更新一份快照 |
| 文档保存成功且 clean | 删除对应快照 |
| 保存期间继续输入 | 不删除；新内容再次快照 |
| 文档/窗口明确丢弃 | 删除对应/全部快照 |
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

### 浏览器（`scripts/recovery-regression.mjs`，纳入 Smoke/Regression）

- 2.5s 防抖与高频合并；clean 文档不写；未命名路径为 null。
- 多 Pane 同一文档只写一条正文，panes=2。
- 保存成功清理；保存期间输入保留 dirty。
- 原文件存在时恢复、原文件缺失时创建 pathless 草稿、当前 dirty 时新建恢复草稿（不覆盖）。
- 写盘失败显式错误；关闭面板后再次打开记录仍在。
- 多文件 `restoreAll`；单条/全部 discard。
- 快速关闭 `flushForClose`。
- 恢复面板渲染、磁盘变化标签、关闭不删除。
- **真实 Markdown Live fixture**：Live 编辑 → 原始 Markdown 快照 → 恢复 Live 草稿；代码语言、图片路径、表格、公式、Mermaid 文本逐字保持。

### 原生（`scripts/recovery-native-regression.mjs`）

真实 release、独立 app data/profile：

1. 新建未命名文本，输入 marker，等待防抖，确认恢复目录 JSON 含 marker。
2. 强制终止进程。
3. 重启 → 恢复面板出现；选择“暂不处理”，再次强制终止。
4. 再次重启 → 记录仍在；点击恢复 → 正文恢复且状态栏仍为 `未保存修改`。
5. 再次重启 → 恢复后的 dirty 内容仍有新快照，不能静默变成已保存。

结果：`test-results/recovery-native/results.json`，4 次启动、0 errors、`passed=true`。

## 8. 验收命令与结果

```bash
pnpm typecheck
pnpm build
pnpm test:smoke
pnpm test:regression
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

本机结果：typecheck PASS、build PASS、Smoke **17/17**、完整 Regression **28/28**（包含 recovery 与 Markdown Live toolbar 用例）、Rust **118 passed / 1 ignored**、clippy/fmt PASS。原生恢复探针 PASS（4 次真实启动）。

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
4. 磁盘“是否变化”使用保存时的 size+mtime 快速判断；同 size 且同 mtime 的内容替换可能漏报，恢复/保存时仍会以当前 FileService 版本显式处理。
5. 差异比较只使用当前会话已打开的编辑器内容，不能对未打开路径做任意读取；未打开时明确显示不可比较。
6. 不恢复完整 Undo/Redo 历史，只恢复 canonical 正文、模式、Pane 和必要元数据；恢复后正文正确性优先。
7. Windows 权限依赖用户 profile 的 app data ACL；没有额外使用 ACL API 重写 DACL。Unix 使用 0700/0600。
8. 损坏快照会被隔离而不是尝试部分恢复；这是安全优先的行为。
9. 恢复快照不是自动保存；任何时候都不会自动覆盖原文件。原文件被外部修改时，恢复后仍需用户显式保存。
10. UNC/网络/设备路径会作为原路径 metadata 保存，但启动列表不会对其做 metadata 请求（避免 UNC 认证/网络阻塞），因此这类记录会显示为不可用并按 pathless 草稿恢复；用户仍可另存为到网络位置。
11. 未实现跨进程多窗口共享恢复 UI；主窗口恢复列表是唯一入口。

## 11. 交付提交

提交信息：`feat(recovery): add safe unsaved document recovery`

最终 Commit SHA 以交付回复中的 `git rev-parse HEAD` 为准；本文件不硬编码 SHA，避免提交内容包含自身哈希导致不一致。未 push、未创建 Tag、未修改版本号。
