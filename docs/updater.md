# 应用内更新实现与验收

本次保留 Tauri 2 updater 的 HTTPS 端点、公钥、原生签名验证、NSIS passive 安装及原有发布完整性检查。没有修改正式版本、发布标签，没有推送或发布 Release，没有增加运行时依赖。

## 所有权与状态

`useAppShell` 为每个 WebView 创建一个 `UpdateManager`，传入 Vue reactive 状态。标题栏、面板和确认框只发出用户操作；专注模式卸载标题栏不会停止检查或下载。管理器用同一 Promise 合并并发操作，拒绝旧检查回写，销毁后释放迟到资源。

状态主路径：

```text
idle → checking → up-to-date / available / error
available → downloading → downloaded
downloaded → preparing → installing → awaiting-restart
```

检查失败可以重新检查；下载失败回到 available 并显示重试原因；取消、保存失败、窗口阻塞、持久化失败或原生安装失败回到 downloaded，保留当前会话的已验证下载。重启失败保留 awaiting-restart，再试时只保存现场并重启，不重复安装。

`prepareInstallation()` 可单独执行安全准备，不安装；`installUpdate()` 会重新执行准备以防状态变化。下载完成仅在 `download()` Promise 成功后确认，SDK 的 Finished 事件先于签名验证，不能用来提前显示就绪。成功调用 `install()` 不等于确认新版本运行。

下载更新对象及 downloaded bytes 由管理器持有；关闭面板或选择稍后不 close。成功安装或应用壳层卸载才释放，不需要时更换检查结果也会释放。应用退出后不承诺保留下载，不提供暂停、断点续传或持久缓存。

## 安装保护

多 WebView 的 JS 堆和资源表相互隔离。Rust 的 `UpdateCoordinator` 提供进程级安装租约，检查实际窗口和已注册但尚未创建的窗口；新窗口注册与取得租约使用同一锁。安装期间不能注册新窗口，失败、取消和窗口销毁会释放租约。

各窗口节流上报不含路径、正文的 dirty 数量、文件操作、IME 和启动状态；安装入口查询其他窗口状态并给出保存、关闭指引。其他窗口仍存在时阻止安装，不自动关闭它们，也不替其他窗口默默放弃内容。

当前窗口有 dirty 文档时显示专用「保存全部并更新」确认。确认后才锁定编辑；逐一调用原 FileController.save，保留未命名保存对话框、编码、磁盘版本冲突和保存快照检查。任一保存取消或失败就终止；保存、持久化后再次检查 dirty、IME、文件操作和窗口状态。导入导出也纳入文件操作门禁。

`WindowCloseGuard` 与 `ensure_update_window` 保留。设置写入和 `SessionWriter.flush(true)` 在安装路径严格传播失败，不把“已捕获错误”当作持久化成功。

会话继续使用 `last-session.json` 与 SessionWriter；可选 `editorLayout` 记录分栏、标签顺序、活动窗格、最大化窗格和各窗格 Markdown 模式。前端发送文件令牌，原生转换为已授权文件路径，校验节点深度、大小、字段和文件归属；不保存文档正文。旧会话没有该字段仍可恢复。只有安装租约持有者可以让单独剩下的文件关联窗口持久化更新前现场。

## 后台下载与 UI

新旧用户均默认自动检查开启、自动后台下载关闭；字段可选且沿用设置版本 5，不重置既有偏好。生产构建启动就绪后约 10 秒检查，随后每 4 小时检查；手动检查始终可用。开发构建不自动调度、不安装。

开启后台下载后，检查发现更新即下载；已发现更新时从关闭切到开启也会下载。关闭后不安排新的自动下载，已经开始的下载安全完成。网络或签名失败不会紧密循环重试。任何情况下均不自动安装或重启。

进度最多约每 100ms 更新一次；总大小未知时只显示已下载字节数，不伪造百分比。下载期间允许正常编辑。每个版本每个管理器会话只提示一次就绪 Toast。

面板集中显示当前／目标版本、状态、有限 Markdown 日志、进度与可执行动作。Markdown 禁用原始 HTML，输出再经过 DOMPurify 白名单清理；无远程图片，长内容独立滚动。日志入口指向对应 GitHub Release，无目标版本时指向 latest；Windows 使用系统 ShellExecuteW 打开默认浏览器，失败给出面板及 Toast 提示。

## 平台与版本确认

| 平台 | 实际 SDK 行为和本实现处理 |
| --- | --- |
| Windows NSIS | 原生 install 成功启动安装器后退出当前进程，不能依赖 JS 后续语句执行；此前已保存现场和 pending 标记。安装器按原配置完成并重新启动应用。 |
| macOS | 原生替换应用后，应用调用 plugin-process.relaunch；失败时可再次保存新修改并重试重启。 |
| Linux AppImage | 仅 AppImage 环境支持本次自动下载和原生替换，安装后主动 relaunch。 |
| Linux deb | 可检查更新；不自动下载或安装 AppImage，显示新版 deb 的手动下载指引。 |

`pending-update.json` 仅包含原版本、目标版本、进程代号。旧进程中的另一 WebView 不会消费它；新进程只有实际运行版本精确等于目标版本才显示一次「已更新至 vX.Y.Z」。版本不匹配不报成功；异常或失败后允许正常检查。安装返回或 relaunch 返回均不直接触发成功 Toast。

确认恢复更新启动时，会优先通过已有会话恢复主编辑现场；原文件关联启动参数排入正常待打开队列，避免重启参数只打开旧的单个文件而丢失分栏。设置沿用原偏好文件恢复。

## 发布

`release.mjs.releaseNotes` 读取 `docs/releases/vX.Y.Z.md`，同一文本同时用于 latest.json.notes 与 GitHub Release 描述。文档缺失／空白时提供版本与简短说明回退，超过 64 KiB 拒绝发布。四个平台安装包、inline signature、SHA256SUMS、草稿上传及禁止覆盖正式版本的约束保留。现有 release.yml 和 tauri.conf.json 已检查，无需改变其安全配置。

## 自动化验证

- `node scripts/updater-regression.mjs`：32 项更新回归，包括实际组件与 App 设置界面、未知大小、后台下载及专注模式卸载、资源释放、下载重试、取消与保存失败、IME、其他窗口阻塞、原生安装失败、重启重试、并发操作、定时调度、Markdown 清理、完整日志链接、FileController 编码／冲突保护和会话布局恢复。安装器、网络下载和重启使用模拟服务。
- `node scripts/release-regression.mjs`：真实更新日志／回退／大小限制、各平台资源、缺失签名拒绝、校验和与更新资源生命周期。
- `pnpm typecheck`、`pnpm build`。
- `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`。Rust 测试涵盖进程租约、待创建窗口、窗口归属、真实设置与会话文件往返、旧字段兼容、标记版本核验与一次性消费。

测试产物在忽略目录 `test-results/updater/`，包括 JSON 结果、浅深色面板、未知大小进度、下载就绪、保存确认截图。Windows 当前用户系统临时目录拒绝测试写入，Rust 测试使用工作区 `test-results/rust-tmp` 作为该测试进程的 TEMP/TMP。

## 手工验收与限制

当前没有执行真实的 NSIS 安装、macOS 替换、AppImage 替换或系统重启；不能把模拟安装通过描述为真实更新成功。Windows 系统默认浏览器的实际唤起也需要在重启后的桌面构建验收。建议使用隔离的、正常签名的两个测试构建进行下列验收，不改正式公钥／端点、不发布测试 Release 到正式 latest：

1. Windows：开启／关闭自动下载，下载时持续编辑，切换专注模式并关闭面板；完成后稍后安装，资源应保留。
2. 打开命名文档、两个未命名草稿及同一 Markdown 的源码／即时排版分栏；安装确认后逐一保存。取消任何保存位置选择、只读路径、磁盘满、外部修改冲突都必须停止安装，内容及下载仍保留。
3. 打开另一个包含 dirty 内容的窗口，检查阻塞信息；自己保存并关闭它后重试。快速重复点击安装、安装准备期间尝试第二实例打开文件，都不得启动冲突的安装器。
4. 安装成功后验证实际新版本、一次性 Toast、设置、工作区、分栏与活动标签恢复；再正常启动不重复 Toast。手动制造目标不匹配、安装失败、重启失败，均不得显示成功。
5. macOS 与 Linux AppImage 分别验收安装后 relaunch、权限失败和重试；Linux deb 验证只有手动更新指引。
6. Windows 点击完整更新日志和日志内链接，应调用默认浏览器；解除 HTTP/HTTPS 默认关联后，应显示错误提示。

不支持跨应用退出的下载缓存、下载暂停／续传或自动关闭其他窗口；空白且从未保存的干净草稿沿用原会话规则，不恢复正文。分栏几何、标签及模式已持久化，本次不增加新的正文恢复或逐光标位置保存系统。

## 本次文件及用途

| 文件 | 用途 |
| --- | --- |
| `src/features/shell/updater/UpdateManager.ts` | 壳层资源所有者、并发控制、下载／安装／定时调度 |
| `src/features/shell/updater/UpdateState.ts` | 状态类型、初始状态与标签 |
| `src/features/shell/updater/UpdatePreferences.ts` | 后台更新偏好类型与默认值 |
| `src/features/shell/updater/prepareInstallation.ts` | 保存全部、状态复查、锁定及严格持久化 |
| `src/features/shell/updater/releaseNotes.ts` | 有限 Markdown 与安全清理 |
| `src/features/shell/AppUpdater.ts` | 稳定导出、GitHub 及版本日志 URL |
| `src/components/common/UpdateControl.vue` | 无业务资源的标题栏状态入口 |
| `src/components/common/UpdatePanel.vue` | 日志、真实下载进度与动作面板 |
| `src/components/modals/UpdateConfirm.vue` | 无丢弃选项的保存全部确认 |
| `src/components/layout/TopBar.vue` | 转发状态和打开面板事件 |
| `src/app/useAppShell.ts`、`src/App.vue` | 管理器生命周期、窗口状态报告、组件与安全流程接线 |
| `src/features/shell/editorSettings.ts`、`src/components/modals/SettingsModal.vue`、`src-tauri/src/commands/settings.rs` | 偏好默认值、迁移、UI、桌面保存与回归 |
| `src/features/shell/launchSession.ts`、`src-tauri/src/session.rs`、`src-tauri/src/commands/session.rs` | 原会话写入严格失败、分栏元数据与恢复 |
| `src/editor/core/DocumentManager.ts` | 通过原有视图生命周期恢复序列化布局 |
| `src-tauri/src/commands/update.rs`、`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs` | 原生进程锁、平台识别、窗口报告、安装标记、命令注册与更新启动 |
| `src-tauri/src/commands/app.rs` | 保留窗口门禁，Windows 系统 URL 打开与协议校验 |
| `scripts/release.mjs`、`scripts/release-regression.mjs` | 同源日志及发布完整性回归 |
| `scripts/updater-regression.mjs` | 更新及 UI 回归 |
| `docs/updater.md`、`docs/releasing.md` | 实现、限制、发布说明和手工验收 |
