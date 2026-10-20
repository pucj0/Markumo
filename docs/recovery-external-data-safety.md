# Crash Recovery 与 External File Change 联合验收

日期：2026-10-20。用户基线：`ee458b4c19cfefa27a525c61fec4d8d07a26178f`。
实际起点为更新的 HEAD `2770ffd7bf1b187307de13893f13e65da2f46be1`，保留其链接/图片修复。
独立分支：`codex/recovery-external-integration`；不包含主工作目录尚未提交的 Markdown 末尾段落改动或用户文档改动。

## 实际根因及修复

1. **已有快照永远以 expected=None 写入。** 这只适合无覆盖创建，第二次写入必然触发共享原子写入器的版本冲突。现在更新前验证原记录及校验和，读取并复核当前版本，再条件原子替换。稳定的 OS sidecar 锁串行化读取、更新、删除、预算清理和隔离；被删除的 ID 不被过期更新复活。更新预算失败或写入失败保留目标最后有效记录。
2. **路径相等被误认为用户认领。** `reload()` 不再按路径关联；只有明确恢复或当前会话新写入的记录属于文档的 active ID。普通保存、窗口放弃修改仅清理当前文档/会话拥有的活动快照，未处理记录仍为 unclaimed。
3. **检查点错误地复用旧成功回执。** 先前保存过同一个 Text，随后强制保存失败，旧 `lastSaved` 仍可能满足检查。现在检查点和显式恢复均要求新的成功回执，并复核当前 Text、文档 token、generation 和返回快照 ID；失败或期间编辑即阻止丢弃本地内容。
4. **安全检查点解绑后不可立即发现。** 成功检查点转为 unclaimed，并直接加入恢复列表。后续加载失败、正常编辑/保存、暂不处理、再次启动都不会将它重新认领到原文件。
5. **读取完成后磁盘仍可能变化。** 读返回后再次比较磁盘版本，操作还需匹配原 token、文档绑定、localRevision 和 sequence；陈旧结果不应用到编辑器。未配置恢复保护时，脏文件加载默认拒绝。
6. **外部状态 UI 没有真正响应字段变化。** 原 `ExternalState` 是普通对象，computed 一直返回同一对象，隐藏状态变化不能可靠触发界面更新。改为 Vue reactive 状态，保留当前/再展开/确认操作可正常使用。
7. **统一测试此前漏掉外部修改用例。** `external-file-regression.mjs` 现加入 Smoke 和完整 Regression；首次完整 Rust 编译还暴露 `WatchStatus` 缺少 Debug，现补齐 Debug 派生以允许既有错误分支测试编译，未放宽断言。

`src-tauri/src/files/atomic.rs` 没有修改。恢复写入使用其既有 `write_conversion_checked` 入口：无覆盖创建与条件替换使用相同版本冲突规则，所有可失败同步在提交前完成。没有普通 fs::write 原地覆盖快照；校验和、Unix 0700/0600、Windows profile ACL、64 条/8 MiB 单正文/64 MiB 总额限制继续保留。新增 OS 文件锁使用 Rust >=1.89，并在 Cargo 中声明最低版本。

## 生命周期验收

| 事件 | 安全行为 |
| --- | --- |
| 启动发现 A，用户暂不处理 | A 为 unclaimed，路径相等不认领 |
| 原文件编辑并保存 B | 仅清理新编辑产生的 active 快照，A 保留 |
| 脏文件加载磁盘 | 新的精确检查点成功后才允许应用磁盘正文 |
| 已有成功 C，但本次检查点失败 | 拒绝加载，本地 C 和最后有效快照均保留 |
| 检查点写入中继续输入 | 原确认失效，新输入继续排队快照，不删除 pending |
| 加载成功后再编辑/保存 | 检查点仍为 unclaimed，不随新活动记录被清理 |
| 恢复旧稿时原文件已变化/基线未知 | 独立 pathless 草稿，普通保存需选择另存为目标 |
| 同路径另存为原冲突文件 | FileController 拒绝，释放临时目标授权，不写原文件 |
| 脏文件存在外部冲突 | AutoSaveController 与 FileController 两层暂停，切换设置或继续输入不解除冲突 |
| 显式恢复后成功保存 / 显式丢弃 | 精确清理相应 active ID / 指定 ID；失败记录可重新打开面板重试 |

FileController 和 AutoSaveController 现有保护经联合回归验证，本次无需更改其保存规则。

## 新增与加强的测试

真实 Rust（非浏览器 Mock）：同一 ID A→B→C，重启读取精确 C；临时文件创建/写入/同步/替换四处失败保留旧字节并可重试；验证与提交间竞争版本变化；并发更新/删除；预算失败保留目标；真实 FileService 外部读取后仍拒绝旧基线覆盖，恢复服务重启仍读取精确 C。

恢复浏览器回归：暂不处理→保存 B→重建控制器，A 保留；同路径/多文件/多 Pane 所有权；恢复后继续更新精确正文；失败准确返回 false，重试不覆盖新输入；新输入不被旧失败写入删除。

外部修改脚本现在使用真实 RecoveryController + FileController + ExternalFileChangeController + AutoSaveController，并由可控持久 transport 模拟确定性交错。新增 24–28 组验证连续更新、重启和显式恢复/丢弃、旧成功回执不能掩盖失败、写入期间编辑、读返回后磁盘再次修改、缺失保护拒绝加载、同路径另存为和自动保存封锁。浏览器 Map 不能证明 Rust 的原子替换行为，原子保证另由真实 Rust 与原生测试验证。

Windows 原生专项使用独立 app ID/profile、真实 WebView2、真实编辑器和 Rust IPC，核对物理 JSON 的精确正文/ID/SHA-256；只读目标产生真实写入失败。覆盖外部检查点失败阻止加载、成功加载后普通保存保留 C，以及五次启动间的恢复和显式删除。

## 命令及证据

证据目录：本工作区 `test-results/`。以下为最终实际执行结果。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `recovery-external-typecheck.log` |
| `pnpm build` | PASS | `recovery-external-build.log` |
| `pnpm test:smoke` | PASS，18/18，189.10s | `recovery-external-smoke.log` |
| `pnpm test:regression` | PASS，29/29，362.48s | `recovery-external-regression.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 131 passed / 1 ignored / 0 failed | `recovery-external-cargo.log` |
| `node scripts/recovery-update-native-regression.mjs` | PASS，5 次真实进程启动，0 errors | `recovery-external-native.log` |

首次执行观察到的失败：Rust 的 WatchStatus Debug 编译错误；外部修改 UI 在保留当前后未重新渲染，脚本等待查看处理选项超时。均已通过修改实际代码修复。专项复跑：external-file 28 组及 recovery 回归均通过，日志 `recovery-external-focused.log`。

首轮 Smoke 为 15/18：Live controller、Live toolbar、DocumentManager 在页面导航阶段超时（15 秒或 30 秒，尚未进入产品断言）。原日志保留为 `recovery-external-smoke-first.log`；保留原断言和超时设置，在编译完成后串行复跑，最终结果见上表。

原生证据：`test-results/recovery-update-native/mvgct9e6/results.json`，包含 `failedExternalCheckpointPreservedLocal=true`、`sameTextFailureNotMasked=true`、`externalReloadSucceeded=true`、`checkpointSurvivedOrdinarySave=true`、`passed=true`。同目录有恢复失败和旧稿保留截图。
原生构建 SHA-256：`37bd1840863a04d08ba3a9fec1a003b20e49e24230a9b4c5bcbcdc4bec19098c`。
精确 C 的正文 SHA-256：`c9cebc159ac3e50c652c70a0f824591a5f263cac244fce3e169cc75daca39e1c`；精确 D：`91775fc2a43a42f90fa9a45fa26dc6d276326a4dde990569101c05de96b232fa`。验证依据为每一阶段的正文与校验和，不是旧文件仍存在。

Rust 唯一忽略项为既有 `conversion::remote::tests::public_https_image_remains_compatible`（需要公网）。本机为 Windows；Unix 权限/目录同步分支和真实断电场景未在本机执行。本次前端构建含 chunk 大小及 Node 模块 externalized 提示，退出码为 0。

## 数据安全验收结论

本次要求的 Windows 数据安全场景通过：连续更新后重启读取精确 C；失败写入保留最后有效字节并阻止加载丢弃本地内容；未处理稿经过普通保存和再次启动仍可恢复，显式丢弃后才删除。恢复后可继续更新，安全检查点不会被后续普通保存清理，同路径另存为、冲突自动保存及加载期间再次变化均受到保护。最终五条规定命令及额外原生专项均无未解决失败；上述忽略项及平台覆盖限制仍适用。

## 修改文件与交付

- `src-tauri/src/recovery.rs`
- `src-tauri/src/files/external.rs`（Debug 派生）
- `src-tauri/Cargo.toml`
- `src/features/recovery/RecoveryController.ts`
- `src/features/files/ExternalFileChangeController.ts`
- `src/app/useAppShell.ts`
- `scripts/recovery-regression.mjs`
- `scripts/external-file-regression.mjs`
- `scripts/recovery-update-native-regression.mjs`
- `scripts/run-regressions.mjs`
- `docs/crash-recovery.md`
- 本文档

提交信息：`fix(recovery): resolve snapshot lifecycle and external reload integration`。Commit SHA 由最终交付回复给出，避免文档包含自身哈希。不要 push。
