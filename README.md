# Markumo

轻量的桌面文本与 Markdown 编辑器。支持直接打开单个文件，也可以用文件夹工作区管理多个文档。

提供 Windows、Linux、macOS（Apple Silicon / Intel）版本，支持签名验证的应用内更新。

## 功能

- **文本与代码编辑**：多语言语法高亮、行号、缩进、折叠、查找替换和正则表达式。
- **Markdown 编辑**：即时排版、源码和双栏模式，支持表格、任务列表、图片、KaTeX 公式与 Mermaid 图表。
- **多文档与分栏**：多标签、标签拖动、左右分栏，同一文档在多个窗格间同步编辑。
- **文件与工作区**：最近文件、目录树、快速打开、工作区搜索，以及文件管理。
- **文档转换**：导入 HTML、Word，导出 HTML、PDF、Word 和 PNG 长图。Word 转换需要另外安装 [Pandoc](https://pandoc.org/installing.html)。
- **个性设置**：浅色、深色与跟随系统主题，独立调整界面、编辑器与 Markdown 字体，并支持快捷键配置。
- **本地文件保护**：未保存提示、自动保存设置、编码与换行处理，以及外部修改冲突检查。

## 安装与使用

从仓库的 [Releases](https://github.com/pucj0/Markumo/releases/latest) 获取已发布版本，也可按下文自行构建。标题栏 GitHub 图标可打开项目，更新图标提供版本检查和一键更新；有未保存修改时请先保存。自动发布与签名配置见 [发布说明](docs/releasing.md)。

Windows 构建产物为 `Markumo_*_x64-setup.exe`。安装后可通过菜单打开文件或文件夹，也可使用系统“打开方式”选择 Markumo。

Windows 11 可在文件右键菜单的“显示更多选项”中选择“以 Markumo 打开”。此入口使用经典文件关联，不需要安装原生扩展或导入额外证书。

## 本地开发

### 环境

- Node.js 20 或以上、pnpm。
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

`pnpm build` 仅生成前端资源到 `dist/`。仓库不包含独立的前端测试脚本；`cargo test` 验证配置迁移与旧预设名称转换。

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
