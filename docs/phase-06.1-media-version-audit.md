# Phase 06.1：媒体版本身份检测与 Linux CI 修复

- 仓库：`pucj0/Markumo`
- 基准 Commit：`806114e9ca8ca6155ce6e774921568080036fd3e`
- 失败 CI：<https://github.com/pucj0/Markumo/actions/runs/39260044881>
- 审计日期：2026-10-19
- 本地验证：Windows 11（`rustc 1.99.0`）与 Linux 容器（`rustc 1.99.1`）

## 1. Linux 失败根因

### 1.1 失败测试

CI 唯一失败：

```text
files::media::tests::replacing_a_media_file_with_an_identical_size_and_mtime_is_detected
```

用户提供的失败位置为 `src-tauri/src/files/media.rs:417`，现象是期望
`read_media_chunk` 返回 `conflict`，实际成功读取了 5 字节。

GitHub Actions API 的 job 元数据可以确认：

| Job | 结果 | 失败步骤 |
|---|---|---|
| Rust Quality | failure | `Rust cargo test` |
| Frontend Quality | success | — |

原始 job 日志接口返回 `403 Must have admin rights to Repository`，因此没有直接下载
完整日志；上面的失败测试名/行号来自用户提供的 CI 输出，本地 Linux 容器复现了同一
测试路径。

### 1.2 提交中的测试与版本公式

`806114e` 中该测试的替换步骤是：

```rust
fs::remove_file(&path).unwrap();
fs::write(&path, b"%PDF-2.0\n").unwrap();
file.set_times(FileTimes::new().set_modified(modified)).unwrap();
```

替换前后都是 9 字节，mtime 被恢复为原值。当时的版本公式只有：

```text
media-{len}-{mtime_ns}-{identity}
identity(Unix) = dev:ino
identity(Windows) = volume:file_index
```

Linux 在删除后立即重建时可能复用 inode。只要 `dev`、`ino`、长度和 mtime 都相同，
版本字符串就完全相同，`read_media_chunk` 便认为文件没有变化。

本地 Linux 容器在**干净 806114e worktree** 上复现了同一行：

```text
panicked at src/files/media.rs:417:70:
called `Result::unwrap_err()` on an `Ok` value: [37, 80, 68, 70, 45]
```

`[37, 80, 68, 70, 45]` 正是 `%PDF-`，与用户描述的“成功读取 5 字节”一致。

### 1.3 受控复现数据

使用 Docker Linux（`rust:1.99.1-slim`）和独立的 Rust probe，在两种文件系统上做
200 次“删除后立即重建、相同长度、恢复 mtime”：

| 文件系统 | 迭代 | inode 复用 | 旧版本（len+mtime+dev+ino）碰撞 | 仅加 ctime 的碰撞 |
|---|---:|---:|---:|---:|
| Docker Desktop 命名卷（VM 存储） | 200 | 200 | 200 | 199 |
| 容器 overlayfs `/tmp` | 200 | 200 | 200 | 198 |

一次代表性输出（overlay）：

```text
original: dev=91 ino=354450 len=9 mtime=1792416948149238189 ctime=1792416948.149238189
replacement-with-old-handle: ino=354451 len=9 mtime=1792416948149238189
old-handle still reports ino=354450
reuse #1: ino=354455 before_mtime=1792416948149238189 after_mtime=1792416948149238189
         before_ctime=1792416948.149238189 after_ctime=1792416948.149238189
         old_collision=true enhanced_collision=true
```

用同一台 Linux 容器直接比较“旧公式”和“新公式”：

```text
A old_ino=354510 new_ino=354511 old_version_collision=false new_version_collision=false
B iterations=200 inode_reused=200 old_version_collisions=200 new_version_collisions=0
```

A 场景保留旧句柄，替换文件无法复用 inode；B 场景 200/200 复用 inode，旧公式
200/200 碰撞，新公式 0/200 碰撞。

另外用 1.2 秒间隔的 probe 验证 ctime 本身会更新：

```text
created:                 ino=354453 ctime=1792416962.989403068
recreated-after-sleep:   ino=354453 ctime=1792416964.192631716
after-set-mtime:         ino=354453 ctime=1792416965.392588691
```

结论：

1. **确认 Linux 会复用 inode**；在即时删除/重建场景中 200/200 复用。
2. 旧版本公式与“长度+mtime 相同”组合会 100% 碰撞。
3. **仅加 ctime 不够稳定**：快速连续操作可能落在同一粗粒度时钟 tick，ctime 也相同。
4. 测试 A 还必须保留旧文件身份（旧句柄或旧链接），才能稳定验证“替换成不同文件”。
5. 最终实现需要同时加入原生变更时间与一个有界内容采样，不能只依赖 inode/时间戳。

> 说明：工作树中在本次修复前已经存在一份把 `remove_file` 改成 `rename` 的测试调整。
> 本次保留该调整，并进一步加入旧句柄；CI 基线 `806114e` 仍使用 `remove_file`，所以
> 失败是真实存在的，不是测试改名造成的。

## 2. 媒体版本算法修改前后

### 2.1 修改前

```text
media-{len}-{mtime_ns}-{identity}

identity(Windows) = volume_serial:file_index
identity(Unix)    = dev:ino
```

只依赖元数据；快速删除/重建且长度、mtime 相同时碰撞。

### 2.2 修改后

```text
media-{len}-{mtime_ns}-{created_ns}-{changed}-{identity}-{fingerprint}

created_ns  = creation/birth time（可用时，否则 0）
changed     = Unix: ctime.ctime_nsec
              Windows: FILE_BASIC_INFO.ChangeTime（GetFileInformationByHandleEx）
identity    = Windows: volume:file_index（与 FileService 共用读取函数）
              Unix: dev:ino
fingerprint = SHA-256(
                "head" | prefix_len | 前 min(4 KiB, len) 字节
                | "tail" | suffix_offset | 后 min(4 KiB, len) 字节
              )
```

- 文件不超过 4 KiB 时，采样覆盖整个文件。
- 大文件只读取首/尾各 4 KiB；不读取整个文件，不按 chunk 重算全文件哈希。
- `read_media_chunk` 仍在以下位置返回 `conflict`：
  1. `media_metadata` 的版本与调用方 `expected` 不同；
  2. 打开文件后版本不同；
  3. 读取 chunk 后版本不同；
  4. 路径在读取期间变化。
- 版本字符串对前端仍是不透明值；前端只保存和回传，不解析。旧版本字符串不会持久化；
  升级后旧视图不存在，若旧字符串被回传也只会得到 `conflict` 并触发重新加载。

### 2.3 实现位置

- `src-tauri/src/files/media.rs`
  - `version`
  - `changed_time`
  - `content_fingerprint`
  - `read_sample`
  - `read_at`（Unix `pread`；Windows `seek_read` + 游标恢复）
- `src-tauri/src/files/mod.rs`
  - 提取 `file_identity_from_handle`，让 `FileService::file_identity` 与媒体身份共用
    Windows volume+file index 读取逻辑。

### 2.4 Windows `seek_read` 的坑

Windows 的 `FileExt::seek_read` 在本机实测会推进共享文件游标（与部分文档描述不同）。
如果直接在 `version` 中调用，后续 `inspect` 读取 header 会从 EOF 开始，导致 PDF/图片
被误判为 `media_type`。实现因此在采样前保存 `stream_position()`，采样后无条件
`seek` 回去；所有媒体测试重新通过。

## 3. Windows 与 Unix 兼容处理

| 项目 | Windows | Unix（Linux/macOS） |
|---|---|---|
| 原生对象身份 | `volume serial + 64-bit file index`，通过 `GetFileInformationByHandle` | `dev + ino` |
| 创建时间 | `Metadata::created()` | `Metadata::created()`（文件系统支持时；否则 0） |
| 变更时间 | `FILE_BASIC_INFO.ChangeTime` | `ctime + ctime_nsec` |
| 内容采样 | `seek_read` 首/尾 4 KiB，采样后恢复游标 | `pread` 首/尾 4 KiB，不改变游标 |
| 文件身份保存 | 未改变：用户文档仍用原位写入保留文件身份 | 仍使用原子 rename 保存 |
| 读取 | 仍返回 `conflict` | 仍返回 `conflict` |

`FileService::file_identity` 与媒体身份的关系：

- `FileService::file_identity` 仍只用于“同一文件的不同路径拼写”路由识别；Windows 使用
  volume+index，Unix 返回 `None`（保持原行为）。
- 媒体版本在 Windows 复用同一个 `file_identity_from_handle`；在 Unix 使用 dev+ino。
  两者不是互相矛盾的身份策略：一个服务路由，一个服务媒体变更检测；媒体额外叠加时间
  和内容证据。
- 没有新增或削弱任何 token/owner 校验；`checked_path`、`validate`、`media::inspect`、
  `media_metadata`、`read_media_chunk` 的授权顺序未变。

## 4. 新增与修改的测试

| 测试 | 覆盖 |
|---|---|
| `replacing_a_media_file_with_an_identical_size_and_mtime_is_detected` | 旧文件保持链接并保持旧句柄；新文件同长度、同 mtime；断言新旧身份不同且 chunk 读取 conflict |
| `delete_then_immediate_recreate_with_same_size_and_mtime_is_detected` | 删除后立即重建；最多 64 次，记录是否真实复用 inode；无论是否复用都必须 conflict |
| `chunk_boundaries_and_read_only_preview_remain_valid` | 2×256 KiB+1234 字节；逐 chunk 完整读取；只读属性；0 长度、>256 KiB、末尾边界 |
| `deleted_directory_symlink_modified_and_released_media_are_rejected` | 同长度同 mtime 改写、删除、替换为目录、Unix 替换为 symlink、释放 token |
| `truncation_during_a_view_is_reported_as_a_conflict` | 视图打开后截断文件，旧版本读取 conflict |
| 既有 `token_ranges_and_large_pdf` | 其他窗口、释放、超大/溢出 offset、正常 5 字节读取 |
| 既有 `MediaReadPermit` 测试 | 媒体读取名额在成功/错误/panic 后释放 |

未执行项：

- Windows 文件符号链接测试：创建文件 symlink 需要管理员或开发者模式；本次只在 Unix
  执行 symlink 替换测试，Windows 使用目录/junction 相关测试覆盖路径拒绝策略。
- macOS 实机：本次在 Windows + Linux 容器验证；macOS 走 Unix 分支，仍需实机回归。

## 5. 测试结果

### Windows

```powershell
$env:TEMP='E:\code\lightEdit\src-tauri\target\test-tmp'
$env:TMP=$env:TEMP
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

结果：**76 passed; 0 failed**。  
`delete_then...` 在 Windows 报告 `native identity reused=false`（64 次未复用 file index），
但版本仍因身份/时间/内容采样而正确冲突。

### Linux

在 Debian trixie / Rust 1.99.1 容器中，使用与 CI 等价的 WebKitGTK 依赖：

```text
running 73 tests
test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

修复后的 Linux 套件共 73 项：基线 69 项（此前 1 项失败）现全部通过，另新增 4 项
媒体测试全部通过。  
`delete_then...` 在 Linux 报告 `native identity reused=true`、`legacy_metadata_collision=true`，
但新版本仍返回 `conflict`。

## 6. 性能影响

- 每次版本计算最多读取 8 KiB（首 4 KiB + 尾 4 KiB）；不超过 4 KiB 的文件只读一次。
- `inspect` 调用 2 次 version；`read_media_chunk` 调用 `media_metadata`（inspect）后再
  调用 2 次 version。最坏情况每个 256 KiB chunk 额外采样 **≤32 KiB**，约为 chunk 的
  12.5%，且通常命中页缓存。
- 不读取整份文件，不分配与文件大小相关的内存；采样缓冲固定为 4 KiB 栈数组。
- SHA-256 只处理 ≤8 KiB，CPU 成本远低于 256 KiB 的 I/O/解码；没有引入逐 chunk 全文件
  哈希。
- 没有对打开/保存路径、token 校验或锁顺序做额外改动。
- 未在本机做吞吐基准；报告的是确定性上界。网络文件系统上的额外 8 KiB/版本调用可能
  比本地页缓存更明显。

## 7. 仍然存在的限制

1. **采样盲区**：替换文件的 inode、创建/变更时间、长度、mtime、首尾 4 KiB 全部相同，
   但中间内容不同，仍无法识别。要完全消除只能做全文件哈希，本阶段明确拒绝该退化。
2. **原位修改 + 元数据恢复**：同一 inode 的原位修改如果只改首尾采样之外的内容，并
   恢复 length/mtime（ctime/ChangeTime 通常无法由普通用户恢复，但 root/特权工具可以），
   可能不被检测。
3. **粗粒度时钟**：ctime/ChangeTime 在同一 tick 内可能相同；内容采样覆盖了常见替换，
   但不是所有文件系统都提供纳秒级时间。
4. **网络/虚拟文件系统**：可能合成或延迟时间戳；采样提供额外信号，但仍非绝对。
5. **TOCTOU**：版本在读取前后各检查一次；如果文件在两次检查之间变化并恢复原状，
   仍存在理论窗口。chunk 读取本身在打开句柄上进行，路径替换不会改变已打开句柄。
6. **版本格式**：旧版本字符串不持久化；如果从旧内存状态回传旧字符串，会得到
   `conflict` 并重新加载。没有兼容旧格式的解析器。
7. **Windows API 回退**：`GetFileInformationByHandleEx` 失败时 `changed` 为
   `change-unavailable`，仍依赖身份/创建时间/采样；不会仅因此拒绝预览。

## 8. 验证结果

### 8.1 Rust 命令

| 命令 | 结果 |
|---|---|
| `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check` | **失败（基线既有问题）**：806114e 与当前树均有 19 个文件不符合 rustfmt；本次未做全仓格式化，以避免扩大 diff |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Windows：76 passed；Linux：73 passed |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | **失败（基线既有问题）**：11 条 lib + 1 条 test 错误（`commands/app.rs`、`settings.rs`、`workspace.rs`、`session.rs`、`classfile.rs`、`media.rs` 的既有 `chunks_exact` 等）；本次新增代码未产生新的 clippy 错误 |

`cargo fmt`/`clippy -D warnings` 在基准提交上同样失败；本次没有为了让这两条命令变绿而
重排 19 个文件或修改无关代码。

### 8.2 Linux 容器

环境与 CI 对齐：

- `ubuntu-22.04` 的 CI 依赖等价安装：`libwebkit2gtk-4.1-dev`、
  `libayatana-appindicator3-dev`、`librsvg2-dev`、`patchelf`、`xdg-utils`、`pkg-config`。
- 实际容器基础：`rust:1.99-slim`（Debian trixie）；Rust 1.99.1。
- 基线：`E:\code\markumo-phase61-baseline` 的干净 806114e worktree。
- 修复：当前工作树。

最终 Linux 结果：

```text
# 基线 806114e，干净 worktree
files::media::tests::replacing_a_media_file_with_an_identical_size_and_mtime_is_detected ... FAILED
panicked at src/files/media.rs:417:70:
called `Result::unwrap_err()` on an `Ok` value: [37, 80, 68, 70, 45]

# 修复后的当前工作树
running 73 tests
test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

# 复用证据（--nocapture）
delete/recreate native identity reused=true legacy_metadata_collision=true
```

`cargo check --locked` 通过。Linux 编译警告仅剩既有 `conversion.rs` 的
Linux 未使用 import、`workspace/guard.rs` 的既有 `mut` 等 5 条；本次新增代码的
Linux-only 警告（未使用 `file`、Windows 专用 fault 常量）已清理。

### 8.3 前端

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm test:smoke` | 11/11 通过 |
| `pnpm test:regression` | 22/22 通过 |

### 8.4 GitHub Actions

未推送代码、未创建 PR，因此没有新的远程 run。已有 run 39260044881 的结果是：
Frontend Quality 成功，Rust Quality 在 `cargo test` 步骤失败。修复后的 Rust Quality
等价验证以本地 Linux 容器结果为准；远程确认需要推送后由 CI 重新执行。

## 9. 转换命令路径授权安全债与最小整改方案

### 9.1 当前边界

| 命令 | 当前输入 | 问题 |
|---|---|---|
| `save_binary_file(path, bytes)` | 前端任意路径 + 任意字节数组 | 没有 token/lease；渲染层被攻破时可写任意路径；`fs::copy` 失败被忽略，目标已存在时可能返回成功 |
| `pandoc_export_docx(markdown, output_path, resource_dir)` | 前端任意输出路径 | Pandoc 直接写目标；失败可能留下部分文件；`resource_dir` 任意 |
| `pandoc_import_docx(input_path, target_md_path, media_dir)` | 前端任意输入/输出/媒体目录 | 可读任意 docx、写任意 md/assets；`read_to_string` 无上限 |
| `print_to_pdf(html, output_path)` | 前端任意输出路径 | 直接写目标；失败可能留下部分 PDF；HTML 无上限 |

前端正常流程是先调用 `export_save_dialog`/`import_open_dialog`，再把返回路径传给这些
命令；但命令本身不验证路径是否真的来自对话框，因此这是“渲染层信任”而不是原生
capability 边界。

### 9.2 最小整改方案（本阶段不实施）

1. **原生转换 lease**
   - 新增 `ConversionStore`（`Mutex<HashMap<String, ConversionLease>>`）。
   - `export_save_dialog` / `import_open_dialog` 在原生对话框返回后创建 lease，返回
     `{ path, token }`；token 绑定 `Window::label()`、canonical path、操作类型
     （read/write）、创建时磁盘版本（用于冲突检测）和过期时间。
   - 窗口 `Destroyed` 清理该 owner 的全部 lease；支持显式 release。
   - `save_binary_file`、`pandoc_export_docx`、`print_to_pdf` 只接受 write lease；
     `pandoc_import_docx` 接受 read lease + write lease；媒体目录从 write lease 的
     目标推导（`<stem>.assets`），不再由前端任意指定。
2. **兼容已有 UI**
   - `ExportController` 把 `{path, token}` 与 `lastExport` 一起保存；`exportRepeat`
     使用已保存 token；token 过期时重新弹原生保存对话框（一次额外确认，不改变格式/
     选项流程）。
   - `ImportController` 原样保存 input/output token；PandocBridge 参数增加 token。
   - 用户可见流程、默认文件名、格式筛选、`saveLastExport` 记录保持不变。
3. **防止损坏已有目标**
   - 所有写入先在同目录创建临时文件，fsync，再用 `atomic` 的替换/`ReplaceFileW`
     路径提交；失败时保留原目标并清理临时文件。
   - Pandoc/WebView2 打印输出到临时文件，成功且非空/格式校验通过后才替换 lease 目标。
   - `save_binary_file` 不再使用“`copy` 失败后只看 `target.exists()`”的分支；`copy`
     的错误必须返回，或先把 `copy` 的临时文件写完再原子替换。
   - 禁止直接让 Pandoc 写最终目标，避免失败留下半成品。
4. **资源上限**
   - `save_binary_file` 字节数组、`print_to_pdf` HTML、Pandoc markdown/输出读取都加上
     明确上限；二进制数组可复用 Phase 06 的限长反序列化思路。
   - lease 数量/生命周期按窗口限制（例如 8 个、10 分钟过期）。
5. **测试**
   - 伪造/跨窗口/过期 lease 拒绝；
   - 只允许写入对话框选中的 canonical path；
   - 写入冲突、替换失败、copy 失败均保留旧目标并返回错误；
   - Pandoc 失败不覆盖旧目标；媒体目录越界拒绝；
   - 正常导出/导入/重复导出的 UI 回归。

在人工确认该 lease 契约之前，本次不修改 conversion API，只保留风险记录。

## 10. 变更文件

- `src-tauri/src/files/media.rs`：版本算法、采样、游标恢复、测试。
- `src-tauri/src/files/mod.rs`：`file_identity_from_handle` 提取与复用。
- `docs/phase-06.1-media-version-audit.md`：本文档。
- `docs/phase-06-rust-native-audit.md`：Phase 06.1 跟进说明。
- 三个既有未提交 TypeScript 修改未触碰。

本次没有修改版本号、没有发布 Release、没有推送代码；完成后停止，等待人工验收。
