# 磁盘检查与保存竞争修复验收记录

日期：2026-10-20。检查基准：`c427f992e226bdef3411118cc6610278a10dea85`。
实施工作区 HEAD：`414332925030f909671af59996d2d9d48d6a0506`。本次未覆盖原有 Quick Open 等未提交改动；测试期间检测到并行工作导致的工作区变动，见执行记录。没有改版本号、提交、推送或发布。

## 根因与修复

1. 原 `blocked()` 使用 `phase !== 'normal'`，把普通 checking 和临时读取错误一起当作冲突。现在只有已确认冲突或 resolving 阻止原路径保存；自动保存等待 check 完成的通知，手动保存直接进入 Rust 条件写入。
2. 检查启动时没有保存边界，旧结果会与保存完成后的新基线比较。保存开始即增加检查 sequence 并取消前端等待；成功后同步使用原生返回的版本，在任何异步恢复回调前发布权威基线。文档绑定对象、token、path、sequence 共同约束结果应用。关闭、另存为、重开和 dispose 使旧检查失效。
3. 原 check/saveFailed 将所有错误写成 `conflictValid=true`。现在普通 I/O、权限、占用、IPC 和不稳定读取保留为 unavailable；只有原生保存 conflict、已观察到的不同内容版本或删除产生持久冲突。已有冲突不会被普通成功检查、磁盘恢复旧内容、撤销或监测开关清除。
4. 已确认冲突保留 Banner 的比较、另存为、加载磁盘、保留当前操作；普通 checking 没有 Toast/Banner。临时检查错误明确显示“磁盘检查暂时失败”，保存仍由原生版本校验决定。冲突拦截只展开已有 Banner，不重复 Toast。Banner 的派生标题和按钮状态也跟随 operation/phase 更新。
5. 自动保存 I/O 失败最多重试两次，等待 1 秒、4 秒，随后暂停；编辑和开关自动保存不会重置失败预算。预算绑定 token 和成功保存的 saveRevision，只有 mtime 变化（含原生回滚后的 hint）不会重置预算。相同失败通知按文档 capability 和错误去重，手动保存成功后恢复。真实冲突立即暂停。
6. 保存后恢复记录回调失败不再把已完成的原生保存误报成保存失败或冲突。

## 状态与操作

| 状态 | 手动原路径保存 | 自动保存 | 退出条件 |
|---|---|---|---|
| normal | Rust 条件写入 | 正常调度 | 新的检查/操作 |
| checking，无冲突证据 | 取消旧检查等待后进入 Rust 条件写入 | 等检查完成通知，无轮询 | 检查完成、保存或绑定变化 |
| changed-clean / conflict | 阻止，展示持久 Banner | 暂停 | 明确加载磁盘或另存为新绑定 |
| deleted | 阻止 | 暂停 | 原文件恢复后仍需明确处理 |
| unavailable，无已确认冲突 | 允许重试 Rust 条件写入 | 有限退避重试 | 检查/保存成功 |
| unavailable，已有真实冲突 | 继续阻止 | 暂停 | 明确冲突处理 |
| resolving / confirm / 恢复快照写入 | 阻止保存、另存为和关闭 | 暂停 | 完成/取消；失败保留已有冲突证据 |

## 修改文件

| 文件 | 本次变更 |
|---|---|
| `src/features/files/ExternalFileChangeController.ts` | 冲突证据、检查取消/sequence、保存 revision、绑定生命周期及重载状态 |
| `src/features/files/FileController.ts` | 手动/自动保存门禁、原生成功基线先发布、恢复回调隔离、通知去重 |
| `src/features/files/AutoSaveController.ts` | 检查完成唤醒、有限退避、按 token/saveRevision 保存失败预算 |
| `src/components/layout/ExternalFileBanner.vue` | 准确的临时失败提示、响应 phase/operation 的标题与按钮 |
| `src-tauri/src/files/external.rs` | watcher 批次边界处理及真实自身保存、多窗口事件测试 |
| `src-tauri/src/files/external_tests.rs` | 临时目录下的原生保存、权限/占用、哈希、授权和大文件回归 |
| `scripts/external-file-regression.mjs` | 可控 Promise/Fake Gateway/真实控制器的 41 组专项 |
| `scripts/run-regressions.mjs` | 将专项加入 smoke，沿用现有 CI |
| `docs/testing.md`、本文件 | 测试入口、证据、覆盖及验收边界 |

## 原生监测开销与保护边界

- `check_external_file` 仍通过带窗口 owner 的 `operate()` 调用 FileService，未修改授权和锁。
- `check_external` 仍调用 `read_disk`，校验打开句柄、路径、长度、读取前后元数据并计算 SHA-256。普通后台检查由两次完整读取减至一次；比较/重载仍保留有限稳定读取和 expected-version 验证。
- native watcher 已有单 watcher、共享父目录、180ms 合并、有界事件通道和溢出补查。Access 事件在入队前过滤，避免只读活动挤满队列触发全量补查；修复 deadline 边界事件绕过过滤、路径预算和错误处理的问题，避免检查读取反馈出新的检查。
- 前端 watcher/focus/保存后检查共用按文档 id 去重的 Set。100 个重复 hint 合并成一次读取。进行中的检查收到新 hint 会保留一次后续检查，不丢弃真实写入。
- 不屏蔽本应用保存后的文件系统事件；否则会漏掉紧接保存的外部写入。保存后的合并检查以新基线运行。
- 多文档检查串行；取消过期检查会释放前端共享队列，不等待旧 IPC 返回。Rust FileStore 原有互斥串行化和 owner 授权保持。
- `FileService::save`、`atomic.rs`、原子新文件写入、Windows 原位写入/回滚/身份策略未修改。大小和 mtime 不替代内容哈希。

## 回归覆盖映射

专项使用真实 FileController、ExternalFileChangeController、AutoSaveController 和 DocumentManager；Fake Gateway 仅替代 IPC，检查返回值在 Promise 等待前捕获。前端断言文本、脏状态、撤销深度、磁盘基线、写入数、通知数、绑定状态及实际 Vue Banner。

| 需求 | 专项证据 |
|---|---|
| 1、2 checking 中手动保存、旧 V1/旧错误迟到 | P0 manual save during checking，包含迟到 deleted |
| 3 连续 Ctrl+S 10 次 | P0 ten Ctrl+S，三种模式各 10 次 |
| 4 自动保存与检查并发 | P0 autosave parks during check，等待期间无 timer，恢复后只保存一次 |
| 5 自身保存 watcher | P0 own-save watcher burst；native own_saves 测试 |
| 6 100 个 hint 合并 | 同上，精确断言只增加一次 check；native duplicate_hints 测试 |
| 7 focus 与手动保存并发 | P0 own-save watcher burst and focus check |
| 8 相同内容不同 mtime | 原组 04 + native metadata_only_change 测试 |
| 9、10 真实外部修改、checking/保存期间修改 | P0 external content changes；原组 05；native 条件写入测试 |
| 11 权限错误重试 | P0 native I/O and IPC failures；native permission/sharing、fault injection 测试 |
| 12 临时读取失败恢复 | 原组 15，含 permission/encoding/io/busy/file_locked/conflict/ipc |
| 13 已确认冲突不可被普通检查清除 | P0 confirmed conflicts survive reads/revert/undo/errors/toggles |
| 14 保存后另存为、关闭和重开 | P0 save-as close/reopen；原组 11、12、17、18 |
| 15 共享同一文档 | P0 ten Ctrl+S 的双窗格；原组 16；native 多窗口 owner 测试 |
| 16 Markdown Source/Live/Split | P0 ten Ctrl+S + 原组 16 |
| 17 Windows 文件身份 | native own_saves 连续 10 次断言身份；原有 atomic 回滚测试 |
| 18 大文件 | P0 large Markdown；native 约 8 MiB 检查、保存、外部覆盖拒绝 |
| 19 关闭监测仍校验 | 原组 05；native large 测试断言 watcher 未启动 |
| 20 不出现误导 Toast | P0 正常保存通知数为零；P1 实际 Banner checking/error 测试 |

另覆盖：恢复回调失败、确认/快照危险操作互斥、不稳定 writer 四次读取后退出、多文件检查队列不被过期 IPC 占住、Banner 标题和按钮状态更新。

## 执行证据

- 修复前新增专项在 `checking must not reject Ctrl+S` 失败。原始日志：`test-results/external-checking-before.log`。
- 专项加入 `scripts/run-regressions.mjs` 的 smoke 和完整套件；`.github/workflows/quality.yml` 的 `pnpm test:smoke` 及 Extended Quality 完整回归会执行本次测试。Windows native 测试由现有 Windows Rust job 执行。
- 最终结果：

| 检查 | 结果 | 日志 |
|---|---|---|
| `pnpm typecheck` | 通过 | `test-results/external-typecheck.log` |
| `pnpm build` | 通过；仍有构建器的模块外置及大 chunk 提示 | `test-results/external-build-final.log` |
| 最终代码 `pnpm test` 轮次 1 | 20/20，含专项 41 组 | `test-results/external-pnpm-test-accepted-2.log` |
| 最终代码 `pnpm test` 轮次 2 | 20/20，含专项 41 组 | `test-results/external-pnpm-test-accepted-3.log` |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 通过 | `test-results/external-cargo-check.log` |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 138 通过、0 失败、1 项原有公网测试 ignored | `test-results/external-cargo-test.log` |
| 专项及 smoke 内专项 | 41 组通过 | `test-results/external-files/results.json`、`test-results/regression-logs/external-file-regression.log` |
| 光标动画单项复跑 | 1/1 通过 | `test-results/external-smooth-caret-retry.log` |

- 保留初始失败记录：`external-pnpm-test-1.log` 的工作区原有 Quick Open 应用测试得到重复结果（2 != 1）；`external-pnpm-test-2.log` 中该测试文件在运行期间被并行工作移除，已启动的旧清单报告脚本不存在；`external-pnpm-test-final-1.log` 中另一个 `quick-open-phase02` 工作树的测试占用 1439 端口，括号测试启动失败。这些失败均未隐藏或修改为跳过，随后按稳定的当前工作区清单补跑。
- 额外最终复验 `external-pnpm-test-accepted-1.log`：19/20，光标动画 PM 坐标对齐等待发生一次 10 秒超时，专项 41 组通过。原失败日志保留为 `external-smooth-caret-timeout.log`。该脚本不实例化本次三个文件控制器；后续单项复跑及完整 `accepted-2`、`accepted-3` 均通过，没有修改或跳过原测试。此前 `external-pnpm-test-final-2.log`、`final-3.log` 也各有一次 20/20（当时专项为 40 组）。
- 最终验收前后核对本次 8 个实现/测试文件的 SHA-256，未变化；记录为 `test-results/external-source-hashes.json`。文档另在测试完成后补齐结果。
- 系统默认 TEMP 拒绝创建临时目录，原生测试使用 `test-results/native-temp` 作为 TEMP/TMP 后执行；所有文件系统用例仍使用 tempfile 的独立临时目录。

## 人工验收与剩余边界

- 需要人工在实际桌面、Windows 杀毒软件/同步盘/网络盘环境下确认监测延迟和占用提示；本次自动化包含浏览器实际控制器和 Windows 原生文件系统测试，没有发布安装包。
- 不改变原生 IPC 的超时策略。取消只结束旧前端检查的等待，不能中断已进入 Rust 的读取或系统调用；已有 Rust 互斥策略可能仍使慢设备延迟后续请求。
- 自动保存连续三次失败后暂停，需成功手动保存恢复；失败期间内容和撤销历史仍在文档中。
- 现有光标动画回归曾发生一次坐标等待超时，后续单项及完整两轮通过；保留为测试稳定性风险，不推断其根因已经修复。
