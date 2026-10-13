# LightEdit 阶段进度与验收台账

## 状态说明
- NOT_STARTED：尚未实施
- IN_PROGRESS：正在开发或修复
- REVIEW：代码已提交审查但未验收
- DONE：验收标准均满足且已获确认
- BLOCKED：依赖或环境阻塞（必须说明）

| Phase | 目标 | 状态 | 验收证据 / 备注 |
|---|---|---|---|
| 1 | Tauri 2 + Vue 3 项目骨架和 Fleet 风格 UI | REVIEW | 2026-10-13 复审：typecheck/build、开发与生产浏览器 8 组回归 PASS；Rust/Cargo/MSVC 缺失，桌面验收未完成。见 PHASE1_REVIEW.md |
| 2 | CodeMirror 6 通用文本内核、多语言、多标签 | NOT_STARTED | |
| 3 | Rust 文件读写、保存、单文件和最近使用 | NOT_STARTED | |
| 4 | 工作区目录树、快速打开与全文搜索 | NOT_STARTED | |
| 5 | Markdown 同区 Live Preview / Source / Split | NOT_STARTED | |
| 6 | 分栏、查找替换、快捷键与效率功能 | NOT_STARTED | |
| 7 | 恢复、文件监控、安全与性能 | NOT_STARTED | |
| 8 | 桌面打包、平台验收及正式发布准备 | NOT_STARTED | |

---

### Phase 1 — 日期：2026-03-30
> 以下为原实施记录，并非本次复审的完整验证证据；最新结论以 2026-10-13 复审和 `PHASE1_REVIEW.md` 为准。原记录中的 Markdown 模式切换已改为禁用占位，窗口彩色示意点已移除，状态栏不再宣称磁盘已同步。
- **状态**：REVIEW
- **实现范围**：
  1. 完成 Tauri 2 (`src-tauri`) 官方规范工程配置：`Cargo.toml`、`tauri.conf.json`、`capabilities/default.json`、`build.rs`、`src/main.rs`、`src/lib.rs`、`commands/app.rs`；
  2. 完成 Vue 3 + TypeScript + Vite 纯净前端骨架：`package.json`、`vite.config.ts`、`tsconfig.json`、`tsconfig.node.json`、`index.html`；
  3. 按照 `docs/prototype.html` 高保真实现 Fleet 风格 Design Tokens（深色 Midnight / 浅色 Paper）、CSS Reset 与全局样式；
  4. 实现完整 Fleet UI 壳组件：
     - `TopBar`：窗口红黄绿小点、Logo、标题、快速检索入口、单文件/工作区切换、专注模式、主题切换、设置入口；
     - `ActivityBar`：极简侧边工具条（文件树、搜索、大纲、设置）；
     - `Sidebar`：侧边栏 Explorer 容器，支持 190–420px 流畅鼠标拖拽调宽与折叠；
     - `TabBar`：紧凑标签栏，支持区分 Pinned 与 Temporary Preview 标签、未保存圆点、关闭与新建；
     - `Breadcrumb`：层级路径面包屑、语言模式芯片、软换行、大纲开关；Markdown 文件条件渲染 Live/Source/Split 切换按钮，非 Markdown 文件严格隐藏；
     - `EditorContainer`：代码与文本容器（默认打开普通代码文件 `main.rs`，非 Markdown，遵守 Phase 1 验收标准；明确标识 CM6 内核将在 Phase 2 挂载，不以 textarea 伪造内核）；支持空状态 Hero 引导页；
     - `StatusBar`：24px 极简状态栏，显示工作区模式、未保存状态、行列号、Spaces 缩进、编码、换行符、语言模式、字符计数；
     - `CommandPalette`：`Ctrl+P`（文件检索）与 `Ctrl+Shift+P`（命令操作）快速打开面板，支持键盘上下键选择、Enter 执行与 Esc 关闭；
     - `SettingsModal`：首选项弹窗（主题选择、字号滑块、自动换行、大纲开关、Markdown 默认模式）；
     - `Toast`：轻量操作反馈提示。
- **主要变更文件**：
  - `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.npmrc`
  - `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/app.rs`
  - `src/main.ts`, `src/App.vue`, `src/types/index.ts`
  - `src/styles/variables.css`, `src/styles/reset.css`, `src/styles/main.css`
  - `src/components/common/Icon.vue`, `src/components/common/Toast.vue`
  - `src/components/layout/TopBar.vue`, `src/components/layout/ActivityBar.vue`, `src/components/layout/Sidebar.vue`, `src/components/layout/TabBar.vue`, `src/components/layout/Breadcrumb.vue`, `src/components/layout/EditorContainer.vue`, `src/components/layout/StatusBar.vue`
  - `src/components/modals/CommandPalette.vue`, `src/components/modals/SettingsModal.vue`
- **自动化验证**：
  - `pnpm run build` (`vue-tsc --noEmit && vite build`)：**PASS**（耗时 892ms，47 modules transformed，0 类型错误）
  - 前端静态预览服务 (`vite preview`)：**PASS**（HTTP 200，无控制台报错）
  - `cargo check`：**NOT RUN**（当前宿主执行环境未安装 Rust/Cargo 工具链，将在环境配置完毕后执行）
- **人工验收步骤**：
  1. 运行 `pnpm run dev` 并在浏览器打开查看 Fleet 风格 UI；
  2. 点击右上角单文件/工作区切换按钮，检查侧边栏与活动栏显隐切换；
  3. 拖拽侧边栏右侧边缘，检查宽度是否在 190–420px 之间平滑调整；
  4. 点击右上角或设置中的深色/浅色切换，检查色彩变量与对比度是否平滑过渡；
  5. 按下 `Ctrl+P` 或 `Ctrl+Shift+P`，检查命令面板弹出、键盘上下选择与 Enter 动作；
  6. 点击 TabBar 中的不同文件标签（`main.rs`, `EditorView.ts`, `settings.json`, `README.md`），检查面板联动；注意非 Markdown 文件不出现 Markdown 工具条，只有切换到 `README.md` 时才出现。
- **未解决问题/风险**：
  1. 宿主环境缺失 Rust 工具链（`cargo` / `rustc`），后续构建桌面可执行文件前需宿主安装 Rust；
  2. Phase 1 编辑器仅为布局容器，CodeMirror 6 内核将在 Phase 2 正式接入。
- **下一阶段前置条件**：
  Phase 1 获得用户评审批准，进入 Phase 2（引入 CodeMirror 6 统一内核、多语言高亮与多标签状态管理）。

### Phase 1 复审 — 日期：2026-10-13
- **状态**：REVIEW，未达到完整桌面验收门槛，未标记 DONE。
- **审查依据**：AGENTS.md、PRD 第 0–5 节与 Phase 1 标准、prototype.html；检查全部 `src`/`src-tauri` 代码、依赖、构建配置及 UI。
- **修复**：示例树折叠与无效节点、弹窗 Esc/焦点循环/快捷键隔离、命令过滤后选择索引、拖拽卸载与失焦清理、Toast 定时器、新建标签回收、窄窗口布局、误导性的同步提示、未实现功能禁用、favicon 404、原生窗口示意按钮重复、Tauri CLI/图标/CSP、配置文件类型检查。
- **真实验证**：`pnpm typecheck` PASS；`pnpm build` PASS（48 modules；资源体积为前端构建结果，不代表安装包）；已有 Playwright + Edge 的开发/生产浏览器回归均 8/8 PASS，console/page errors 0；保存 10 张明暗/不同宽度截图并检查布局；`pnpm tauri info` 执行成功但报告工具链缺失；`pnpm tauri dev` 启动失败，找不到 Cargo；cargo check/test 未能执行；lint/独立 unit runner 未配置。
- **Git 限制**：根目录无 `.git`，`git status`/`git diff` 均不能执行。修复前临时快照未能跨沙箱进程保留，未将其作为差异证据；不得将当前源码审查描述为历史 Git diff 审查。未初始化 Git、未提交、未推送。
- **遗留**：Rust/MSVC 编译、真实 Tauri 启动、CSP/IPC 在 WebView2 内的运行、原生窗口/真实 DPI/输入法及 macOS/Linux 尚未验收；源码中示例文本仅用于只读 UI，文件读写与编辑内核尚未实施。
- **详情**：`docs/PHASE1_REVIEW.md`（逐项结论、修改文件用途、复现命令和风险）。保持 Phase 2–8 为 NOT_STARTED；下一阶段必须另行授权。

### 仓库发布准备 — 日期：2026-10-13
- 用户明确授权将当前 Phase 1 代码提交并推送到 `https://github.com/pucj0/lightEdit`；此前禁止自行提交/推送的限制在本次授权范围内解除，不包含推进下一阶段或发布 Release。
- 新增 `README.md`：提供浏览器启动、Windows Tauri 环境配置、验证命令与常见问题；强调当前仅为只读 UI 骨架。
- 推送前重新执行 `pnpm typecheck` 与 `pnpm build`：PASS（48 modules）；无应用代码变更，不重复执行已通过的 UI 回归。
- 先前无 Git 仓库的说明为复审时的历史事实；本次按授权建立仓库基线，不回写历史审查结论。
- Phase 1 保持 REVIEW，Rust/MSVC 与真实桌面验收尚未完成，Phase 2–8 仍为 NOT_STARTED。
