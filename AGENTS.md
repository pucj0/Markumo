# LightEdit — AI Coding Agent Project Rules

本文件在整个项目的所有 Phase 中生效。开始任何编码任务前，先阅读本文件、`docs/PRD.md` 与 `docs/PHASE_PROGRESS.md`。`docs/prototype.html` 是交互和视觉参考，不是生产代码，也不等于已经完成的功能。

## 1. 产品与技术栈（不得自行替换）

- 产品：面向 Windows 首发，面向 macOS/Linux 保留跨平台设计的轻量通用文本编辑器；参考 JetBrains Fleet 的紧凑 UI 与工作流，Markdown 具备 Typora/Obsidian 风格 Live Preview。不是 Markdown 专用应用，也不是 IDE。
- 固定技术栈：**Rust + Tauri 2 + Vue 3 + TypeScript + Vite + CodeMirror 6**。
- Markdown: `@codemirror/lang-markdown` / Lezer + CodeMirror 6 Decorations / StateField / ViewPlugin / WidgetType。`markdown-it` 仅用于只读预览面板。
- 文件编辑操作在 CodeMirror 的 EditorState / Transaction 中完成，禁止每次输入都跨 Tauri IPC 或将全文放入全局响应式 `v-model`；Rust 负责文件 I/O、工作区目录与搜索、监控、桌面集成。
- 禁止无请求增加 Electron、Monaco、ProseMirror、TipTap、Ace、LSP、AI 助手、Git 面板、终端、云端账号和大型 UI 框架。

## 2. 模式与不可妥协的功能边界

- 单文件模式：无需项目；文件打开后直接编辑、保存，侧边栏可默认隐藏。
- 工作区模式：打开文件夹、目录树按需加载、快速打开、全文搜索、文件管理；与单文件模式共用文档模型。
- 对任意可识别文本文件统一使用 CodeMirror 6；代码、配置、日志文件默认纯文本/语法高亮，不应用 Markdown 排版。
- 仅 `.md/.markdown` 默认 Live Preview；同时可选 Source、Split。Live 是**同一个 CodeMirror 编辑区**内进行即时排版，而不是旁边渲染的 HTML；光标进入时能够恢复可编辑的语法标记。
- Markdown 原始源码是唯一真实数据；切换模式或渲染不得改写源码。复杂 Markdown（如表格、数学、Mermaid）可安全降级，但不得假装完全支持。
- 重要风险：中文 IME、撤销/重做、选择光标、换行/BOM/编码、脏文件关闭确认、外部修改冲突、保存失败、读写权限、超大文件、符号链接路径。

## 3. 必须遵循的工作方式

1. **先读再做**：阅读上述文档、检查仓库真实结构、`git status`、当前依赖和阶段状态；严禁凭空假定文件/API 存在。
2. **先计划再改动**：说明本次仅覆盖哪个 Phase、修改边界、实现思路、验证计划；有重大歧义时依据 PRD 保守实现并明确记录取舍。
3. **一次只实施一个 Phase**：严格按 `docs/PRD.md` 的 Phase 1–8 顺序。未经用户明确授权不得自动推进下一阶段。
4. **真实实现**：除 Phase 1 的 UI 框架允许有限无后端示例外，必须接入真实 CodeMirror/Tauri 服务；未实现按钮需禁用/明确标识，不能用假数据宣称功能完成。
5. **测试和验收**：运行阶段适用的 TypeScript typecheck、lint、unit tests、`pnpm build`、`cargo check`、Rust tests、应用启动/手工交互验证；不能运行时记录原因，不得宣称“通过”。
6. **控制改动范围**：保持代码可维护、避免无关重构和新增依赖；新依赖先说明必要性与体积/安全影响。
7. **保留用户数据**：不能丢失未保存修改；不静默覆盖外部文件；严谨处理编码、换行、原子保存与写入冲突。不要静默上传用户文件。
8. **Git 安全**：改动前后检查 `git diff`；不执行破坏性 `reset --hard`/`clean -fd`；未经指示不要提交、推送、创建 Release；不要覆盖用户已有未提交改动。
9. **持续记录**：更新 `docs/PHASE_PROGRESS.md`，写下当前 Phase、已实现项目、验证证据、已知问题与下一阶段依赖。验收前不可标记为 DONE。
10. **停止规则**：本次 Phase 实施和验证完后停止，等待用户评审或批准下一阶段。

## 4. 每次完成必须输出的报告

- 当前 Phase、实施摘要及主要架构取舍
- 改动的文件路径及每个文件用途
- 测试命令与真实结果（PASS / FAIL / NOT RUN）
- 人工验收步骤和未满足的 PRD 验收条款
- 已知 bug、风险、后续修复建议
- 是否达到本 Phase 的完成门槛；**不要自行开始下一 Phase**

## 5. 文件权威顺序

1. 用户当前明确的新指示
2. 本文件 `AGENTS.md` 中的项目执行规则
3. `docs/PRD.md`（范围、架构、分阶段验收）
4. `docs/prototype.html`（交互/视觉参考，不是行为实现或真实数据来源）

冲突需在实施报告中标明，不默默忽略要求。
