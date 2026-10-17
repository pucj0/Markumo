# Markumo

轻量的桌面文本与 Markdown 编辑器。支持直接打开单个文件，也可以用文件夹工作区管理多个文档。

提供 Windows、Linux、macOS（Apple Silicon / Intel）版本，支持签名验证的应用内更新。

当前版本：[1.0.3](https://github.com/pucj0/Markumo/releases/tag/v1.0.3) · 开源协议：[AGPL-3.0-only](LICENSE)。

## 功能

- **媒体预览**：内置图片和 PDF 查看器，共用标签与分栏；PDF 默认连续滚动、适应页面。
- **版本更新**：后台检查、可选自动下载、下载进度与版本日志；签名验证通过后，由用户决定安装和重启，安装前可保存全部文档。
- **文本与代码编辑**：多语言语法高亮、行号、缩进、折叠、查找替换和正则表达式。
- **Markdown 编辑**：即时排版、源码和双栏模式，支持表格、任务列表、图片、KaTeX 公式与 Mermaid 图表。
- **平滑光标**：关闭、快速跟手、平滑滑动三种模式，覆盖普通文本、源码、即时排版及内嵌代码块；遵循系统减少动画偏好，组合输入期间回退原生光标。
- **多文档与分栏**：多标签、标签拖动、上下及左右分栏，同一文档在多个窗格间同步编辑，并恢复分栏布局和各窗格的 Markdown 模式。
- **文件与工作区**：最近文件、目录树、快速打开、工作区搜索与文件管理；支持拖入文件或文件夹，添加文件夹时保留现有工作区。
- **文档转换**：导入 HTML、Word，导出 HTML、PDF、Word 和 PNG 长图。Word 转换需要另外安装 [Pandoc](https://pandoc.org/installing.html)。
- **设置中心**：滚动分类自动联动、常用选项平铺，独立调整界面、编辑器与 Markdown 字体。
- **快捷键**：Markumo、Fleet、Typora 三种方案，支持录制、清除、恢复、搜索筛选与冲突重新分配；自定义绑定按编辑焦点生效并持久保存。
- **本地文件保护**：未保存提示、自动保存设置、编码与换行处理，以及外部修改冲突检查。

## 安装与使用

从仓库的 [Releases](https://github.com/pucj0/Markumo/releases/latest) 获取安装包，更新内容见 [1.0.3 更新日志](docs/releases/v1.0.3.md)，也可按下文自行构建。

标题栏 GitHub 图标可打开项目，更新图标提供检查、下载、完整日志和安装入口。设置 → 更新中，自动检查默认开启，自动后台下载默认关闭；后台下载期间可以继续编辑，关闭更新面板也不会中断下载。安装和重启始终由用户确认。安装前请关闭其他 Markumo 窗口；当前窗口可选择保存全部未保存文档，任何保存取消或失败都会停止安装。自动发布与签名配置见 [发布说明](docs/releasing.md)。

Windows 构建产物为 `Markumo_*_x64-setup.exe`。安装后可通过菜单打开文件或文件夹，也可使用系统“打开方式”选择 Markumo。

Windows 11 可在文件右键菜单的“显示更多选项”中选择“以 Markumo 打开”。此入口使用经典文件关联，不需要安装原生扩展或导入额外证书。

Linux 的应用内更新适用于 AppImage；DEB 用户请下载安装新版 DEB。macOS 的 DMG 用于安装，`.app.tar.gz` 用于应用内更新。下载校验值见 Release 的 `SHA256SUMS`；更新签名包含在 `latest.json` 中，不单独提供 `.sig` 附件。

Windows 安装包目前没有商业代码签名证书；macOS 使用 ad-hoc 签名且未公证，首次启动可能需要系统确认。应用内更新使用独立的签名验证。

## 本地开发

### 环境

- Node.js 20 或以上、pnpm；发布流程使用 Node.js 24 和 pnpm 12.11.2。
- 桌面开发还需要 Rust 工具链与系统依赖。
- Windows 需要 MSVC、Visual Studio C++ 桌面开发工具、Windows SDK 和 WebView2 Runtime。
- macOS 需要 Xcode Command Line Tools；Linux 需要 WebKitGTK 等开发依赖。

各平台的详细环境要求见 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)。

### 获取源码

```sh
git clone https://github.com/pucj0/Markumo.git
cd Markumo
pnpm install --frozen-lockfile
```

### 启动桌面版

```sh
pnpm tauri dev
```

开发模式默认支持热更新。需要关闭自动重启时，运行 `pnpm tauri dev --no-watch`。开发数据保存在项目的 `.markumo-dev/` 中，不影响正式版配置。

### 浏览器预览

```sh
pnpm dev
```

访问 `http://localhost:1420`。浏览器模式适合界面开发和内存草稿编辑，桌面文件操作需要 Tauri。启动桌面开发前，请先停止已有的 Vite 服务，避免端口冲突。

### 检查与构建

```sh
pnpm typecheck
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

`pnpm build` 仅生成前端资源到 `dist/`。`cargo test` 覆盖设置持久化、配置迁移、文件能力、会话恢复和更新安装保护。

仓库还提供针对真实编辑器与应用界面的浏览器回归：

```sh
node scripts/settings-keybindings-regression.mjs
node scripts/smooth-caret-regression.mjs
node scripts/updater-regression.mjs
node scripts/rich-clipboard-regression.mjs
node scripts/native-drop-regression.mjs
node scripts/release-regression.mjs
```

浏览器回归需要可用的 Playwright 和 Chromium。可用 `MARKUMO_PLAYWRIGHT_MODULE` 指定 Playwright 模块的绝对路径，用 `MARKUMO_CHROME` 指定本机 Chrome 可执行文件。测试产物写入忽略跟踪的 `test-results/`；更新回归使用模拟安装器，不安装或重启应用。实现与验收说明见 [设置和快捷键](docs/settings-keybindings.md)、[平滑光标](docs/smooth-caret.md) 和 [更新系统](docs/updater.md)。

## 生成安装包

Windows：

```powershell
.\build.bat
```

macOS / Linux：

```sh
sh build.sh
```

脚本默认安装锁定依赖并构建当前系统的安装包。可使用 `--check` 检查环境，或使用 `--skip-install` 跳过依赖安装。

Windows 打包脚本会将生成的程序和安装包恢复为正常的 Medium 完整性标记，避免构建目录继承的 Low 标记影响启动。

| 平台 | 默认产物目录 | 格式 |
| --- | --- | --- |
| Windows | `src-tauri/target/release/bundle/nsis/` | EXE 安装包 |
| macOS | `src-tauri/target/release/bundle/macos/`、`dmg/` | APP、DMG |
| Linux | `src-tauri/target/release/bundle/deb/`、`appimage/` | DEB、AppImage |

各平台需在对应系统上构建。使用自定义 Cargo target 或输出目录时，以构建日志中的实际路径为准。

## 技术结构

- **界面**：Vue 3、TypeScript、Vite。
- **桌面服务**：Rust、Tauri 2，处理文件读写、工作区和系统集成。
- **编辑内核**：普通文本、代码及 Markdown 源码使用 CodeMirror 6；Markdown 即时排版使用 ProseMirror，代码块嵌入 CodeMirror 6。
- **渲染**：Markdown-it、KaTeX、Mermaid。

```text
src/                 界面、编辑器与应用功能
src-tauri/           Rust 桌面服务、图标和 Windows 集成
scripts/             开发与打包脚本
public/              静态资源
design/              图标设计源文件
```

应用标识统一为 `com.markumo.app`，开发配置目录为 `.markumo-dev/`，浏览器偏好使用 `markumo.settings.v1`，Windows 文件关联及右键菜单注册项统一使用 `Markumo`。

首次启动会从旧版标准目录导入编辑器设置、最近文件、工作区及上次会话；已有的新配置不会被覆盖，旧目录保留为备份。自定义开发目录仅通过 `MARKUMO_DEV_DATA_DIR` 指定。更新后的注册项在重新构建并安装后生效；Windows 的默认应用选择由系统管理，必要时在“打开方式”或“默认应用”中重新选择 Markumo。

## 开源协议

Markumo 自 1.0.3 起采用 **GNU Affero General Public License v3.0（AGPL-3.0-only）**。许可证全文见 [LICENSE](LICENSE)，各第三方依赖保留其各自的许可证和版权声明。
