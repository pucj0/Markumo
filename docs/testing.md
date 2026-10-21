# Markumo 测试体系与自动化回归规范

本文档为 Markumo 的自动化测试体系、回归套件及持续集成（CI）门禁提供规范说明与操作指引。

磁盘检查/保存状态机专项已纳入 smoke 和完整回归；覆盖范围、复现证据及人工验收边界见 [磁盘检查与保存竞争修复验收记录](external-save-checking-fix.md)。

---

## 一、环境依赖

运行测试前请确保具备以下运行环境：

| 工具 / 依赖 | 推荐版本 | 说明 |
|---|---|---|
| **Node.js** | `>= 20` (建议 22 或 24) | 前端构建与测试运行器环境 |
| **pnpm** | `12.11.2` | 项目包管理器（依赖锁文件严格锁定） |
| **Playwright Chromium** | `^1.64.1` (devDependencies) | 自动化端到端及浏览器回归测试引擎 |
| **外部浏览器**（可选） | Google Chrome / Microsoft Edge | 本地未安装 Playwright Chromium 时可通过 `MARKUMO_CHROME` 环境变量指定，或由运行器自动探测 |
| **Rust & Cargo** | `stable` (edition 2021) | 桌面端 Tauri 后端编译与单元测试 |
| **Linux 系统库** (仅 Linux) | `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` 等 | Tauri 编译依赖 |
| **Python** (可选) | `>= 3.10`（附带 `Pillow`, `reportlab`, `pypdf`） | 仅在需要重新生成媒体与 PDF 测试数据时使用 |

> **注**：Playwright 仅声明在 `devDependencies`，不会打入最终发布的桌面安装包，普通用户运行 Markumo 无需安装 Playwright。

---

## 二、测试命令汇总

Markumo 在 `package.json` 中提供了统一、易记的测试脚本：

```bash
# 1. TypeScript 类型检查
pnpm typecheck

# 2. 前端静态资源构建
pnpm build

# 3. 运行 Smoke 关键回归测试 (快速、核心、无重度环境依赖)
pnpm test:smoke
# 或者简写：
pnpm test

# 4. 运行完整回归测试套件 (包含全部专项回归)
pnpm test:regression

# 5. 全流程质量检查 (依次执行: 类型检查 -> 前端构建 -> Smoke 回归)
pnpm check
```

---

## 三、测试运行器 (`scripts/run-regressions.mjs`)

为了避免多个端到端脚本因并行启动 Vite 导致本地端口冲突（如端口 1421 ~ 1439），项目提供了轻量级原生 Node.js 测试运行器。

### 运行器特性：
1. **纯原生实现**：基于 Node.js `child_process` 实现，跨 Windows、macOS 与 Linux 平台。
2. **串行调度**：默认串行运行各个回归脚本，杜绝端口冲突。
3. **环境自适应**：
   - 优先检查 Playwright 安装的 Chromium。
   - 若未下载 Playwright 浏览器，自动探测系统安装的 Google Chrome 或 Microsoft Edge。
   - 亦可直接通过 `MARKUMO_CHROME` 显式指定浏览器可执行文件路径。
4. **状态与耗时**：为每个用例输出编号、名称、状态（`PASS` / `FAIL` / `SKIP`）与精确执行耗时。
5. **超时控制与进程清理**：为每个用例设置独立超时保护（默认 180s）。超时后终止整个进程树（Windows 使用 `taskkill /T /F`，POSIX 使用进程组 `SIGKILL`），并附加 10s 看门狗，即使终止命令本身失败也不会让运行器永久等待。
6. **严格退出码**：当且仅当全部用例通过时返回 0；任意用例失败返回退出码 1。失败绝不会被降级为 `SKIP`（仅当子进程以 0 退出且显式输出独立成行的 `SKIP:` 时才记为跳过）。
7. **失败上下文**：失败用例会打印退出码/超时原因、断言错误堆栈的 stdout 与 stderr 尾部（各最多 30 行），并将完整日志保存到 `test-results/regression-logs/<用例名>.log`。
8. **输出有界**：每条流仅保留 8 KiB 头部与 64 KiB 滚动尾部，超出部分以 `... [N characters omitted by the regression runner] ...` 标记，异常放大输出不会造成内存增长。

### 高级用法：
```bash
# 指定运行单个或多个回归脚本
node scripts/run-regressions.mjs scripts/brackets-regression.mjs

# 自定义单项测试超时时间 (毫秒)
node scripts/run-regressions.mjs smoke --timeout=60000
```

---

## 四、功能覆盖矩阵

Markumo 的专项回归按功能域分组如下；实际执行清单以 `scripts/run-regressions.mjs` 为准：

| 功能域 | 对应回归脚本 | 是否纳入 Smoke | 测试重点说明 |
|---|---|:---:|---|
| **Markdown 编辑** | `scripts/markdown-empty-regression.mjs` | **是** | 空白文档输入、撤销/重做、Live/Source 模式切换与空白字符处理 |
| **Markdown Live 控制器** | `scripts/markdown-live-controller-regression.mjs`；Full 使用 `scripts/markdown-live-controller-full-regression.mjs` | **是（核心场景）** | 源码保真、单一撤销栈、双向多窗格同步、表格工具栏及所有者清理；Full 额外验证代码块语言、图片/链接属性、HTML、行内源码与懒加载竞态 |
| **快捷键与设置** | `scripts/settings-keybindings-regression.mjs` | **是** | 命令注册、快捷键录制、持久化、重置、冲突消除与多平台修饰键 |
| **更新管理器** | `scripts/updater-regression.mjs` | **是** | 更新检测、下载状态、防抖、保存中脏状态保护、离线重试与资源释放 |
| **平滑光标动画** | `scripts/smooth-caret-regression.mjs` | **是** | CodeMirror 与 ProseMirror 光标插值、中文输入法回退、多选区与分栏聚焦 |
| **工作区 P0** | `scripts/workspace-p0-regression.mjs` | **是** | 快速点击异步竞争、Tab 预览与固定（Pin）、文件重命名与定位 |
| **语法高亮** | `scripts/syntax-regression.mjs` | **是** | 48 种语言注册表、高亮主题调色板、YAML/JSON/SQL 解析与大文件视口高亮 |
| **高亮运行环境** | `scripts/highlight-runtime-regression.mjs` | **是** | 实际界面的语言切换、语法字色，以及并行 Vite 服务的缓存隔离 |
| **括号功能** | `scripts/brackets-regression.mjs` | **是** | 彩虹括号、括号匹配、嵌套边界、字符串与注释忽略、大文档解析预算 |
| **Shell 生命周期与守卫** | `scripts/shell-lifecycle-regression.mjs` | **是** | 窗口关闭状态守卫、更新准备阻断、文档图片路径规整化与卸载无泄漏 |
| **文档管理器核心契约** | `scripts/document-manager-regression.mjs` | **是** | 唯一状态源、保存与脏标记、多窗格同步、撤销历史隔离、异步语言竞态与媒体状态解耦 |
| **工作区智能展开** | `scripts/workspace-smart-expand-regression.mjs` | 否（纳入完整回归） | 单子目录链式自动展开、紧凑文件夹合并展示与懒加载容错 |
| **富文本剪贴板** | `scripts/rich-clipboard-regression.mjs` | 否（纳入完整回归） | Markdown 与 HTML 剪贴板复制/粘贴、富文本右键菜单、快捷格式切换 |
| **文档大纲 (基础)** | `scripts/outline-regression.mjs` | 否（纳入完整回归） | 侧边栏与右侧大纲同步、中文标题解析、折叠与展开 |
| **大纲精准导航** | `scripts/outline-navigation-regression.mjs` | 否（纳入完整回归） | 大纲点击平滑滚动、源码行定位、分栏同步滚动与宽度拖拽记忆 |
| **标题视觉对齐** | `scripts/heading-outline-regression.mjs` | 否（纳入完整回归） | H2 等多级标题指示器对齐、缩进修正与折叠更新 |
| **表格悬浮交互** | `scripts/table-layout-regression.mjs` | 否（纳入完整回归） | 表格聚焦时工具栏悬浮显示、失焦隐藏与文档排版零抖动 |
| **文件拖拽导入** | `scripts/native-drop-regression.mjs` | 否（纳入完整回归） | 原生目录/文件拖拽打开、多根工作区合并与非法路径拦截 |
| **代码导出排版** | `scripts/export-code-regression.mjs` | 否（纳入完整回归） | 四位数行号槽对齐、长行折行排版与 PDF 导出排版基准 |
| **媒体查看器** | `scripts/media-regression.mjs` | 否（纳入完整回归） | 图片查看器缩放/旋转、PDF 分页渲染、大纲导航与内存回收 |
| **Windows 安装包完整性** | `scripts/windows-artifacts-regression.mjs` | 否（纳入完整回归） | Windows 强制完整性级别校验（仅限 win32 执行，其余平台自动 SKIP） |
| **发布清单与校验** | `scripts/release-regression.mjs` | 否（纳入完整回归） | Release 资源签名完整性、更新清单结构与 GitHub 跳转验证 |

---

## 五、测试数据生成（媒体查看器）

`scripts/media-regression.mjs` 依赖 `.markumo-media-test/fixtures/` 目录下的合成文件（如测试图片与 PDF 样例）。

### 生成步骤：
1. 安装 Python 依赖：
   ```bash
   pip install Pillow reportlab pypdf
   ```
2. 执行测试数据生成脚本：
   ```bash
   python scripts/media-fixtures.py .markumo-media-test/fixtures
   ```
3. 脚本将自动生成 `transparent.png`、`single.pdf`、`mixed.pdf` 等受控的测试数据。
4. 测试产物目录 `.markumo-media-test/` 已配置在 `.gitignore` 中，**禁止**将生成的二进制测试资产提交入 Git 仓库。

---

## 六、Rust 后端检查与单元测试

Markumo 的桌面底层基于 Tauri Rust 实现，包含本地文件 IO、更新验证、剪贴板桥接等核心逻辑。

```bash
# 检查后端代码类型与依赖锁定
cargo check --locked --manifest-path src-tauri/Cargo.toml

# 运行 Rust 单元测试 (共 23 个测试用例)
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

> **Windows 权限提示**：若在特殊沙箱或只读临时目录环境中运行，Rust 的 `tempfile` 库可能因访问系统 Temp 失败而报错。运行前可通过设置临时目录环境变量解决：
> ```powershell
> $env:TEMP = "$PWD\.markumo-media-test"
> $env:TMP = "$PWD\.markumo-media-test"
> cargo test --locked --manifest-path src-tauri/Cargo.toml
> ```

---

## 七、GitHub Actions 质量门禁 (`.github/workflows/quality.yml`)

项目已配置专门的独立持续集成门禁工作流，与正式发布流程严格隔离。

### 触发策略：
- **Pull Request**：对 `main` 分支发起的所有 PR 自动触发。
- **Push**：向 `main` 分支提交推送自动触发。
- **手动触发**：支持在 GitHub 仓库 Actions 界面通过 `workflow_dispatch` 手动执行。

### 门禁 Job（两个相互独立的 Job，互不跳过）

工作流拆分为 `Frontend Quality` 与 `Rust Quality` 两个并行、独立的 Job。二者没有 `needs` 依赖：任一方失败都不会导致另一方被跳过，整体工作流仅在**两个 Job 都成功**时才通过。

#### Job 1：`Frontend Quality`
1. 检出源码（`actions/checkout`）。
2. 安装 Node.js 24 与 pnpm 12.11.2（启用 pnpm store 缓存）。
3. 执行 `pnpm install --frozen-lockfile`（锁定版本一致性）。
4. 执行 `pnpm typecheck`（TypeScript 零错误）。
5. 执行 `pnpm build`（Vite 生产构建校验）。
6. 执行 `pnpm exec playwright install --with-deps chromium`（准备无头浏览器与系统库）。
7. 执行 `pnpm test:smoke`（当前清单中的核心 Smoke 回归）。
8. **失败时上传产物**：`test-results/**`（含 `regression-logs/` 日志与截图）以及 `.markumo-media-test/**/*.png`，保留 7 天。

#### Job 2：`Rust Quality`
1. 检出源码。
2. 安装 Rust stable 与 `Swatinem/rust-cache` 编译缓存。
3. 安装 Linux Tauri 系统依赖（GTK/WebKit 等）。
4. 执行 `cargo check --locked`。
5. 执行 `cargo test --locked`（23 项 Rust 单元测试）。

> 两个 Job 均不涉及更新签名私钥、不创建 Release、不打包或上传正式安装包、不修改版本号。发布流程仍由 `.github/workflows/release.yml` 独立负责。

### 失败定位入口：
- **浏览器截图**：`test-results/<用例目录>/failure.png` 等。
- **回归日志**：`test-results/regression-logs/<用例名>.log`，包含退出码、耗时以及完整的（有界）stdout / stderr。
- CI 失败时上述文件随 artifact 上传，可在对应 Job 的 Artifacts 区域下载。

---

## 八、新增功能回归测试规范

### 外部文件变化与冲突

`scripts/external-file-regression.mjs` 已加入 Smoke/完整回归，使用可控事件、延迟 IPC、真实编辑器/提示条/Diff，验证保存保护、确认失效、恢复与多 Pane。
Rust 的 `files::external_tests` 和 `files::external::tests` 使用独立临时文件验证读取/授权/原生目录监听及释放。

Windows 原生专项为 `scripts/external-file-native-regression.mjs`，要求先构建独立 `com.markumo.external-audit` identifier、`test-results/external-native/profile` 数据目录、devUrl `http://localhost:1493` 的调试程序到 `.markumo-dev/target/debug/markumo.exe`，并将覆盖配置保存为 `test-results/external-native/config.json`。脚本验证隔离标识后，只重建该专用 profile 和临时夹具；通过 WebView2 CDP 验收真实 Rust 监听与 GUI，并输出结果/截图。不能用生产标识或生产数据目录代替。

完整设计、测量口径和限制见 [外部文件变化验收报告](external-file-changes.md)。

### Markdown Live 基线和性能测量

```bash
# 核心断言 / 加入较重的 NodeView 和生命周期场景
node scripts/markdown-live-controller-regression.mjs
node scripts/markdown-live-controller-regression.mjs --full

# 在修改前、修改后使用相同环境分别执行；不使用真实文件或系统剪贴板
node scripts/markdown-live-controller-regression.mjs --profile --label=before
node scripts/markdown-live-controller-regression.mjs --profile --label=after
```

结果保存在 `test-results/phase-05/`。性能模式对六种固定输入各预热一次，再测量七次，记录初始化中位数、同步编辑中位数/P95、循环耗时、DOM、显式事件监听器和 PM/CM View 数量，以及销毁结果。初始化包含 fixture 重挂载和浏览器命令往返；同步编辑测量实际 PM dispatch 到规范 Markdown 与其他 Live 窗格同步完成的耗时，不等同于键入到屏幕呈现延迟。绝对值依赖机器，应在同机同浏览器比较，且不得为通过测量放宽 1 Mi 字符等既有安全预算。

监听器计数追踪真实 `addEventListener` / `removeEventListener`，使用 WeakMap 避免测量工具自身保留已卸载 DOM；属性事件处理器及浏览器内部监听器不计入，也不跟踪 once/AbortSignal 的自动失效，因此是显式注册/注销计数。模块级共享监听器可能在视图销毁后保留，须结合实际 PM/CM View 销毁、浮层移除和相同预热基线比较，而不是宣称全页面监听器必须归零。源码行数按 LF 归一化且不计末尾空行；“decisionPoints”是 TypeScript AST 上条件、循环、catch、case 及逻辑运算的计数，不是完整圈复杂度分析。

后续在重构或新增功能（如拆分 `AppShell`、`DocumentManager`、`MarkdownEditorController` 等组件）时，须遵循以下回归准则：

1. **命名规范**：回归脚本放置在 `scripts/` 目录下，以 `<feature>-regression.mjs` 命名。
2. **端口隔离**：每个脚本应使用独立的未占用本地端口（或通过运行器串行执行）。
3. **环境兼容**：使用统一的 Playwright 导入逻辑：
   ```javascript
   import { pathToFileURL } from 'node:url'
   const { chromium } = await import(
     process.env.MARKUMO_PLAYWRIGHT_MODULE
       ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href
       : 'playwright'
   )
   ```
4. **清理钩子**：所有测试脚本必须在 `finally` 块中关闭浏览器实例和 Vite 服务器，释放系统资源。
5. **等待已提交的 UI 状态，而不是固定延迟**：凡是依赖 `requestAnimationFrame`、`ResizeObserver`、`MutationObserver` 或异步测量的状态（例如设置页 `aria-current`、平滑光标 `.smooth-caret-layer` 的 `hidden`），必须用 `page.waitForFunction` 等待明确状态，禁止用 `waitForTimeout` 猜时间。示例：
   ```javascript
   await page.waitForFunction(target =>
     document.querySelector('.settings-nav button[aria-current]')?.getAttribute('aria-controls') === 'settings-' + target, id)
   ```
   Linux CI 的帧调度比本地更慢，固定延迟会在慢机器上瞬间失去意义。
6. **断言强度只增不减**：等待状态之后仍需保留 `assert`，以便失败时给出明确的断言错误；不得为通过测试而删除断言、放宽预期或写入期望值。
7. **纳入运行清单**：在 `scripts/run-regressions.mjs` 的测试清单中登记新增的测试脚本。
