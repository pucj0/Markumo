# LightEdit

面向 Windows 首发的轻量通用文本编辑器，使用 Rust + Tauri 2 + Vue 3 + TypeScript + Vite + CodeMirror 6。

**阶段状态以 [进度台账](docs/PHASE_PROGRESS.md) 为准，完整桌面人工验收尚未完成。** 已接入真实 Rust/Tauri 文件服务与工作区：打开、保存、另存为、最近文件、按需目录树、文件管理、快速打开和全文搜索。单文件与工作区共用 CodeMirror 文档状态。2026-10-14 Phase 4 复审及修复结果见 [验收报告](docs/PHASE4_REVIEW.md)；其他并行阶段的实现不等同于本轮已验收。

## 先在浏览器启动

在浏览器编辑草稿时，不需要 Rust 或 Visual Studio；磁盘打开/保存按钮禁用，内容只在内存中。显式样例演示入口为 `http://localhost:1420/?demo=1`。

1. 安装 [Node.js LTS](https://nodejs.org/) 和 [pnpm](https://pnpm.io/installation)。已经安装时，可用 `node --version`、`pnpm --version` 检查。
2. 打开 PowerShell，进入项目目录并安装依赖：

```powershell
Set-Location E:\code\lightEdit
pnpm install --frozen-lockfile
pnpm dev
```

浏览器访问 **http://localhost:1420**。终端需保持运行，按 Ctrl+C 停止；保存前端源码后页面会自动更新。

依赖安装完成后，也可用 `npm run dev` 启动。安装依赖仍沿用项目的 pnpm 锁文件。

从远程仓库新下载项目时：

```powershell
git clone https://github.com/pucj0/lightEdit.git
Set-Location lightEdit
pnpm install --frozen-lockfile
pnpm dev
```

不要在已经有项目的目录中重复 clone；已有 `E:\code\lightEdit` 时使用第一组命令即可。

## 在 Windows 启动桌面窗口

Tauri 开发需要 Rust MSVC 工具链、Microsoft C++ Build Tools、Windows SDK 和 WebView2。按 [Tauri 官方 Windows 环境说明](https://v2.tauri.app/start/prerequisites/#windows) 准备：

1. 安装 Microsoft C++ Build Tools，在安装器中选择“使用 C++ 的桌面开发”（Desktop development with C++），保留 MSVC 和 Windows SDK 组件。
2. 通过 [Rust 官方安装器](https://www.rust-lang.org/tools/install) 安装 rustup，使用 Windows MSVC 工具链。也可在 PowerShell 中执行 `winget install --id Rustlang.Rustup`。
3. 需要 WebView2 Runtime。本轮环境已检测到 WebView2；其他机器请按官方说明检查或安装。
4. 安装后重新打开终端，检查工具链：

```powershell
rustup default stable-msvc
rustc --version
cargo --version
```

随后在项目根目录运行：

```powershell
Set-Location E:\code\lightEdit
pnpm install --frozen-lockfile
pnpm tauri info
pnpm tauri dev
```

`pnpm tauri dev` 会自动启动 Vite 并编译 Rust；第一次需要下载 Rust 依赖，耗时取决于网络和机器。**运行桌面命令前先停止此前的 `pnpm dev`**，避免 1420 端口占用。Tauri CLI 已在项目开发依赖中，无需另外安装 `cargo-tauri`。

开发启动器使用项目内 `.lightedit-dev/` 存放 WebView2、临时文件和开发偏好，避免受限终端无法写入系统 AppData/Temp 时启动失败。它已被 Git 忽略；不放入 Git，不当作源码清理。正式版仍使用平台默认应用数据目录。`pnpm tauri info` 等其他命令不重定向数据目录。

`pnpm tauri dev` 默认开启热更新：前端源码由 Vite HMR 更新，`src-tauri` 下的文件变化会触发 Rust 重新编译并重启窗口。因此，用编辑器保存位于 `src-tauri` 中的测试文件也可能触发重启。`pnpm tauri:watch` 保留为相同模式的别名；浏览器 `pnpm dev` 也支持 HMR。需要稳定的文件功能测试时，可选 `pnpm tauri dev --no-watch`，同时关闭 Rust 自动重启和前端 HMR。

本机需要代理才能连接 crates.io。若遇到 TLS 握手失败，可设置实际代理端口；以下为本机 CMD 示例（只影响当前窗口）：

```cmd
set "CARGO_HTTP_PROXY=http://127.0.0.1:7897"
pnpm tauri dev
```

PowerShell 对应写法是 `$env:CARGO_HTTP_PROXY = "http://127.0.0.1:7897"`。Rust 安装后若旧终端找不到 cargo，应重开终端，或临时将 `%USERPROFILE%\.cargo\bin` 加入 PATH。

## 验证与生产预览

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm preview --host 127.0.0.1 --port 1421 --strictPort
```

生产预览地址为 http://127.0.0.1:1421。`pnpm build` 生成的是前端资源，正式安装包属于后续 Phase 8，目前打包配置关闭。

工具链就绪后还应运行：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

受限终端若不能写入系统 Temp，可为本次 Rust fixture 指定项目内临时目录（PowerShell）：

```powershell
New-Item -ItemType Directory -Force test-results/native-temp | Out-Null
$env:TEMP = (Resolve-Path test-results/native-temp).Path
$env:TMP = $env:TEMP
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`pnpm test` 运行 Vitest 单元测试。`pnpm test:ui` 运行既有编辑器回归（显式 demo 模式），`pnpm test:ui:files` 运行文件 UI 与显式 IPC 服务替身的契约测试；两者均需要 Node >=20、Playwright 与浏览器。命令和验收范围见 [Phase 3 实施报告](docs/PHASE3_IMPLEMENTATION.md)。当前没有独立 lint runner；TypeScript strict 检查不等价于 lint。

`pnpm test:native:save` 是 Windows/WebView2 的真实保存回归：需要 Playwright，运行前关闭已有 LightEdit 窗口和 1420 服务。它会以显式 `--no-watch` 启动隔离的桌面实例和 CDP 调试端口 9225，操作专用临时文件，检查保存前后进程/页面不变、另一份 dirty 草稿保留以及实际 BOM/CRLF 字节。结果写入 `test-results/native-save-stability/`，不会更改开发偏好或用户文件。

`pnpm test:native:workspace` 验证 Phase 4，使用独立工作区/历史和真实 Tauri IPC，创建 10,000 个临时文件，检查快速打开、搜索、重命名/移动后保存、删除确认及窄窗口。需 Windows、Node >=20、Playwright；运行前保存并关闭已有 LightEdit 和 1420 服务。测试数据/日志保留在 `test-results/phase4-native/`，不接触用户工作区。Playwright 不在项目依赖中，可通过 `LIGHTEDIT_PLAYWRIGHT_PACKAGE` 指定现有 Playwright 的 package.json 绝对路径。

## 桌面文件操作（待实机验收）

- `Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存、`Ctrl+Shift+S` 另存为；顶部也提供打开和保存按钮。
- `Ctrl+Shift+P` 可选择按编码打开/重开、另存为 UTF-8。默认严格识别 UTF-8 或 UTF-8/UTF-16 BOM；不猜测旧编码，不用替换字符读取。
- 只读或磁盘冲突时保留编辑内容，可另存为。关闭 dirty 标签或窗口支持继续编辑、放弃、保存并关闭。
- 最近文件及独立布局存储到应用数据目录 `com.lightedit.app/files.json`；开发模式为 `.lightedit-dev/files.json`，不持久化正文。单文件打开不创建工作区。
- 本阶段保守限制：原始文件及解码文本各不超过 16 MiB、最多 200,001 行；批量最多 20 个文件、文本总量不超过 64 MiB。拒绝二进制/NUL、文件符号链接和硬链接，避免不明确的覆盖语义。

## Phase 5 / 6 功能与复跑

Markdown 默认在同一 CodeMirror 编辑区即时排版，工具栏可切换 Source / Split。复杂表格、图片、数学与 Mermaid 保留源文；只读预览不会自动下载远程图片。

`Ctrl+\` 开关左右窗格；可将标签拖到另一组，`Ctrl+Alt+Right` 切换活动窗格。同一文件共享内容与撤销历史，每侧保留选区/滚动；关闭分栏会把副窗格独有标签合并回来。`Ctrl+G` 跳转行:列，`Ctrl+F/H` 查找/替换，`F3/Shift+F3` 下一/上一。命令面板可转换选区大小写、复制路径和 Reveal。

设置现在自动保存到本机 `editor-settings.json`，开发默认在 `.lightedit-dev/`。包含主题、字号、等宽字体、换行、缩进、大纲、Markdown 默认模式/最近 100 个文件的视图模式、快捷键；不存正文。快捷键配置中 Mod 表示 Ctrl / Command，支持字母/单字符键、F1–F12 与 ArrowRight，重复和编辑器保留按键会被拒绝。字体未安装时使用等宽 fallback。预览和大纲在超过 1,048,576 个 CM 字符（UTF-16 计数）时暂停，大纲最多 1000 项。

设置按外观、编辑、保存、Markdown、快捷键分类；字号可直接输入10–24整数。文件自动保存默认开启，在停止输入1.5秒后保存已有保存位置的可写文件，可在“保存”分类关闭或更改延迟。未命名草稿仍需先选择保存位置；外部版本冲突/写入失败保留编辑内容并暂停自动重试，可手动另存为处理。浏览器没有磁盘自动保存能力。实现与验证见 [设置与自动保存记录](docs/SETTINGS_AUTOSAVE_UPDATE.md)。

新增回归命令：

```powershell
# 另一个终端先运行浏览器测试服务
pnpm dev --host 127.0.0.1 --port 1422
# 再在测试终端运行；默认使用现有 Playwright 与 Edge
pnpm test:ui:editor
pnpm test:ui:phase6
# 真实桌面 / Rust / 文件字节 / 设置重启：先保存并关闭已有 LightEdit 和 1420 服务
pnpm test:native:editor
```

Playwright 不在项目依赖中，需要已有可用安装；可通过 `LIGHTEDIT_PLAYWRIGHT_PACKAGE` 指向其 package.json。DOM 脚本使用独立 fixture，原生脚本使用隔离 profile、`--no-watch` 和 CDP 9227，结果保留在 `test-results/`。普通 `pnpm tauri dev` 继续保持热更新。

本轮实际结果与人工缺项见 [Phase 5 复审](docs/PHASE5_REVIEW.md) 和 [Phase 6 复审](docs/PHASE6_REVIEW.md)。两阶段保持 REVIEW；没有开始 Phase 7。

## 常见启动问题

若保存桌面文件提示 `os error 5`，文件/目录 ACL 正常却仍失败，请检查本地生成的 `src-tauri/target/debug/lightedit.exe` 是否被标记为 `Low Mandatory Level`：Low 程序不能写普通用户数据，单纯管理员运行也不能解除 exe 的 Low 标签。本机生成目录现已修复为普通 Medium。若彻底重建 target 后复发，普通 PowerShell 可对本项目生成目录执行 `icacls 'E:\code\lightEdit\src-tauri\target' /setintegritylevel '(OI)(CI)M' /T /Q`，再重启程序；不需要更改桌面目录权限。完整证据、测试与保存保护见 [保存权限专项修复](docs/PHASE3_SAVE_PERMISSION_FIX.md)。旧窗口有未保存内容时先另存到可写位置，再关闭重启。

| 提示 | 处理 |
|---|---|
| 找不到 pnpm | 安装 pnpm 并重新打开终端；安装方法见上方 pnpm 官方文档 |
| PowerShell 禁止运行 pnpm.ps1 | 可改用 `pnpm.cmd dev` 或 `pnpm.cmd tauri dev` |
| 找不到 cargo / cargo metadata | 安装 Rust MSVC 工具链并重新打开终端，先确认 `cargo --version` 可运行 |
| 找不到 link.exe、MSVC 或 Windows SDK | 在 Visual Studio Installer 中补齐 C++ 桌面开发组件，重新打开终端 |
| 1420 端口被占用 | 停止之前运行的项目开发服务；不要随意更改端口，Tauri devUrl 已与 1420 配套 |
| 浏览器 Ctrl+S 提示需要桌面版 | 浏览器只编辑内存草稿；磁盘操作需启动 Tauri，关闭或刷新前请保留需要的文本 |

产品需求见 [PRD](docs/PRD.md)，阶段状态见 [PHASE_PROGRESS](docs/PHASE_PROGRESS.md)，审查结果与遗留风险见 [PHASE1_REVIEW](docs/PHASE1_REVIEW.md)。`docs/prototype.html` 仅为交互/视觉参考。
