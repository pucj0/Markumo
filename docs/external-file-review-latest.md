# 外部文件变更感知：最新代码审查与交付

基线：`c8dd8fcdbcabbd02145c3955f07690cebeebe7a6`（Markumo 1.0.5）。开始时已核对本地 main 与远程 main 一致。本次在 main 开发，不修改版本号、不打标签、不推送。

## 审查结论与本次补齐

最新代码已经具备原生监测、中央冲突状态、干净文件自动刷新、只读 Diff、确认重载及恢复检查点。本次沿用这些实现和 Rust 条件保存协议，没有另建版本系统。

审查范围包括 FileController、AutoSaveController、DocumentManager、Rust files/commands、launchSession、useAppShell、恢复系统、设置和相关组件。会话继续以现有 token/路径和布局序列化，不持久化瞬时 watcher 或冲突操作对象；启动恢复完成后接入监测，窗口销毁时释放。

补齐的问题：

1. 忙碌/IME 期间检查重新入队后会每 180 ms 唤醒。现在停放于 Set，保存完成、工作区操作结束、编辑器组合输入/生命周期通知才重新调度。
2. 干净文件读取中途进入忙碌状态，原实现会留下不能自动恢复的冲突。现在为未编辑的干净缓冲区记录本地 revision 约束的待刷新资格，安全后重新验证磁盘再加载。编辑（包括编辑后撤销）、删除、原生保存冲突、保留当前、比较或显式重载都会撤销资格，不会借普通检查清除真实冲突。
3. 读取期间关闭自动重载，原结果仍可能被接受。现在在接纳点再次检查设置，保留缓冲区与手动处理入口。
4. 重载原来只保留字符偏移，且销毁所有 Source 视图。现在按每个 Pane 的行列恢复反向/多光标选区，复用 Source 的编辑器 DOM，初始化新状态时隔离旧视图。使用 CodeMirror 滚动快照恢复视口，避免后续高度测量再次移动滚动位置。
5. Live 视图需要异步重新绑定回调。现在只在原编辑器拥有焦点、用户未转向其他 Pane/控件时恢复焦点，不抢走新的焦点。
6. 超过 1024 个 token 后原生订阅更新失败，旧 generation 的订阅仍可能占用资源。现在有效租约的超限请求撤销本窗口旧订阅并进入焦点降级；旧租约不能撤销新会话，其他窗口继续监测。保留原有跨窗口 `scope` 错误语义。
7. Diff 明确标注“磁盘文件”和“当前编辑内容”；修复首次“上一个变化”未跳到最后一个变化的问题。提示条、Diff、确认框统一使用项目的 `--ink`/`--sidebar` 主题变量，移除不存在的颜色变量。

## 监测架构与资源生命周期

- Rust 一个应用级 RecommendedWatcher、一个工作线程；按父目录非递归订阅，同目录共享，不扫描整个工作区。
- 原生回调使用容量 256 的非阻塞队列；180 ms 合并、最多 4096 条路径，溢出转为已打开目标复查。过滤 Access 事件，避免检查读盘形成反馈。
- 每窗口最多接纳 1024 个监测 token。超限明确降级并清理该窗口旧资源；关闭最后一个文件引用或窗口后移除无用目录订阅。
- 前端按规范文档 ID 合并提示、串行检查。多个 Pane 共享文本、token 和外部状态，不各建 watcher。
- 原生签发窗口会话 lease，订阅带 generation；前端还检查绑定对象、token、本地 revision 和操作 sequence。关闭、另存、重开、dispose 使旧操作失效；晚到 Promise 不能重建已关闭文档。
- watcher 初始化、订阅或运行时失败时提示监测降级。原生窗口和 DOM focus 通知共用 5 秒合并检查，只检查已打开文件，不做高频工作区轮询。
- 不屏蔽本应用保存后的 watcher 事件。保存发布新基线，随后合并检查可以发现紧接发生的外部写入。

## 自动刷新规则与版本保护

事件仅是提示。`check_external_file(token)` 和 `read_external_file(token, expectedVersion, encoding)` 均经过当前窗口授权；未增加按任意路径读取的入口。

Rust 校验文件句柄、规范路径、文件身份、读取稳定性和内容版本。前端普通检查使用同一版本协议；同内容仅 mtime 改变时只确认元数据，不改正文和 Undo。原生条件保存仍是写入的最后保护，Windows 原位保存身份策略与原子保存实现未修改。

| 情况 | 行为 |
|---|---|
| 干净、已确认磁盘内容不同、默认设置开启 | 再次安全读取/验证后刷新同一文档，保留布局、Pane 模式、合理的行列与视口 |
| IME、保存或工作区操作进行中 | 停放检查或刷新，安全后由事件唤醒；不持续轮询 |
| 读取中关闭自动重载 | 不接纳旧结果，显示提示，等待用户选择 |
| 干净读取暂时失败 | 保留正文；新提示/焦点/手动检查可重试，不自动循环 |
| 本地有修改或曾介入待刷新缓冲区 | 保留冲突，禁止自动覆盖 |
| 删除、移动、重命名 | 保留原路径的编辑内容；不猜测新路径，不悄悄转移授权 |
| 后台 checking、尚无冲突证据 | 不弹错误、不拒绝手动保存；写入交给 Rust 比较版本 |
| 普通 I/O / 权限 / IPC 错误 | 显示准确错误，允许重试；不凭错误制造持久冲突 |

自动保存沿用有限退避和通知去重，真实冲突暂停；保存成功使旧检查失效，以原生返回版本为新磁盘基线。

## 冲突、恢复与 Diff

冲突提示条和标签标记是同一状态的展示，不反复堆叠。四个入口为比较差异、保留当前、加载磁盘、另存为。保留当前只折叠提醒，不解除保存保护。

脏文档加载磁盘必须明确确认。确认绑定 token、本地 revision 和磁盘版本，读取前后再次验证；可靠恢复检查点失败则停止有损操作。检查点与后续普通保存解绑，不因保存新正文而误删旧恢复稿。真正重载开启新的 Undo 历史，确认框明确说明；查看/刷新/关闭 Diff 不改变原编辑器历史。

Diff 使用已有 MIT 许可的 `@codemirror/merge`，无 Monaco、新编辑内核或新增运行时依赖。两侧为只读快照，支持滚动、高亮增删改、前后变化导航及过期提示。合计最多 256 Ki 字符、20,000 行，算法 scanLimit=500、timeout=40 ms；超限不创建比较视图，提示另存后使用专用工具。

设置“自动重新加载外部修改的干净文件”默认开启，前后端设置校验和显式关闭值均保留。关闭后只提示，脏文件确认和原生保存校验始终生效。

## 回归与证据

新增/增强测试使用真实 FileController、DocumentManager、RecoveryController、CodeMirror/Live 视图和可控 Promise/Fake Gateway。原生监听及资源测试使用 tempfile 临时目录和真实 notify。

- 修复前：忙碌检查在 `busy checks must not create polling timers` 失败，日志 `test-results/external-latest-review/browser-before.log`。
- 修复前：原生超限测试在 `limit fallback retained stale owner subscriptions` 失败，日志 `test-results/native-watch-limit-before.log`。
- 视口回归另复现 `240 -> 427` 像素跳动，改用 CodeMirror 快照后保持；未通过放宽阈值解决。
- 专项现为 61 组，新增忙碌结束唤醒、读取中设置变更、短暂读失败恢复、编辑/撤销与保留当前取消待刷新、Source 视图/行列/滚动、Live 焦点恢复及焦点转移保护；原有 53 组保存竞争、版本、恢复与授权回归全部保留。
- 实际 Vue Diff 测试覆盖两侧只读、标签、三处差异的首次反向导航、Light 色彩与主题重建；Dark/Light 截图位于 `test-results/external-files/`，已查看。
- `scripts/run-regressions.mjs` 的 smoke/完整套件已包含此专项，现有 Frontend Quality 和 Rust Quality 会执行，无须新增重复 CI job。

| 验证 | 结果 |
|---|---|
| 外部文件专项 | 61 组通过 |
| 原生上限/租约/多窗口专项 | 通过 |
| Rust `cargo check --locked` | 通过 |
| Rust `cargo test --locked` | 145 通过、0 失败、1 项原有公网测试忽略 |
| 前端类型检查 | 独立快照及合并同期 Slash 功能后的 main（`2c2d721`）均通过 |
| 前端构建 | 独立快照及合并后的 main 均通过，保留已有大 chunk / 模块外置提示 |
| 32 项完整前端回归 | 32/32 通过，0 失败、0 跳过；含 61 组外部文件专项 |
| 合并后的 main 外部专项 | 再次 61 组通过，事件指标 checks=5、reads=2、files=1 |

本次执行期间，其他编辑正在添加 Markdown Slash 命令。共享工作目录的类型检查曾因此报未使用成员；这些改动没有被删除或纳入本次补丁。为验证独立交付内容，在忽略目录 `test-results/external-latest-review/verified-source` 导出基线和本次补丁，复用相同锁文件已安装的依赖，执行前端检查；这是验证产物，不是新分支或工作树。最终提交只包含下列外部文件相关改动。

功能提交为 `a98262a45c4eaebbc73fdc84dfec2ee065b8d9cb`。9 个代码/测试文件的 Git 对象已逐一核对，与验证快照完全一致（`test-results/external-latest-review/source-match.log`）。同期 Slash 功能随后独立提交为 `2c2d721`，本次没有改写其历史；对合并后的 main 另外执行了类型检查、构建和 61 组外部专项。最终验收记录单独追加提交。

首次完整回归在 Vite 重新预构建依赖时发生页面加载超时。将验证产物的 Vite 缓存与共享工作目录隔离后，完整重跑 32 项并全部通过，没有修改断言或放宽超时。最终日志位于 `test-results/external-latest-review/`：`snapshot-typecheck.log`、`snapshot-build.log`、`full-regression-final.log`、`cargo-check.log`、`cargo-test.log`、`integrated-typecheck.log`、`integrated-build.log`、`integrated-external.log`。快照使用 `pnpm --config.verifyDepsBeforeRun=false typecheck|build|test:regression` 复用已安装依赖；共享 main 使用正常的 `pnpm typecheck`、`pnpm build` 和 `node scripts/external-file-regression.mjs`。

## 本次文件清单

- `src/features/files/ExternalFileChangeController.ts`
- `src/features/files/FileController.ts`
- `src/editor/core/DocumentManager.ts`
- `src/components/layout/ExternalFileBanner.vue`
- `src/components/modals/ExternalFileDialogs.vue`
- `src/components/modals/ExternalFileDiff.vue`
- `src-tauri/src/files/mod.rs`
- `src-tauri/src/files/external.rs`
- `scripts/external-file-regression.mjs`
- `docs/external-file-review-latest.md`
- `docs/external-file-changes.md`
- `docs/testing.md`

## 边界与人工验收

本次没有启动生产应用或改动用户配置。Windows 上实测了真实临时文件系统和 notify，浏览器专项覆盖真实编辑器与 UI；未把 Fake Gateway 描述为原生 GUI 集成测试。Linux/macOS 的本次变更及真实 IME、网络盘长期监测仍需对应桌面人工验收。行列和滚动按现有文档结构尽可能保留，已删除的行/列会夹取到有效范围。

独立提交标题按本次任务指定为 `feat(files): detect external changes and resolve conflicts`；SHA 见交付回复。不自动 push。
