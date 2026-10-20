# Phase 06.2：导入导出授权与安全写入

- 基准：`d42bbe3b9cb7e8230f4f75be009a75653df3424f`
- 日期：2026-10-19
- 状态：实现与本地验证完成，等待人工验收；未提交、未推送、未发布。
- 开始时已有三个 TypeScript 工作树修改：`languages/index.ts`、`ExportAppearance.ts`、`ExportStyles.ts`。未编辑这些文件。

## 1. 写入缺陷的先失败证据

修改写入实现前，将旧 `save_binary_file` 的阻塞体提取成可直接执行的函数，注入真实文件系统失败：创建已有目标，设为只读，再尝试导出。
Windows 上 rename 与 copy 均失败，但旧实现因为 `target.exists()` 为真返回 `Ok(())`。

```text
copy_failure_must_not_be_reported_as_success ... FAILED
copy failed, but the existing target made the command report success
0 passed; 1 failed
```

随后删除旧路径写入实现。最终同名回归经过新的原生授权/提交逻辑，断言错误返回、原文件字节不变。
生产实现没有 copy 到最终二进制目标的回退，因此不存在“忽略 copy 错误后判断 exists”的路径。

## 2. 四类命令的新边界

| 命令 | 接受的授权及输入 | 最终写入 |
|---|---|---|
| `save_binary_file` | 当前窗口、单次 HTML 或 PNG write lease；`format` 必须匹配；限长 `BinaryBytes` | HTML 要求非空 UTF-8；PNG 检查签名与尺寸头；通过 atomic 提交 |
| `pandoc_export_docx` | DOCX write lease、限长 Markdown、可选现有 `documentToken` | 两次 sandbox 转换，输出到受控临时文件；验证 ZIP 必需结构、条目名、解压预算，再提交 |
| `pandoc_import_docx` | DOCX read lease + Markdown write lease | 原生读取并验证来源；Pandoc 不写最终 Markdown，不执行 `--extract-media`；原生写独立资源子目录，Markdown 最后提交 |
| `print_to_pdf` | PDF write lease、限长 HTML、现有 options | WebView2 写受控临时 PDF；完成、非空、`%PDF-` 和尾部 `%%EOF` 检查后提交 |

这四个命令保留原名字，但删除任意目标路径参数；仅给旧参数而没有 token 会被 Tauri 参数解析拒绝。
添加额外 `path`、`outputDocxPath`、`resourceDir`、`mediaDir` 等字段不能改变 lease 内部路径。
没有注册旧实现的别名或绕过授权的兼容命令。

新增 `read_conversion_html(token)`，直接读取原生打开对话框选中的 HTML。
前端不再用 `reopen_file(token: null)`、asset URL 或再次打开文件对话框猜测来源。
新增 `release_conversion_lease(token)`，只能释放当前窗口的授权，重复释放无副作用。

## 3. lease 所有权和生命周期

唯一授权状态位于 `ConversionStore`，由 Tauri `.manage()` 创建一份。窗口注册/Destroyed 接入现有生命周期。

- 原生对话框返回后才创建 `{ path, token }`；取消返回 null，不创建 lease。
- token 使用 OS 随机源生成 24 字节，48 个十六进制字符。
- 绑定原生 Window label 对应的 owner 实例、canonical 路径、Purpose、原生磁盘版本、到期 Instant。
- Purpose 分为 HTML、PNG、PDF、DOCX、Markdown、ReadHtml、ReadDocx。HTML plain 与带样式 HTML 同属 HTML 文件类型。
- 单次使用：命令接受操作时即占用；成功、错误、panic 解栈后均释放。失败重试也重新选址。
- 最长 10 分钟。过期 token 验证失败；下次创建授权时回收过期记录。每窗口至多保留 8 个记录。
- 关闭窗口使 owner 失效并取消所有 lease；关闭前打开、关闭后才返回的对话框不能创建新授权。
- 主动 release 可取消在途操作；工作线程在阶段边界、进程轮询及最终提交前检查取消/到期。
- 每窗口最多 1 个转换，全局最多 2 个。相同 canonical 目标不能跨窗口同时转换；等待转换的用户需重新选择，避免沿用旧版本。
- 全局 registry 锁只做状态操作；不在其中打开原生对话框、等待 Pandoc 或进行文件提交。
- 最终提交与取消/关闭使用该 owner 的短期提交锁排序，不占用其他窗口的转换锁。

本地图片不是另一份任意路径权限：通过现有 `FileService::markdown_image` 验证 document token、owner、文档附件目录、已授权图片/目录和原生工作区根目录。
不再接受前端 `resource_dir`；没有文档授权时不能读取本地图片。
图片读取复用现有文件服务的 4 MiB 单图片读取契约；Pandoc 等待不持有 FileStore 锁。

## 4. 提交和冲突保护

`files::atomic` 增加转换专用入口，复用原有唯一 NamedTempFile、权限检查、Windows ReplaceFileW / Unix rename、新目标 no-clobber 机制。
普通用户文件的 Windows 原位写入和文件身份策略没有改变。

1. 用 lease 创建时的完整内容 hash/长度/mtime 版本进行检查。
2. 在目标同目录写唯一临时文件，设置权限并 `sync_all()`。
3. 再检查 canonical 路径、祖先链接、目标版本、只读属性。
4. 最终验证 owner、取消、期限和版本，再提交。
5. 创建、临时写、同步和提交前的错误自动清理临时文件；不截断旧目标。

转换专用入口把所有会导致返回错误的同步放在替换之前，避免“Markdown 已替换，但目录 fsync 报错，调用方误删已被新 Markdown 引用的媒体”。
它保证正常运行时原子可见性，不承诺断电后的目录项持久性；普通内部状态写入仍保留原来的替换后目录 fsync。
Windows 罕见的部分 ReplaceFile 失败沿用 atomic 的恢复备份及错误路径提示，不能把这种 OS 错误描述成目标路径一定未变。

### 现有原生原子层的残余竞态

新目标使用 no-clobber，应用内相同目标也已互斥。已有目标在最终版本检查与 OS rename/ReplaceFile 之间仍继承现有 atomic 的极小跨进程 TOCTOU 窗口。
Windows 写保护句柄拒绝普通并发写入，但允许删除/重命名；Unix 无跨进程强制 CAS。
因此，这次不能宣称对恶意同权限进程在最终检查瞬间进行路径交换具有严格无竞态保证。
要提高到这一标准，需要专门的目录/文件句柄与平台提交协议，不应通过改变普通保存策略或不安全回滚扩大本阶段范围。
若验收把这一严格保证列为硬性 P0，**此项仍是未解决的验收/Phase 07 阻塞**，不能仅凭现有回归变绿判定消除。

## 5. Pandoc、媒体和多目标恢复

### 导出

Pandoc 先将 GFM 转 JSON。Rust 遍历实际 Image 节点，本地资源经既有文档权限读取，网络图片经限时限量 HTTP(S) 读取，内嵌图片也受大小和签名检查。
将图片改为 data URI 后再由 sandbox JSON writer 生成 DOCX。Pandoc 的 `resource-path` 从未用作权限检查。
临时 Markdown、JSON、DOCX、stdout/stderr 全在拥有所有权的临时目录中。

### 导入

来源 DOCX 先冻结到临时副本。ZIP 的所有成员都检查绝对路径、`..`、反斜杠、备用数据流、设备名、链接、重复名字、单项和总解压长度，实际解压也受限。
Pandoc 只执行 sandbox DOCX → JSON → GFM，不获得提取媒体到文件系统的参数。
原生仅复制已验证 `word/media/` 中实际被引用的资源，拒绝其他本地图片引用。

媒体路径安全推导为：

```text
<Markdown 父目录>/<stem>.assets/import-<随机 ID>/media/...
```

每次导入使用新子目录；已有 `<stem>.assets` 和旧图片从不覆盖。
媒体复制与文件同步全部成功后才提交 Markdown。Markdown 提交失败、复制失败、取消或超时会清理本次子目录。
清理被 OS 拒绝时记录明确路径；旧 Markdown 和旧图片保留。
成功重导入不自动删除旧批次，因为其他文档可能引用它们。
进程崩溃/断电可能留下未被 Markdown 引用的 `import-*` 孤立目录；恢复时保留旧 Markdown，确认没有引用后仅删除对应孤立批次。没有声称 Markdown+目录构成文件系统事务。

### Pandoc 包装兼容性

Debian trixie 的 Pandoc 3.1.11.1 未内嵌 data files：真实测试在 sandbox DOCX writer 处失败（`Could not find data file data/data/docx/[Content_Types].xml`），旧目标未改动。
保留 sandbox 并给出安装官方构建的错误提示，没有为兼容该包而开放任意文件读取。
[Pandoc 官方手册](https://pandoc.org/MANUAL.html)明确说明 DOCX 等 writer 在 sandbox 下需要带 `embed_data_files` 的构建。

Windows 和 Linux 均已用官方 Pandoc 3.8.3 完成真实往返。
Linux CI 安装官方 3.8.3 tar 包并验证 SHA-256：
`c224fab89f827d3623380ecb7c1078c163c769c849a14ac27e8d3bfbb914c9b4`。
系统发行版未内嵌数据的 Pandoc 不属于本次安全 DOCX 导出的支持构建；这是需要人工验收确认的依赖兼容边界。

## 6. PDF 窗口与临时数据

- 仍使用隐藏 WebView2、既有 1.2 秒排版等待、既有 HTML/CSS/字体和 `PrintToPdf(..., None, ...)` 行为。
- CSP 在保持 standards doctype 的前提下先于输入内容生效，禁止脚本、frame、file 本地资源；保留 CSS、系统字体、data 和 HTTP(S) 图片/字体。窗口导航限定为本次打印文档。
- 打印 HTML 和浏览器 profile 均使用原生私有临时目录，不复用用户浏览器 profile。
- RAII 在所有退出路径请求销毁窗口；迟到回调只持有临时资源，不提交最终目标。
- WebView2 的 profile 文件可能在销毁后短暂被占用，原生拥有的目录最多重试清理 5 秒，最终失败明确记录路径。
- 30 秒打印超时；等待中检测取消和 PDF 大小。完整有效 PDF 才交给授权提交。
- 真实 WebView2 测试覆盖成功、创建窗口后的故障、短超时；断言没有隐藏窗口和临时 profile 泄漏。

实际输出经 PDF.js 解析为一页，包含标题、正文、代码和表格文本。SDK 测试程序缺少图标资源时有一条图标警告，不影响结果。
测试样本为 `test-results/conversion/native-webview2.pdf`，解析结果为同目录的 `native-pdf-inspection.json`。
纸张参数仍沿用基线：本机 `PrintToPdf(None)` 的样本为 612×792 pt；不能用本次测试宣称 A4/Letter/横纵向所有设置已重新验收，也未擅自改变原有 WebView2 打印参数。

## 7. 上限与资源影响

| 项目 | 上限 |
|---|---|
| 二进制 IPC、各最终输出、DOCX 来源、可覆盖的已有目标 | 16 MiB |
| Markdown / HTML / PDF HTML 输入 | 16 MiB UTF-8 |
| 中间 JSON 序列化体积 | 64 MiB |
| DOCX 解压总量、图片总量 | 64 MiB |
| ZIP 成员 / 实际媒体 | 4096 / 256 |
| Word 导出单张图片 | 4 MiB |
| 每窗口 lease / 并发 | 8 / 1 |
| 全局并发 | 2 |
| 单次转换 / 打印 / HTTP 图片请求 | 90 秒 / 30 秒 / 最多 10 秒且不越过转换期限 |
| Pandoc 临时输出监测 / stdout、stderr | 128 MiB / 各 1 MiB，错误详情最多读取 8 KiB |

数组反序列化逐字节检查，初始容量至多 64 KiB；不会按恶意 size_hint 一次预分配巨量内存。
Tauri 的原始 JSON 请求和前端 `Array.from` 仍有自身开销；限长 visitor 不等于流式 IPC，也不消除框架已分配的请求体。
JSON DOM 的对象开销高于其序列化体积。未测 RSS/吞吐基准，没有声称上述值为进程硬内存配额。
Pandoc 多了一次 JSON 转换和图片 base64 处理；换取原生验证所有本地资源路径。
磁盘版本复检对最多 16 MiB 的目标做内容读取/hash；不在全局 lease 锁里执行。
子进程按 20 ms 轮询退出、取消和预算；错误/超时执行 kill + wait 回收。未启用用户 filter、shell 或 PDF 外部工具链。

## 8. 前端 IPC 与流程

对话框从返回路径字符串改为 `{path, token}`。路径仅用于显示和默认名；原生命令只回传 token。
`PandocBridge` 的桌面分支发送 `token/documentToken` 或 `sourceToken/targetToken`，不发送任意来源/目标/媒体路径。
非 Tauri 的浏览器下载/打印/选文件行为保持独立；原有 Node fallback 不调用 Tauri 文件命令。

保留 HTML、HTML plain、PNG、PDF、DOCX 导出，HTML/DOCX 导入、默认名、原生筛选、外观、字体、图片嵌入设置、PDF 设置和错误通知。
导出图片读取绑定开始时的文档 token；不会因转换过程中切换活动文档而换成另一个文件的资源授权。
`exportRepeat()` 仍调用 `exportDocument()`，每次重新选择目标，没有持久化或恢复 lease。
lastExport 仅保存格式/路径显示/选项/时间，不保存原生 token；失败不更新成功历史。
所有已选授权在 finally 主动释放，导入第二个对话框取消也释放来源授权。

## 9. 自动化覆盖

| 要求 | 原生或真实流程测试 |
|---|---|
| 未授权路径、伪造、跨窗口、格式混用 | `unauthorized_paths_forged_cross_window_and_cross_format_tokens_are_rejected` |
| 到期、释放、关闭、迟到对话框 | `expiry_release_close_and_late_dialog_results_revoke_authority` |
| 慢提交期间先撤销 owner，再等待提交锁 | `closing_marks_owner_dead_before_waiting_for_an_existing_commit` |
| 取消无 lease、数量和全局并发 | `cancellation_has_no_lease_and_counts_and_concurrency_are_bounded` |
| 合法 token 不能改目标、相同目标互斥 | 上述授权测试及 `two_windows_cannot_convert_to_the_same_target_concurrently` |
| 旧 copy 误报、保留旧文件 | 先失败再修复的 `copy_failure_must_not_be_reported_as_success` |
| 写入/fsync/rename 注入、写期间外部变化、新目标竞争 | `temp_write_fsync_rename_and_external_race_fail_without_false_success` |
| 已修改/删除/替换为目录 | `changed_deleted_and_directory_targets_are_not_overwritten` |
| Pandoc 部分输出失败 | `pandoc_failure_and_invalid_docx_output_preserve_old_target` |
| ZIP 路径与 assets 链接逃逸 | `docx_member_traversal_and_assets_symlink_are_rejected` |
| 真实媒体 copy 故障、Markdown fsync 失败清理 | `docx_import_copy_or_markdown_commit_failure_cleans_only_new_assets` |
| 正常导入资源及最终 Markdown | `docx_import_stages_resources_and_commits_markdown_last` |
| 超大反序列化 | `oversize_ipc_rejected_in_deserializer_without_filling_entire_vector` |
| PDF 错误、取消、超时和无效输出 | `pdf_failure_timeout_cancel_and_invalid_output_drop_renderer_resources` |
| 原生 HTML/PNG、HTML 导入 | `valid_html_png_and_html_import_use_native_pipeline` |
| 原生 PDF 正常提交 | `pdf_valid_output_commits_and_csp_blocks_local_resources_without_css_changes` |
| 真实 Pandoc 含图 DOCX 往返 | `real_pandoc_docx_round_trip_with_embedded_and_authorized_local_images` |
| 真实 FileService 图片权限 | `word_local_images_require_the_real_document_scope` |
| 真实子进程超时退出回收 | `real_child_process_timeout_is_killed_and_reaped` |
| 全格式、导入、重复导出、取消、错误、历史、浏览器下载 | `scripts/conversion-regression.mjs`，实际 Controller、DocumentManager、Renderer + SDK mock IPC |
| 真实 WebView2 成功/失败/超时/清理 | `scripts/test-native-pdf.ps1`，原生窗口、原生 PrintToPdf |

SDK mock 仅替代浏览器中的 IPC 传输；授权、提交、Pandoc 和 PDF 错误逻辑另由上面的原生测试执行，没有把相似权限判断复制到 JS 中冒充原生验证。
转换前端回归加入 smoke 和全量套件，因此已有 Frontend Quality 会执行。
Rust 测试默认执行 Fake/权限/提交测试，有 Pandoc 时执行真实转换；CI 明确安装经校验的官方构建，并另跑真实往返。
真实 WebView2 测试为 Windows 显式 opt-in，避免无桌面 Linux 上的伪验证。

## 10. 验证结果

### Windows 11 / Rust 1.99.0 / Node 22.2 / Pandoc 3.8.3

| 命令 | 结果 |
|---|---|
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | **95 passed** |
| `scripts/test-native-pdf.ps1` | **1 passed**，真实 WebView2、有效 PDF、故障/超时清理；95 项未选中 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；既有 Node 模块 externalized 和 chunk 大小警告 |
| `pnpm test:smoke` | **12/12** |
| `pnpm test:regression` | **23/23** |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 失败：基线相同的 11 条 lib + 1 条 test；新增代码无新增诊断 |

系统 TEMP 的测试写权限限制仍沿用前阶段处理，命令设置 TEMP/TMP 为工作树 target 下的测试目录。
原生 PDF 脚本给测试 EXE 嵌入 Common Controls v6 manifest，解决测试 EXE 的 `TaskDialogIndirect` 加载问题；没有改应用清单、安装器或系统设置。

### Linux / Debian trixie 容器 / Rust 1.99.1 / 官方 Pandoc 3.8.3

- `cargo check --locked`：通过，仅既有 `workspace/guard.rs` 的 Unix `unused_mut` 警告。
- `cargo test --locked`：**92 passed**，含真实含图 DOCX 往返及图片权限拒绝。
- `cargo clippy --locked --all-targets -- -D warnings`：失败，10 条 lib + 1 条 test，均在既有文件/既有行；转换模块无新增诊断。
- 同容器基准 Clippy 为 14 条 lib + 1 条 test；本阶段清除了转换模块原有的 4 条 Linux import/mut 诊断，没有改动其他历史诊断。
- 发行版 Pandoc 3.1.11.1 已实际运行并记录不支持 sandbox DOCX 的失败，未将其标为通过。
- Linux 原生 PDF 仍为基线的“当前平台未实现”错误；未宣称支持 WebKit PDF。

### 历史 rustfmt / Clippy

基准通过 `git archive d42bbe3...` 提取到忽略的测试目录，独立运行同一 Clippy 命令验证。
Windows 基准和当前均为同样 12 条诊断：

- `commands/app.rs`：needless_return。
- `commands/settings.rs`、`workspace/service.rs`：derivable_impls。
- `commands/workspace.rs`：cmp_owned、needless_borrow。
- `commands/session.rs`：too_many_arguments。
- `files/classfile.rs`：manual_range_patterns、manual_is_multiple_of。
- `files/media.rs`：chunks_exact_to_as_chunks。
- `lib.rs`：两处 unnecessary_cast。
- `files/images.rs` 测试：cloned_ref_to_slice_refs。

`cargo fmt --all -- --check`：基准 19 个文件、当前 18 个文件存在历史差异；本次转换文件单独 rustfmt，未全仓格式化。
日志保留于 `test-results/phase62-clippy-*.log`、`phase62-rustfmt-*.log`。

## 11. 未验证与 GitHub Actions

- macOS、Windows ARM64、网络文件系统、断电/硬重启恢复和系统拒绝清理的极端情况未实机验证。
- 真实 WebView2 的全字体/全部纸张与方向组合未全面验收；保留基线版式策略。
- 远程 HTTP(S) 图片的所有 TLS/重定向组合未做端到端验证。
- 本阶段没有推送，所以没有包含新代码的 GitHub Actions run。
- 收尾的容器/旧测试缓存删除命令被自动审批策略阻止，工具未返回更具体原因；`markumo-phase62-check` 容器已停止，容器及 `markumo-phase62-cargo` / `markumo-phase62-target` Docker 缓存卷保留。工作树内的旧缓存位于忽略的 target/test-results 范围。最终原生 PDF 测试使用独立目录，仍通过“无新窗口/profile 泄漏”断言。
- 已查询基准 d42bbe3 的 [Quality Gate 39268317932](https://github.com/pucj0/Markumo/actions/runs/39268317932)，结果 success；这不能替代新代码的远程 CI。

## 12. Phase 07 与人工验收

实现和上表的本地验证已完成；没有修改 DocumentManager、Live Editor、MarkdownSourceBridge、更新安装协议、普通 Windows 文件身份保护、版本号或 UI 主题布局。
本阶段交付仍需人工确认官方 Pandoc 构建要求、资源独立批次的恢复策略及第 4 节的严格跨进程竞态边界。
尤其不能把“版本复检 + 应用内互斥”写成针对任意恶意同权限进程的原子 CAS。
若这一点属于验收必需的强保证，Phase 07 应继续阻塞，待单独确定平台提交方案。
停止本阶段工作，等待 Phase 06.2 人工验收，不自动进入 Phase 07。
