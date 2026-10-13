# LightEdit

面向 Windows 首发的轻量通用文本编辑器，使用 Rust + Tauri 2 + Vue 3 + TypeScript + Vite，后续阶段接入 CodeMirror 6。

**当前为 Phase 1 UI 骨架，状态 REVIEW。** 已实现主题、单文件/工作区布局、示例标签、侧栏调整、命令面板及设置弹窗；文档是内存中的只读示例，尚不能编辑、打开或保存真实文件。Markdown 视图、语言切换等未实现入口已禁用或标明占位。浏览器验证通过，真实 Tauri 桌面验收仍受工具链缺失阻塞。

## 先在浏览器启动

只查看当前界面时，不需要 Rust 或 Visual Studio。

1. 安装 [Node.js LTS](https://nodejs.org/) 和 [pnpm](https://pnpm.io/installation)。已经安装时，可用 `node --version`、`pnpm --version` 检查。
2. 打开 PowerShell，进入项目目录并安装依赖：

```powershell
Set-Location E:\code\lightEdit
pnpm install --frozen-lockfile
pnpm dev
```

浏览器访问 **http://localhost:1420**。终端需保持运行，按 Ctrl+C 停止；保存前端源码后页面会自动更新。

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

本轮未能启动桌面：宿主未检测到 Cargo/Rust 和 MSVC/Windows SDK。上述步骤是工具链准备与启动说明，不代表桌面运行已经验收通过。

## 验证与生产预览

```powershell
pnpm typecheck
pnpm build
pnpm preview --host 127.0.0.1 --port 1421 --strictPort
```

生产预览地址为 http://127.0.0.1:1421。`pnpm build` 生成的是前端资源，正式安装包属于后续 Phase 8，目前打包配置关闭。

工具链就绪后还应运行：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

UI 回归脚本为 `tests/phase1-ui.mjs`，需要 Node >=20、可用的 Playwright 包及浏览器，具体执行方式见 [Phase 1 复审报告](docs/PHASE1_REVIEW.md)。当前项目没有独立 lint/unit test runner，不能将不存在的测试宣称通过。

## 常见启动问题

| 提示 | 处理 |
|---|---|
| 找不到 pnpm | 安装 pnpm 并重新打开终端；安装方法见上方 pnpm 官方文档 |
| PowerShell 禁止运行 pnpm.ps1 | 可改用 `pnpm.cmd dev` 或 `pnpm.cmd tauri dev` |
| 找不到 cargo / cargo metadata | 安装 Rust MSVC 工具链并重新打开终端，先确认 `cargo --version` 可运行 |
| 找不到 link.exe、MSVC 或 Windows SDK | 在 Visual Studio Installer 中补齐 C++ 桌面开发组件，重新打开终端 |
| 1420 端口被占用 | 停止之前运行的项目开发服务；不要随意更改端口，Tauri devUrl 已与 1420 配套 |
| 页面中的文字不能编辑 | 当前只有 Phase 1，只读示例是明确的阶段边界；真实编辑内核尚未接入 |

产品需求见 [PRD](docs/PRD.md)，阶段状态见 [PHASE_PROGRESS](docs/PHASE_PROGRESS.md)，审查结果与遗留风险见 [PHASE1_REVIEW](docs/PHASE1_REVIEW.md)。`docs/prototype.html` 仅为交互/视觉参考。
