# Markumo Markdown 功能 · Repair 05 综合验收

审查日期：2026-10-23。此次范围仅为 Repair 01～04 后的 5 项 P0、DOCX 性能与验收、Quality Gate 失败修复。工作始终在 main；保留既有裸 URL 等提交，没有修改版本号、推送或发布。当前功能源码基线为 `1c2662c`；验收脚本补充至 `f4c4c7e`。最终提交以本报告所在 Git 提交为准。

证据归档见 [repair05-evidence/manifest.json](performance/repair05-evidence/manifest.json)，每份记录包含原路径、大小和 SHA-256。历史修复前测试通过只读 Git 对象覆盖加载旧源码，未切换分支或建立工作树。初始失败保留，最终通过结果单独记录；旧的局部通过日志不代表全量结果。

## 验收结论

| 项目 | 结果与证据边界 |
| --- | --- |
| P0-1 TOC 缓存 | 修复；真实 Parser、跨文档、同长度/同前缀、位置移动、双 TOC、点击跳转、Undo、选区命中缓存验证 |
| P0-2 大纲换行 | 修复；完整源码严格比较，LF/CRLF、有/无末尾换行、首末章移动；实际 OutlineView 拖放及双 Pane 单步 Undo/Redo |
| P0-3 保存归档 | 修复；Rust 归档与写盘顺序、故障与并发测试；真实 Tauri 保存、归档失败、重启与 Crash Recovery 验证 |
| P0-4 历史迁移 | 修复；混合成功/失败、页面重启重试、内容去重、非法字段和无淘汰配额验证 |
| P0-5 版本切换 | 修复；请求身份、内容哈希、恢复期间编辑、删除/关闭/切文件、确认取消；真实桌面端面板恢复验证 |
| DOCX | 按需 Worker、真实取消、资源回收、多图/行内图/表格图与复杂列表；官方 SDK 严格验证通过，保留以下限制 |
| Browser Smoke | 本机 48/48 套件通过，0 失败、0 跳过；远程旧提交仍为失败，不能将本地结果当作远程绿灯 |
| 全量回归 | 60/60 套件通过，0 失败、0 跳过，456.44s；最终代码含全部 Smoke 套件及新增 Markdown 专项 |
| 稳定性复跑 | 4 个套件 × 3 轮 = 12/12，通过且无跳过；日志为 CI 故障修复后的原始三轮结果，后续历史/复制补充由最终全量覆盖 |
| 类型 / 构建 | `pnpm typecheck`、`pnpm build` 通过；构建仍有既有大 chunk 与 Node 模块外置提示 |
| Rust | `cargo test --locked --manifest-path src-tauri/Cargo.toml`：197 passed / 0 failed / 1 ignored（现有需公网访问的 HTTPS 图片测试） |

环境：Windows x64；Node 24.13.0；Playwright Chromium 156.0.8078.4；真实 Tauri Release 的 WebView2 为 155.0.4283.62。系统 TEMP 写入受限，Rust 与原生验收显式使用工作区内可写临时目录。另运行真实 Pandoc 导出/导入图片往返测试 1/1，通过且无 UNVERIFIED 降级。没有通过增加测试超时解决本轮失败。

## P0-1：按不可变文档身份缓存 TOC

**修复前证据**：[repair05-toc-before.txt](performance/repair05-evidence/repair05-toc-before.txt)。两个文档标题等长且前 16 字相同，第二份文档拿到第一份文档的标题列表。旧签名也漏掉前置正文导致的位置变化。

**根因与修复**：原缓存把共享 heading NodeType 当文档身份，并用有损摘要判断更新。现为 `WeakMap<PMNode, Map<NodeType, readonly TocHeading[]>>`。不可变文档变更后自然失效，关闭文档及旧修订可被 GC；纯选区变化保持文档对象身份，不重新扫描。同一文档的多个 TOC 共用冻结的数组，不向正文派发事务。

**文件**：`src/editor/markdown/wysiwyg/tocIndex.ts`、`TocNodeView.ts`、`scripts/toc-regression.mjs`。

**修复后**：TOC 7 组回归通过，含 1000 次同文档缓存访问仅扫描一次、实际标题跳转、正文与 Undo 历史不受目录刷新影响。提交 `33a84b3`。

## P0-2：保留移动章节的分隔符和文件结尾

**修复前证据**：[repair05-outline-before.txt](performance/repair05-evidence/repair05-outline-before.txt)。无末尾换行的 `# A\n正文A\n\n# B\n正文B`，B 移到 A 前会生成 `正文B# A`。

**根因与修复**：EOF 章节没有可随章节一起移动的后置换行。现将章节正文、边界分隔符和全文件结尾换行分别处理；末章移动借用前置分隔符，保留原始 EOF 状态。计划只包含两个不重叠的删除/插入区间，OutlineView 单事务应用。

**文件**：`src/editor/outline/outlineReorder.ts`、`scripts/repair04-outline-regression.mjs`、`scripts/outline-reorder-regression.mjs`。

**修复后**：真实 Markumo Parser 的 source range；12 组保真检查（其中 EOF 矩阵覆盖双方向 LF/CRLF），实际 OutlineView 在 Live/Source/Split、有/无结尾换行的 6 组拖放、双 Pane、一次 Undo/Redo。严格比较完整输出及原始结构，不只检查 includes。提交 `c323529`。

## P0-3：归档完成之后才能覆盖磁盘

**修复前证据**：[repair05-save-before.txt](performance/repair05-evidence/repair05-save-before.txt)。故意挂起旧版历史写入时，原 FileController 已调用磁盘保存并清除 dirty 状态。

**根因与修复**：`void recordVersion().catch()` 未等待持久化，错误被吞。真实 Tauri 保存现在在同一原生保存操作中按以下顺序执行：校验授权和磁盘版本 → 读取真实磁盘旧正文并持久化归档 → 再次版本保护下写盘并校验 → 记录已经成功写入的新正文。多窗口共用文件操作锁及历史锁；旧版归档失败即阻止覆盖。写盘失败保留编辑正文；写盘已成功但新版历史失败则明确提示“正文已保存，但本次新版本未能写入历史”。

非事务网关同样等待前后归档，保存 guard 覆盖整个异步生命周期；自动保存错误去重，归档期间关闭/身份变化会阻止迟到写入。保留原文件编码用于旧磁盘解码，Windows namespace/display 路径使用同一文件键，并兼容读取旧索引。

**验收中追加发现**：外部比较读取会改变 grant 的 Hex/编码状态，导致归档解码或后续保存方式改变。现比较读取还原授权状态；真实重开、成功保存才更新编码。

**文件**：`src/features/files/{FileController.ts,contracts.ts,tauriFiles.ts}`、`src-tauri/src/commands/files.rs`、`src-tauri/src/files/{mod.rs,history_save_tests.rs,external_tests.rs}`、`src-tauri/src/history.rs`、`scripts/history-regression.mjs`。

**修复后**：6 组前端真实控制器加延迟 IPC/磁盘故障测试；Rust 保存旧/新版、旧版归档失败、磁盘中断、原始编码、双窗口 writer 竞争；真实 Release 端到端见后文。提交 `efa6fe6`、`9ba8405`、`91a3cfb`（此组回滚需同时考虑三项依赖）。

## P0-4：迁移失败保留来源，下次继续

**修复前证据**：[repair05-migration-before.txt](performance/repair05-evidence/repair05-migration-before.txt)。旧键仍含失败记录，全局标记却已为 done。

**根因与修复**：旧全局标记掩盖部分失败。现在剩余旧键为权威待迁移队列；逐条校验字段与大小；全部应迁移记录被接受且来源没被其他窗口更改后才删除该来源。仅无剩余来源且无失败时写 done。失败、非法格式、超配额均保留原始来源并通知。

原生 `history_import` 使用 SHA-256 幂等去重，配额预检禁止迁移过程淘汰已成功导入的版本，避免重启重复导入又互相淘汰。

**文件**：`src/features/history/historyService.ts`、`src-tauri/src/history.rs`、`src-tauri/src/commands/history.rs`、`src-tauri/src/lib.rs`、`scripts/repair02-regression.mjs`。

**修复后**：Repair 02 共 10 组；混合成功/瞬时失败/非法记录、已有错误 done 标记、实际页面 reload 后重试、成功版本 ID 不变；Rust 验证严格配额与幂等。提交 `ddb4073`。

## P0-5：预览、恢复与确认均绑定同一请求身份

**修复前证据**：[repair05-dialog-before.txt](performance/repair05-evidence/repair05-dialog-before.txt)。慢 A 晚于快 B 返回，选中 B 时预览却被 A 覆盖。

**根因与修复**：正文与 selectedId 分离，异步返回没有身份保护。现在加载结果绑定 filePath、documentId、versionId、SHA-256 和请求序号。新选择先清空旧正文；关闭、切文件、删除、卸载递增序号。恢复前保护当前编辑，再次读取目标原生版本并验证哈希、文档身份与不可变当前正文；发生新修改即取消。

**真实 Tauri 追加发现**：[repair05-native-confirm-before.json](performance/repair05-evidence/repair05-native-confirm-before.json)。Tauri dialog 插件将 `window.confirm` 替换为 Promise；旧面板却把 Promise 当 true，未等确认就恢复，同时抛出 dialog ACL 错误。现恢复和清空均用应用内异步确认框，默认焦点为取消；确认等待也绑定请求序号，切文件/关闭会废弃，且确认前后都会检查当前编辑身份。没有扩大原生对话框权限。

**文件**：`src/components/layout/HistoryDialog.vue`、`scripts/history-dialog-regression.mjs`。

**修复后**：11 组真实组件测试：慢 A/快 B、快 A/慢 B、同 ID 切文件、删除加载中版本、读取失败/哈希不匹配、关闭、恢复期间编辑/目标被删除，以及确认取消/等待时切换文件/关闭/清空。真实 Tauri 面板恢复无 pageerror。提交 `d9d25df`、`52e9d91`、`2ce5d2f`；恢复进行中还禁止清空操作替换恢复请求。

## DOCX：按需 Worker、取消和严格 OOXML

**修复前证据**：[repair05-ooxml-before.txt](performance/repair05-evidence/repair05-ooxml-before.txt)。官方 Open XML SDK 拒绝旧产物：表格缺少 `w:tblGrid`。先前“解包有某些节点”不足以证明 schema 合法。

`ExportController` 按需导入客户端，每次导出创建一个独立 Worker。Markdown 解析、XML、ZIP/CRC 在 Worker 中完成；取消直接 terminate，可打断同步 CPU 生成和等图阶段。结束、失败、取消均移除监听并回收 Worker，迟到图片结果被丢弃。App 提供生成进度和取消；进入写盘阶段后按钮禁用，避免把已提交的输出误报为取消。原生 DOCX 使用带授权 header 的二进制 IPC，避免在 UI 线程把大文件展开成 JSON 数组。

修复行内/多图/表格图预处理，图片失败保留 alt 并警告；修复表格 grid、非 1 起始有序列表、嵌套列表及以代码块开头的列表项；无法表示的 HTML 保留源码并警告。Markdown 正文不作导出副作用修改。

**验证**：4 组真实浏览器 Worker 测试；2 个复杂产物由 Microsoft Open XML SDK 3.3.0 的 Office2016 validator 检查，0 schema 错误；移除 grid 的负向对照必须被同一 validator 拒绝。对应 [positive.json](performance/repair05-evidence/positive.json)、[negative.json](performance/repair05-evidence/negative.json)。这是 schema 验证，不等同于 Word/LibreOffice 排版视觉验收。

性能样本见 [performance.json](performance/repair05-evidence/performance.json)：重复 10000 段的直接 Worker 压测产物 25,196,474 字节，耗时 1159.3ms，主线程 115 次心跳，最大间隔 11.2ms，结束活跃 Worker 为 0。该压测绕过控制器写盘，**不代表支持原生导出 25MB 文件**；正式输出仍受 16 MiB 上限保护。CPU 取消和迟到图片取消均为 0 正式输出写入。真实 WebView2 打包 Worker 取消约 34ms（见原生结果 JSON）。

**文件**：`src/features/document-conversion/{ExportController.ts,nativeDocxExport.ts,docxWorkerClient.ts,nativeDocxWorker.ts}`、`src/{App.vue,app/useAppShell.ts}`、`src-tauri/src/{commands/conversion.rs,lib.rs}`、`scripts/{docx-worker-regression.mjs,repair03-regression.mjs,validate-docx.mjs,openxml-validator/}`、Quality Gate。提交 `a8f5089`。

## 真实 Tauri 保存历史与重启

执行 `node scripts/repair05-native-build.mjs`，再执行 `node scripts/repair05-native-regression.mjs`。构建独立 identifier、全新 profile 和 fixture，Release 打包使用真实 Rust、CSP、生产组件。仅测试构建注入实际 useAppShell、invoke 和 Worker client 的引用；没有替换历史 IPC、文件系统或编辑器。原生构建清单记录 289 个源码文件及二进制 SHA-256，证据采集脚本已核对其与最终源码一致。

[原生结果](performance/repair05-evidence/native-results.json) 共 7 组通过：真实文件保存旧/新版归档与并发 guard；Windows 两种路径身份；双 Pane 历史面板恢复及一次 Undo/Redo；故意把专用 history 目录临时置为不可用后阻止覆盖且保留 dirty 正文；生产 CSP Worker 及 raw IPC 授权拒绝；强制进程结束并重新启动后历史 ID/正文哈希不变；真实恢复 debounce 产生的 Crash Recovery 快照跨进程保留。历史恢复本身不自动覆写磁盘。

原生构建清单 HEAD 为 `e98c680`，生产源码与 `1c2662c` 一致；后续提交只补测试和报告，不更改其生产源码。没有接触用户应用配置或真实文档。

## CI 失败的真实原因与门禁

最新已运行远程提交是 `a8f50899fc58bfc74e50acec44b9102bab981098`，[Quality Gate #37](https://github.com/yuanmahome/Markumo/actions/runs/39879455305)：Frontend 成功、Browser Smoke 失败、Rust 失败。日志摘要见 [repair05-remote-ci.json](performance/repair05-evidence/repair05-remote-ci.json)。后续修复未由本任务推送，远程没有对应绿灯。

| 实际失败 | 修复 |
| --- | --- |
| 原始 #35 Split 超时 | 图片 NodeView 内部呈现 mutation 被反复解析；ignoreMutation 阻断反馈循环（`b9dfa95`） |
| #37 窄屏占位高度 530.5→702 | 占位 pre-wrap 与 CM break-spaces 的空格折行不同；统一 CSS，增加 Consolas/Courier New/monospace × 宽窄屏 × 折行/行号矩阵 |
| #37 图片工具栏在数学编辑退出后消失 | 浏览器默认 mousedown caret 替换 NodeSelection；统一阻止默认选区并 focus，实际点击测试通过 |
| #37 两个 Vite 服务共享缓存 | 包装器覆写了隔离规则；按服务端口隔离，并保留明确指定的 cacheDir |
| #37 保存测试未等新归档步骤 | 测试改为等待实际磁盘网关到达后注入失败，不假定同步调用 |
| #37 DOCX 测试仍等 Pandoc API | 真实控制器现在生成 Worker 二进制；测试验证 raw bytes、header 授权和 lease 释放 |
| #36 历史测试实例化已删除 HistoryService | 换成真实 FileController/DocumentManager 与可控历史传输测试 |
| #37 Rust 比较读改写 grant | 比较操作还原 Hex/编码状态，避免改变保存语义 |
| #36/#37 Linux symlink 测试失败 | canonicalize 消除链接证据后才检查；现对原始输入路径检查，再返回规范路径；Windows 增加指向工作区内部的 junction 对照 |
| 本机首次全量的裸 URL 富文本复制丢链接 | Clipboard 使用了不启用 linkify 的 Markdown HTML renderer；现与 Live/preview 一样识别裸 URL，原有严格链接断言通过 |
| 本机首次全量的 Source 大纲滚动未生效 | 初始滚动快照的异步恢复覆盖了测试滚动；测试等待实际 CM requestMeasure 完成，不增加超时，并保留现场诊断 |
| 复跑时宽度测试的选区偶发没有进入编辑状态 | 原 selectText 只改浏览器 Range，会与 PM 的 focus/scroll 选区观察竞争；改用真实 Home/Shift+End 键盘选择，额外连续 3 轮通过，不放宽超时 |
| 本机首次全量有旧图片/YAML 入口 | 更新为现有工具栏与 Front Matter「编辑源码」，保留原有源码保真与撤销断言 |

CI 修复提交：`9b66ba8`、`79ca42d`、`aaf81d8`、`1c2662c`、`e98c680`、`f4c4c7e`；编码修复归入 P0-3。没有改用 force click、跳过用例或增大超时。Browser Smoke 未设置 continue-on-error，pipefail 保留非零退出码；48 套件任一失败/跳过都使工作流失败，随后 4 个稳定性套件各跑 3 轮，每轮均计入断言，不是失败后重试取绿。全量为 Smoke 超集。Word 官方 SDK 验证和畸形负向对照也进入阻塞 job。仓库分支保护是否将该 job 列为 required 未单独验证；这里的“阻塞”指工作流不能带失败继续成功。

## 保留的限制

- DOCX 脚注仍为文末编号列表，**不是 Word 原生脚注**；Mermaid 为源码，**不是图表图片**；数学为 LaTeX 降级；TOC 是静态可跳转标题列表，未计算页码。导出会明确警告。
- 已授权的受支持本地图片可以嵌入；远程、无法读取、格式不支持或超预算的图片保留替代文字并警告。图片数量/媒体和正式输出有配额；正式输出上限 16 MiB。
- 未在 Word/LibreOffice 中执行打开、分页、视觉排版验证。原生 Word 文件选择框到成功正式写盘未自动化；浏览器控制器取消为 0 写入，真实打包 Worker/CSP/取消与原生授权拒绝已验，原生二进制提交由 Rust 测试覆盖。
- 历史单快照 8 MiB、单文件 40 版、总量 192 MiB。保存前旧正文不能归档时会明确阻止覆盖，不能描述为“已备份”；新正文写盘成功但其历史失败会明确警告。迁移超配额保留旧来源，不淘汰成功记录。
- Front Matter 继续仅安全更新可精确往返的子集；复杂 YAML 回退源码。大纲不扩展跨文件/跨层语义。
- 本机全量与真实 Windows E2E 不等同于 Linux 远程 CI 重跑通过；未推送、不发布，最终远程结论待用户推送这些修复后产生新 run。

## 重跑命令与提交分组

```text
pnpm typecheck
pnpm build
pnpm test:smoke
pnpm test:regression
node scripts/run-regressions.mjs scripts/split-preview-regression.mjs scripts/markdown-live-toolbar-regression.mjs scripts/code-block-virtualization-regression.mjs scripts/math-editor-regression.mjs --repeat=3
node scripts/validate-docx.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
node scripts/repair05-native-build.mjs
node scripts/repair05-native-regression.mjs
node scripts/repair05-collect-evidence.mjs
```

Windows 原生命令只使用隔离验收 profile；系统 TEMP 不可写时先设置到专用可写目录。DOCX validator 需 .NET 8 SDK（或可构建 net8 的兼容 SDK 与运行时），NuGet locked restore；浏览器需安装匹配 Playwright Chromium。验收产物不包含用户正文，未提交可执行程序或 WebView profile。

| 回滚组 | Commit SHA |
| --- | --- |
| P0-1 TOC | `33a84b3` |
| P0-2 大纲 | `c323529` |
| P0-3 保存归档、路径与编码 | `efa6fe6` / `9ba8405` / `91a3cfb` |
| P0-4 迁移 | `ddb4073` |
| P0-5 请求与确认身份 | `d9d25df` / `52e9d91` / `2ce5d2f` |
| P1 DOCX | `a8f5089` |
| CI 及旧全量入口 | `9b66ba8` / `79ca42d` / `aaf81d8` / `1c2662c` / `e98c680` / `f4c4c7e` |
| 原生验收脚本 | `a425dd6` |

按组保留独立提交，未重写其他任务的提交历史；跨组依赖按 Git 逆序评估回滚。
