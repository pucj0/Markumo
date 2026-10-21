# main 分支整合记录

日期：2026-10-21。起点为 `4143329`，保留工作区已有改动；所有新增代码、文档修改和提交均在 `main` 完成。

## 分支规则

仓库根目录 `AGENTS.md` 规定 AI 仅在 `main` 修改和提交，不自行创建开发分支或工作树，提交信息使用中文。其他工作树用于只读检查和历史快照。未经明确授权不推送、不发布、不修改产品版本号。

## 整合范围

| 来源 | 处理结果 |
|---|---|
| 当前工作目录的磁盘检查/保存修复 | 提交 `e42db78`，包含状态机、过期检查取消、有限自动保存重试、通知去重及原有用户测试文档改动 |
| 快速打开 `dbb029d` | 合并提交 `a30b76f`，包含预览/固定标签、索引生命周期、刷新及应用级回归 |
| 工具栏 `995c954` | 合并提交 `d50b2bb`，包含状态响应、输入法状态通知及响应式布局 |
| 外部监测 `77ce66b` | 合并提交 `e7c7363`，接入窗口监测会话 lease、原生安全读取、焦点监听、操作互斥、多窗格选择保持、原生验收资料和额外回归；保留 main 最新的保存竞争修复和 watcher 合并逻辑 |
| 恢复数据安全 `9fa9e9c` | 合并提交 `783bab1`，整合跨进程存储锁、新鲜检查点回执、恢复失败重试、磁盘读取后的版本复核及额外回归；保留 main 的恢复稿认领、版本 CAS 和防误删语义 |
| 尾随段落旧工作树的未提交内容 | 已由 main 历史提交 `2771241` 实现。逐文件核对：5 个文件与该提交相同，控制器差异仅为更旧的链接/图片逻辑；保留 main 的较新实现，不重复覆盖 |

历史分支中的旧 `checking` 保存阻塞和 I/O 持久冲突逻辑没有带回 main。恢复稿被显式恢复后属于当前文档：旧回归改用 `discardDocument` 验证显式丢弃，保留 main 拒绝用过期列表条目删除活跃恢复稿的保护。

Smoke/完整回归中的重复外部文件专项条目已去重；两侧新增回归均保留，外部文件专项共 53 组。

联合回归还复现了工具栏代码块保护与异步语言加载的交叉问题：新建 Markdown Source 文档的语言扩展尚未就绪时，普通标题快捷键也被误判为不可格式化。现在缺少语言扩展时直接使用同配置的 Markdown 块解析器，并按不可变文档缓存结果；既允许普通文本格式化，也继续保护嵌套、缩进及未闭合代码块。新增真实 DocumentManager 的同步操作回归先失败、修复后通过，原 Source/Split 代码块专项保持通过。

## 分支与工作树清理

- `codex/quick-open-phase02` 与 `codex/quick-open-phase02-fix` 均已合入并删除，本地仅保留 `main`。
- `77ce66b`、`995c954`、`9fa9e9c`、`dbb029d` 均已验证为 main 的祖先。
- 快速打开工作树在确认无未提交内容后解除分支绑定；旧工作树全部保留为 detached 历史快照，未删除目录、忽略文件或未提交内容。
- 整合前补丁保存在忽略目录 `test-results/consolidation/`，供本地追溯。
- 未推送远程，产品版本仍为 `1.0.4`。

## 验证

| 检查 | 结果 | 本地日志 |
|---|---|---|
| `pnpm typecheck` | 通过 | `test-results/consolidation/typecheck-final.log` |
| `pnpm build` | 通过，保留原有大 chunk 提示 | `test-results/consolidation/build-final.log` |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 通过 | 整合过程命令输出 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 144 通过、0 失败、1 项原有公网测试忽略 | `test-results/consolidation/cargo-test.log` |
| 快速打开应用、工具栏、恢复专项 | 通过 | `test-results/consolidation/focused.log` |
| 外部文件专项 | 53 组通过 | `test-results/consolidation/external-retry.log`、`test-results/external-files/results.json` |
| `pnpm test` 连续两次 | 均为 21/21 通过，0 失败、0 跳过；包含 53 组外部文件专项及 19 组工具栏专项 | `test-results/consolidation/smoke-final-1.log`、`test-results/consolidation/smoke-final-2.log` |

首次联合专项暴露旧恢复测试通过过期列表条目删除已认领稿件的接口冲突；调整为当前文档显式丢弃 API 后专项通过，未放宽主分支的活跃稿件保护。

原生集成脚本需要隔离窗口与测试配置，未在当前桌面配置运行；本次原生结果来自临时目录中的 Rust 文件系统测试。旧工作树保留，人工验收后可再按需清理目录。构建仍有依赖外置和大 chunk 的已有提示。
