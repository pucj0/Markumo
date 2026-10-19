# Phase 06：Rust 原生层安全、并发与资源治理审计

- 仓库：`pucj0/Markumo`
- 审计基准：`742bcc764d496feb6345978d6065dcd264cbed99`
- 审计日期：2026-10-19
- 环境：Windows 11，`rustc 1.99.0`，`cargo 1.99.0`
- 结论：未发现可复现的 P0 授权越权或路径逃逸；确认并修复了 10 项 P1/P2 一致性与资源治理问题，另有若干平台竞态和产品契约限制保留为审计记录。

工作树说明：审计开始时已有 3 个未提交的 TypeScript 文件修改
（`src/editor/languages/index.ts`、`src/features/document-conversion/ExportAppearance.ts`、
`src/features/document-conversion/ExportStyles.ts`），本次未触碰；仓库根目录没有 `AGENTS.md`。

> 测试环境说明：本机系统临时目录对测试进程返回 `PermissionDenied`，因此测试使用
> `E:\code\lightEdit\src-tauri\target\test-tmp` 作为 `TEMP/TMP`。这是执行环境限制，
> 不是应用代码行为。正常 CI 使用系统临时目录即可。

## 1. 执行摘要

本阶段没有把“理论上可能”直接当作漏洞。所有标记为“已修复”的项都有代码证据和回归测试；
其余项只记录可利用条件、影响和当前缓解措施。

| 结论 | 数量 | 说明 |
|---|---:|---|
| 已确认 P0 | 0 | token 的 owner 绑定、释放、伪造拒绝、重复打开和窗口销毁清理均通过测试 |
| 已修复 P1 | 6 | IPC 图片数组上限、媒体只读 token 的 Hex 提权、硬链接图片、媒体版本身份、损坏会话备份、内部写入路径规范化 |
| 已修复 P2 | 4 | 搜索 token 锁中毒、工作区历史边界、偏好写入原子化、外部打开路由的锁外身份读取 |
| 仅记录（未改代码） | 15 | 包括转换命令的路径授权缺口、全局文件锁阻塞、保存 TOCTOU、Windows 原位写入契约等 |

明确没有改变的产品契约：

1. Windows 用户文档继续使用**保留文件身份的原位写入**，没有改成 `ReplaceFileW`，
   也没有把“原位写入”描述成与原子 rename 等价的掉电安全方案。
2. 文件 token 协议没有改名、没有改成不可预测密钥、没有改变 owner 绑定方式。
3. 没有重写前端 `DesktopStartup` 状态机，也没有改变 `SessionWriter` 的 IPC 形状。
4. 没有为了减少锁竞争而移除任何授权检查。

## 2. 信任边界

| 信任边界 | 入口 | 原生校验 | 资源所有者 | 残余风险 |
|---|---|---|---|---|
| WebView IPC | 所有 `#[tauri::command]`，参数可被渲染层构造 | `Window::label()` 作为 owner；token 必须属于当前 owner；路径重新 canonicalize；尺寸/数量上限 | 各 command 的 `State` | 渲染层仍是最大信任边界；字符串/普通数组在 handler 前由 serde 分配（图片字节数组已改为限长反序列化） |
| 原生文件/目录选择 | `open_dialog`、`save_dialog`、目录/图片选择器 | 选择器返回的绝对路径仍走 `checked_path`；保存目标再次校验 | `FileService` grant | 选择器本身的信任由 OS 提供 |
| 拖放与剪贴板 | `native-file-drop`、`open_dropped_files`、`clipboard_image_files` | 原生路径生成 `image_inputs` capability；owner 绑定；使用前重新校验 | `FileService.image_inputs` | 同一用户可在拖放后替换路径；使用时校验可检测大部分变化 |
| 最近文件/会话 | `open_recent`、`persist_session`、`initialize_launch` | 最近列表是用户级历史；会话路径要求绝对、无 `..`、大小/数量上限；token 转路径时校验 owner | `FileService` + `SessionStore` | `open_recent` 是跨窗口共享的用户历史，不是跨 owner token 复用（设计如此） |
| 工作区根目录 | 目录选择器、拖放目录、恢复历史 | `validate_under_root`：绝对路径、拒绝 `..`、逐级拒绝 symlink/junction/reparse point、canonical 前缀比较 | 每窗口 `WorkspaceService` | 验证与后续 IO 之间仍有本地同用户 TOCTOU 窗口（见 R-03） |
| 应用数据 | `files.json`、`workspaces.json`、`last-session.json`、`pending-update.json`、`editor-settings.json` | 逐文件大小上限；JSON schema/字段校验；原子替换；会话损坏保留备份 | `FileService`/`WorkspaceService`/`SessionService`/`UpdateCoordinator` | 本地同用户可直接改写这些文件；应用按不可信输入重新校验 |
| 更新 | updater 插件、`begin_update_install`、pending marker | 签名/下载由 updater 插件负责；进程内 owner lease；窗口数和注册数检查；版本三段校验 | `UpdateStore` | 窗口 dirty/busy/composing 由各窗口前端上报，原生只能校验结构，不能独立证明编辑器状态 |
| 外部启动/单实例 | argv、`--`、second-instance 回调 | `argument_paths` → `normalize_external_paths` → `checked_path`；launch registry 原子决策；最多 16 窗口 | `LaunchStore` + `FileService` | 并发外部打开与 UI 打开之间仍可能出现窄窗口重复标签（前端按路径去重并释放多余 token） |
| 转换命令（本阶段未改） | `save_binary_file`、`pandoc_export_docx`、`pandoc_import_docx`、`print_to_pdf` | 目前没有 token/lease；路径由前端传入 | 无原生 capability 所有者 | **已确认的信任边界缺口，见 R-01；需要单独决策，不在本阶段直接改产品契约** |

## 3. 资源所有者与生命周期

| 资源 | 所有者 | 创建 | 释放/上限 | 回归证据 |
|---|---|---|---|---|
| 文档 grant | `FileService.grants` | `open_selected`、`prepare_target` | `release`（仅 owner）、`release_owner`（窗口销毁） | `files::grant_tests` |
| 文档 token 代数 | `next_token` | 每次打开/另存为递增 | 不回收字符串；释放后不可再访问 | `grants_are_owner_bound_and_release_is_irreversible` |
| 图片输入 capability | `FileService.image_inputs` | `image_inputs`（拖放/剪贴板/选择器） | 每个 owner 最多 100；`release_image_inputs`、`release_owner` | `dropped_directory_tokens_are_window_scoped_and_revocable` |
| 图片读取授权 | `image_reads` | `authorize_image_read`、`import_image` | 每文档最多 1024；随文档 token 释放 | `markdown_image_reads_are_window_scoped_and_require_explicit_scope` |
| 图片目录授权 | `image_directories` | `authorize_image_directory` | 随文档 token 释放 | `closing_a_window_releases_documents_and_image_capabilities` |
| 工作区服务 | `WorkspaceStore` 每窗口 `Arc<Mutex<WorkspaceService>>` | `register_window` | 窗口 `Destroyed` 时 `remove` | `workspace::guard`、`workspace::service` |
| 启动记录 | `LaunchStore` | `register_window` | `cleanup_window`、窗口 `Destroyed` | `session::routing_tests` |
| 会话 | `SessionStore` | `initialize_launch`/`persist_session` | 单文件原子写；损坏文件保留备份 | `session::session_tests` |
| 更新租约 | `UpdateStore` | `begin_update_install` | `end_update_install`、owner 窗口销毁 | `commands::update::tests` |
| 搜索取消 token | `SearchManager.tokens` | `create_token` | `cancel`、`cleanup`、完成时清理 | `workspace::search::tests` |
| 媒体读取名额 | `ACTIVE_MEDIA_READS` | `read_media_chunk` | RAII `MediaReadPermit`，上限 4 | `commands::files::tests` |

前端侧的补充：`DocumentManager` 只在最后一个 pane 引用关闭时触发 `release`；
`FileController` 对重复打开的失败方 token 立即释放；窗口 `dispose` 释放当前所有 token。
这些行为在本次审计中按调用方核对，未改动。

## 4. 锁与作用域

| 锁 | 保护对象 | 持有范围 | 中毒处理 |
|---|---|---|---|
| `FileStore = Arc<Mutex<FileService>>` | grants、图片授权、最近文件/布局 | 整个命令动作，包含读盘/写盘 | `operate` 返回 `state` 错误 |
| `WorkspaceStore.windows` | label → 工作区服务 | 查找/插入/删除，短 | 返回错误；销毁清理失败时保留旧条目 |
| `WorkspaceService`（每窗口） | 根目录、目录树、历史 | 目录遍历、文件打开、重命名/删除/移动 | 返回错误 |
| `LaunchStore` | 窗口启动/待打开队列 | 路由决策、注册 | 启动/路由返回错误 |
| `SessionStore` | 上次会话 | 加载/保存 | 会话命令返回错误 |
| `UpdateStore` | 安装 owner、窗口状态、进程标识 | 安装租约、pending marker 读写 | 更新命令返回错误 |
| `SearchManager.tokens` | 搜索取消 token | 短暂 map 操作 | **主动恢复中毒 guard**（F-07） |
| `settings::WRITE_LOCK` | 设置文件写入 | 序列化+原子写 | 返回错误 |
| Windows 目录锁（`images::lock_directory`） | 阻止目录被重命名/替换 | 图片读取/导入期间 | 打开失败即返回错误 |

锁顺序（静态审查）：

1. `UpdateStore` → `LaunchStore`（`register_window`、`begin_update_install`）。
2. `UpdateStore` → `WorkspaceStore` → `LaunchStore`（`register_window`）。
3. `WorkspaceStore`（短）→ 每窗口 `WorkspaceService` → `FileStore`（`open_workspace_file`、
   `rename_workspace_node`、`delete_workspace_node`、`move_workspace_node`）。
4. `FileStore` 释放后才进入 `SessionStore`（`persist_session`）。
5. `SessionStore` 加载在 `WorkspaceService`/`FileStore` 之前且立即释放（`initialize_launch`）。

未发现反向嵌套路径（例如持有 `SessionStore` 再等 `FileStore`，或持有 `FileStore`
再等 `WorkspaceStore`）。`route_launch` 先取 `FileStore` 快照并释放，再取
`LaunchStore` 做原子决策，两个锁不同时持有。窗口 `Destroyed` 的 update/workspace/
launch/files 清理也都是顺序短临界区。

> 这是静态审查 + 现有命令结构结论，不是运行时锁序检测器结论；新增命令仍需保持上述顺序。

## 5. 可能阻塞的操作

| 操作 | 持有什么 | 阻塞上限/风险 | 影响 | 现状 |
|---|---|---|---|---|
| `operate` 内的文本打开/保存 | `FileStore` | 单文件 16 MiB 读/写、编码转换、fsync | 慢磁盘/锁定文件可阻塞所有窗口 | 保留；见 R-02 |
| `read_media_chunk` | `FileStore` + 4 个全局名额 | 256 KiB 读取 + 头部检查 | 最多 4 个并发；慢盘仍阻塞其他文件命令 | 名额 RAII 已验证；锁粒度见 R-02 |
| Markdown 图片读取/导入 | `FileStore` + Windows 目录锁 | 4 MiB 图片、逐级目录锁 | 目录被锁期间写操作会等待 | 设计如此 |
| `open_workspace_file` | 每窗口工作区锁 + `FileStore` | 16 MiB 文件打开 | 同窗口工作区操作等待，全局文件操作也等待 | 保留；见 R-02 |
| `rename/delete/move_workspace_node` | 工作区锁 + `FileStore` | 删除整棵目录、重命名、偏好持久化 | 长删除会阻塞所有窗口的文件命令 | 保留；见 R-02 |
| `initialize_launch` 会话加载 | `SessionStore` | 512 KiB JSON 读取 | 在 async command 线程同步执行 | 见 R-10，量小 |
| `persist_session` 会话保存 | `SessionStore` | JSON 序列化+临时文件+fsync+替换 | 在 async command 线程同步执行 | 见 R-10 |
| `get_recent_workspaces` | 每窗口工作区锁 | 取最近列表 | 在 async command 线程同步执行，可等长目录操作 | 见 R-10 |
| `search_workspace` 取 roots | 每窗口工作区锁 | 克隆 roots | 在 async command 线程同步执行 | 见 R-10 |
| update marker 命令 | `UpdateStore` | 读/写/删除 ≤8 KiB | 同步命令，持租约锁 | 量小，保留 |
| 文件/目录选择器、Pandoc、打印 | 无全局锁 | OS 对话框/子进程 | 已使用 `spawn_blocking` | 符合要求 |

## 6. 失败后的清理路径

| 场景 | 清理/保护 | 证据 |
|---|---|---|
| 保存前版本变化 | `atomic::write_checked` / `in_place_write` 比较磁盘版本；拒绝覆盖 | `external_change_blocks_save_and_preserves_both_versions` |
| 保存目标被删除 | 拒绝覆盖，不重新创建 | `deleting_a_prepared_save_target_blocks_overwrite_instead_of_recreating_it` |
| 保存目标变成目录 | `checked_path` 拒绝；目标保持目录 | `replacing_a_prepared_target_with_a_directory_is_rejected` |
| 保存父目录被替换为链接 | canonical 路径变化 → `scope` | `replacing_the_save_parent_with_a_link_is_rejected` |
| 临时文件创建/写入/fsync/替换失败 | 原目标不变；临时文件由 `TempFile/TempPath` 清理 | `atomic_temp_failures_keep_the_existing_target_intact` |
| 新目标在验证后被竞争创建 | 无覆盖分支失败，保留竞争者文件 | `a_new_target_created_after_validation_is_never_overwritten` |
| Windows 备份创建失败 | 写入前失败，原文件不变 | `backup_creation_failure_keeps_the_original_document` |
| Windows 写入中途失败/部分写入/fsync 失败 | 原位回滚到原字节 | `write_failure_and_partial_write_are_rolled_back` |
| Windows 回滚也失败 | 保留 fsynced 备份并在错误中报告路径 | `failed_rollback_keeps_a_readable_backup_and_reports_its_path` |
| 只读目标 | 拒绝写入，内容不被截断 | `read_only_target_is_not_truncated` |
| token 释放/窗口销毁 | grants、image_reads、image_directories、image_inputs 清理 | `closing_a_window_releases_documents_and_image_capabilities` |
| 媒体读取成功/错误/任务 panic | RAII permit 归还 | `media_read_permits_are_released_on_success_error_and_panic` |
| 搜索任务 panic 导致锁中毒 | 取消 registry 恢复可用 | `poisoned_cancellation_registry_keeps_cancel_and_cleanup_available` |
| 会话文件损坏 | 重命名为 `last-session.corrupt-<nanos>.json` 后再写入干净会话 | `corrupt_session_is_preserved_before_a_clean_session_replaces_it` |
| 会话过大 | 写入前拒绝，旧会话不变 | `an_oversized_session_is_rejected_before_the_previous_file_is_touched` |
| 更新标记损坏/版本无效 | 不删除不可读标记；无效版本不覆盖旧标记 | `oversized_or_corrupt_pending_marker_is_preserved_for_diagnosis`、`invalid_target_version_is_rejected_without_replacing_the_marker` |

## 7. 已确认并实施的修复

| ID | 级别 | 问题与证据 | 影响 | 修复 | 回归 |
|---|---|---|---|---|---|
| F-01 | P1 | `import_markdown_image` 的 `bytes: Option<Vec<u8>>` 在 handler 检查 4 MiB 之前就完成 IPC 反序列化 | 异常/恶意渲染层可用超大 JSON 数组造成瞬时内存压力 | `ImageBytes` 自定义 `Deserialize`，在读取序列时按 4 MiB 截断（`files/images.rs:181`） | `oversized_clipboard_image_payload_is_rejected_while_deserializing` |
| F-02 | P1 | `FileService::reopen` 对只读媒体 token 也允许 `"Hex"`，会生成可写文本 grant | 只读 PDF/图片预览可被切换成字节编辑并保存 | 对“非 writable 且 `media::inspect` 确认为媒体”的 Hex 重开返回 `scope`（`files/mod.rs:270`） | `read_only_media_cannot_escalate_to_writable_hex_but_text_can` |
| F-03 | P1 | `write_checked` 用调用方传入的路径拼写做最终 canonical 比较；配置目录是 symlink/junction 时拒绝所有写入 | 链接式配置目录下内部写入失败 | 入口统一 `checked_path(path, true)` 规范化（`files/atomic.rs:67`）；`persist` 改走同一原子写入（`files/mod.rs:191`） | `atomic_write_accepts_a_linked_configuration_parent`、`preferences_persist_through_a_linked_configuration_directory` |
| F-04 | P1 | 图片读取只检查重解析点，不检查硬链接；文本/媒体已拒绝硬链接 | 图片授权边界与文本/媒体不一致 | Windows 用 `GetFileInformationByHandle`、Unix 用 `nlink()` 拒绝硬链接（`files/images.rs:281`） | `hardlinked_images_are_rejected_consistently_with_other_files` |
| F-05 | P1 | 媒体版本只有 `长度+mtime`；替换成同长度、恢复 mtime 的不同文件不会被识别 | 查看器可能混用两个文件的 chunk | 版本加入原生文件身份（Windows volume+file index；Unix dev+ino）（`files/media.rs:174`） | `replacing_a_media_file_with_an_identical_size_and_mtime_is_detected` |
| F-06 | P1 | `SessionService::load` 对损坏/超大/无效会话只返回错误，随后启动流程会用空会话覆盖原文件 | 用户历史会话被清除，无法恢复 | 覆盖前重命名为一次性 `.corrupt-*.json` 备份并在警告中报告路径（`session.rs:366`） | `corrupt_session_is_preserved_before_a_clean_session_replaces_it` |
| F-07 | P2 | `SearchManager` 对 `Mutex` 使用 `unwrap`；一个搜索任务 panic 后所有后续取消/创建都会 panic | 搜索取消能力永久失效 | 受控恢复中毒 guard（`workspace/search.rs:49`） | `poisoned_cancellation_registry_keeps_cancel_and_cleanup_available` |
| F-08 | P2 | `WorkspaceService::configure` 无上限 `read_to_string`，且不限制历史条数/路径长度 | 损坏/外部编辑的 `workspaces.json` 可造成启动内存/UI 压力 | 256 KiB 上限 + 10 条 recent/16 个 root/32 KiB 路径截断（`workspace/service.rs:95`） | `oversized_preference_file_is_ignored_without_loading_it`、`corrupt_history_is_truncated_to_the_documented_limits` |
| F-09 | P2 | `owner_of_path` 在持有全局 `FileStore` 时打开文件读取 native identity | 锁定/慢文件可阻塞所有窗口的外部打开 | identity 在加锁前计算，`owner_of_path` 不再做文件 IO（`lib.rs:81`、`files/mod.rs:369`） | `owner_lookup_uses_the_canonical_key_or_a_supplied_native_identity` |
| F-10 | P2 | 内部偏好写入原先自行创建临时文件，未经过校验/版本检查 | 与统一写入路径行为不一致 | `persist` 使用 `atomic::write_checked`（`files/mod.rs:191`） | 同上 F-03 两条回归 |

## 8. 仅记录、未改代码的风险

| ID | 级别 | 证据/条件 | 影响 | 当前缓解 | 建议 |
|---|---|---|---|---|---|
| R-01 | P1（需决策） | `commands/conversion.rs:190` `save_binary_file(path, bytes)` 直接接受前端路径；`pandoc_export_docx`/`pandoc_import_docx`/`print_to_pdf` 也接收输出路径；`save_binary_file` 的 fallback `fs::copy` 忽略错误，目标已存在时可能返回成功 | 渲染层可写任意路径；复制失败时可能留下部分目标却报告成功 | 前端正常只传原生对话框返回值 | 单独阶段为导出/导入增加原生 lease；复制失败必须返回错误；不要在本阶段顺手改导出契约 |
| R-02 | P2 | `FileStore` 是全局 `Arc<Mutex<FileService>>`，`operate` 在锁内完成 16 MiB 读写/fsync/图片扫描 | 慢磁盘、锁定文件或大文件可阻塞所有窗口 | 4 个媒体名额；迁移/打开流程有上限 | 后续可把“授权快照 + 锁外 IO + 锁内复核”拆开，但不能移除 owner/canonical 校验 |
| R-03 | P2 | `checked_path`/`disk_version` 校验与实际 open/replace/in-place write 之间仍有状态变化窗口；Windows 上 `FILE_SHARE_READ|DELETE` 不能驱逐已存在的写句柄 | 本地同用户进程可在窗口内替换路径或写入 | 最终版本复检、Windows write guard、硬链接/重解析点检查、canonical 复核 | 记录为平台竞态；不要声称 canonicalize 已完全消除 TOCTOU |
| R-04 | 产品契约 | Windows 原位写入不是掉电原子操作；中间断电可能留下截断/部分内容 | 极端掉电场景可能损坏当前文档 | 写入前 fsynced 备份；失败回滚；回滚失败保留备份并报告 | **不改**为 `ReplaceFileW`（会改变 Explorer 文件身份行为）；需要人工确认是否接受该取舍 |
| R-05 | P2 | 原位写入打开时排除“新”写者，但已持有写共享句柄的进程仍可能继续写 | 外部写入与保存交错 | 版本从同一 handle 复核；失败回滚 | 可评估 `LockFileEx` 区间锁，但会影响其他程序兼容性 |
| R-06 | P2 | 媒体版本已含文件身份，但同一 inode 的原位修改若保持长度和 mtime，仍无法检测 | 极端外部修改下 chunk 可能不匹配 | 每次 chunk 前后复检版本；前端可重新加载 | 不建议对每个 256 KiB chunk 做全文件哈希；保持现有预算 |
| R-07 | P2 | 会话文件有效但所有标签恢复失败时，前端 `adopt` 仍会立即持久化空标签；警告可见但历史被替换 | 可移动磁盘离线等场景下丢失会话拓扑 | 损坏文件已备份（F-06）；错误会 toast | 需要产品决策：是否在“零标签恢复且错误非空”时跳过首次空会话写入 |
| R-08 | P2（未验证） | macOS 默认大小写不敏感，但 `PathKey` 只在 Windows 折叠大小写；`validate_under_root` 的 `starts_with` 也是大小写敏感比较 | 可能重复标签或拒绝合法路径 | canonicalize 通常返回真实大小写 | 需要 macOS 实机回归，不在 Windows 上臆测为漏洞 |
| R-09 | P2 | 除图片字节数组外，普通 `String`/`Vec` IPC 参数在 handler 的尺寸检查前已由 serde 分配 | 恶意渲染层可用超大字符串造成瞬时内存压力 | 各 handler 随后拒绝超限 | 如需强保证，需要为文本/会话输入引入限长反序列化新类型 |
| R-10 | P2 | `initialize_launch` 的会话加载、`persist_session` 的会话保存、`get_recent_workspaces`/`search_workspace` 的 roots 读取在 async command 线程同步执行 | 慢磁盘/长工作区操作会占用 async worker | 数据量小；其他重 IO 已 `spawn_blocking` | 后续把 `SessionStore` 改为可克隆 `Arc<Mutex<_>>` 后移入 `spawn_blocking` |
| R-11 | P2（范围外） | `pandoc_import_docx` 对 Pandoc 产出的 Markdown 使用无上限 `read_to_string` | 超大导出结果可能造成内存压力 | Pandoc 输入通常受用户文档限制 | 单独阶段加 16 MiB 上限 |
| R-12 | P3 | `checked_path` 未显式拒绝 Windows `DeviceNS`/特殊 verbatim 前缀；只过滤 ADS、相对路径、`..`、symlink、硬链接 | 本地同用户可构造设备命名空间路径 | 路径主要来自原生选择器/最近列表/工作区 | 若威胁模型包含被篡改的 `files.json`，可增加 Prefix 白名单 |
| R-13 | P3 | `read_class_hex` 允许任何只读 token 读取前 16 KiB hex 页 | 同窗口可读媒体/ClassFile 字节 | 本来就是只读能力；不产生写权限 | 可改为要求 ClassFile grant，但会改变既有只读查看行为 |
| R-14 | P3 | `open_recent` 使用全局最近文件历史，任意窗口都可重新打开历史路径 | 跨窗口路径复用 | 最近历史本来就是用户级 UI 数据 | 若未来要求窗口级历史，需要单独产品设计 |
| R-15 | P3 | 搜索任务在 `cleanup` 前 panic 时 token map 可能留下条目 | 少量内存直到同 id 重用/进程退出 | 搜索任务主体不分配可 panic 的复杂状态；锁中毒已恢复 | 可用 RAII guard 包住 cleanup |

> 定级说明：R-01 按“本地应用渲染层仍是可信执行基座、但应做纵深防御”的模型定为 P1。
> 如果项目决定把渲染层视为完全不可信（例如未来允许远程内容或第三方插件进入主 WebView），
> R-01 应升级为 P0，并在同一阶段为所有导出/导入命令引入原生 capability lease。

## 9. 自动化测试

最终命令：

```powershell
$env:TEMP='E:\code\lightEdit\src-tauri\target\test-tmp'
$env:TMP=$env:TEMP
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

结果：`72 passed; 0 failed; 0 ignored`。

覆盖矩阵：

| 领域 | 测试 |
|---|---|
| token owner/释放/伪造/重复打开/并发窗口 | `files::grant_tests` 8 项 |
| 相对路径、`..`、ADS、symlink、硬链接、只读、外部修改、目标删除/目录替换/父目录链接 | `files::path_tests` 9 项 |
| 原子写入故障注入、原位写入回滚、回滚失败备份 | `files::atomic::save_safety_tests` 6 项 |
| 媒体范围溢出、token 跨窗口、媒体身份、只读 Hex 提权 | `files::media::tests` 5 项 |
| 图片硬链接、图片目录/读取授权、IPC 数组上限 | `files::images` 6 项 |
| 会话 owner、大小上限、损坏备份、非法路径/编码 | `session::session_tests` 5 项 |
| 外部打开路由/窗口上限/销毁 owner | `session::routing_tests` 4 项 |
| 工作区 guard（含 junction） | `workspace::guard::tests` 3 项 |
| 工作区历史边界 | `workspace::service` 3 项 |
| 搜索锁中毒 | `workspace::search::tests` 1 项 |
| 更新租约/标记 | `commands::update::tests` 5 项 |
| 媒体读取名额 | `commands::files::tests` 1 项 |
| 既有设置/迁移/应用链接回归 | settings 12 + profile 3 + app 1，共 16 项 |

`cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 通过，无编译错误。

## Phase 06.1 follow-up

Phase 06.1 (`806114e` 之后的媒体版本修复) 进一步收紧了 F-05/R-06：

- 媒体版本现在除长度、mtime、Windows volume+file index / Unix dev+ino 外，还包含
  creation time、Unix ctime（含 nsec）或 Windows `FILE_BASIC_INFO.ChangeTime`，
  以及文件首/尾各 4 KiB 的 SHA-256 采样。
- 采样是固定上限的，不读取整份媒体文件，也不对每个 256 KiB chunk 做全文件哈希；
  详细数据、测试和残余限制见
  [Phase 06.1 媒体版本审计](phase-06.1-media-version-audit.md)。
- Windows 文件身份保存策略、token/owner 校验和 `read_media_chunk` 的 `conflict`
  行为均未改变。
- Phase 06.1 最终测试：Windows 76 项、Linux 73 项全部通过（Linux 基线 69 项，另新增 4 项媒体测试）。



---

## 10. 文件与人工决策点

本阶段修改的 Rust 文件：

- `src-tauri/src/files/atomic.rs`
- `src-tauri/src/files/mod.rs`
- `src-tauri/src/files/media.rs`
- `src-tauri/src/files/images.rs`
- `src-tauri/src/commands/files.rs`
- `src-tauri/src/commands/update.rs`
- `src-tauri/src/session.rs`
- `src-tauri/src/workspace/search.rs`
- `src-tauri/src/workspace/service.rs`
- `src-tauri/src/workspace/guard.rs`
- `src-tauri/src/lib.rs`

需要人工决策的事项：

1. **R-01 转换命令路径授权**：是否为导出/导入增加原生 lease，并修正 `save_binary_file` 的复制错误处理。这会改变导出/导入 IPC 契约。
2. **R-04 Windows 原位写入取舍**：保留文件身份优先，还是改为原子替换优先。当前代码和本次审计都明确保留“身份优先”，没有擅自改成 `ReplaceFileW`。
3. **R-07 恢复零标签时的空会话写入**：是否在“所有标签都恢复失败”时跳过首次持久化，保留旧会话等待下一次启动。这需要产品行为确认。
4. **R-08 macOS 大小写语义**：需要在 macOS 实机验证后再决定是否调整 `PathKey`/guard 比较。
