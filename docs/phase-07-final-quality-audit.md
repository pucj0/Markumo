# Phase 07 最终质量验收：前置检查记录

记录时间：2026-10-19 23:21（Asia/Shanghai）。

**当前结论：C — Not Ready。正式 Phase 07 验收尚未启动。**

本文件记录启动条件和现有测试入口，不能作为功能、性能、安全或发布验收通过证明。

## 1. 启动条件

用户提供的 Phase 07 任务书明确要求：

> Phase 06.2 必须完成并通过人工审查后，才能开始正式 Phase 07 验收。

| 项目 | 本次核对结果 |
| --- | --- |
| 仓库 | https://github.com/pucj0/Markumo |
| 当前分支 | `main` |
| HEAD | `d42bbe3b9cb7e8230f4f75be009a75653df3424f` |
| Phase 06.2 最终人工通过 Commit | 尚未提供，当前无法确定 |
| 工作树 | 存在未提交修改和未跟踪文件，包含 Phase 06.2 实现与报告 |
| 正式性能基线 | 尚未建立；不能使用当前未验收工作树代替已验收 Commit |
| 本次生产代码修改 | 无 |
| 本次提交、推送、版本修改或发布 | 无 |

检查前的完整 Git 状态、测试脚本清单和 GitHub API 结果保存于本地忽略目录 `test-results/phase07/preflight.json`。该文件记录报告创建前的状态；本报告本身是新增未跟踪文件。

已有用户修改继续保留。未执行 reset、checkout 覆盖、stash 或清理工作树。

`docs/phase-06.2-conversion-security-audit.md` 第 12 节仍明确等待人工验收。该报告还记录了最终版本复检到操作系统提交之间的跨进程竞态边界，不能将应用内互斥称为严格的跨进程原子 CAS。必须先完成该阶段的审查处置，再确定 Phase 07 基线；本记录不替代人工接受该边界。

## 2. 远程质量门禁

本次通过 GitHub API 查询 `quality.yml` 最近三次运行：

| Commit | 运行 | 结果 |
| --- | --- | --- |
| `d42bbe3b9cb7e8230f4f75be009a75653df3424f` | [39268317932](https://github.com/pucj0/Markumo/actions/runs/39268317932) | completed / success |
| `806114e9ca8ca6155ce6e774921568080036fd3e` | [39260044881](https://github.com/pucj0/Markumo/actions/runs/39260044881) | completed / failure |
| `742bcc764d496feb6345978d6065dcd264cbed99` | [39238805854](https://github.com/pucj0/Markumo/actions/runs/39238805854) | completed / success |

最新成功运行只覆盖已提交的 HEAD，未覆盖本地 Phase 06.2 修改，不能据此宣布当前工作树 CI 通过。

当前工作树的 Quality Gate 定义包含两个独立 Ubuntu 22.04 job：Frontend Quality 执行依赖安装、typecheck、build、Chromium 安装和 Smoke；Rust Quality 执行 cargo check、安装带嵌入数据的官方 Pandoc、cargo test 和 Pandoc 专项。该工作流没有执行完整 Regression、严格 Clippy、rustfmt 检查或 Windows 原生 PDF 专项。这是入口清点，尚未作本阶段 CI 调整。

## 3. 自动化入口清点

以下数量来自实际 `package.json` 和 `scripts/run-regressions.mjs`，仅表示注册数量，不表示本阶段执行通过。

| 入口 | 已确认范围 | 本阶段结果 |
| --- | --- | --- |
| `pnpm typecheck` | Vue/应用与 Node 脚本 TypeScript 检查 | 未执行 |
| `pnpm build` | Vue 类型检查及 Vite 构建 | 未执行 |
| `pnpm test:smoke` | 12 个脚本 | 未执行；连续 3 次稳定性尚未验证 |
| `pnpm test:regression` | 23 个脚本 | 未执行 |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 原生编译检查 | 未执行 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 原生文件、工作区、会话、更新、转换等测试 | 未执行 |
| `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check` | Rust 格式检查 | 未执行 |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 严格 Rust lint | 未执行 |
| `scripts/test-native-pdf.ps1` | 实际 Windows WebView2 PDF 专项 | 未执行，不属于 Node Regression |

完整 Regression 注册了：markdown-empty、markdown-live-controller-full、settings-keybindings、updater、smooth-caret、workspace-p0、workspace-smart-expand、syntax、highlight-runtime、brackets、shell-lifecycle、document-manager、rich-clipboard、outline、outline-navigation、heading-outline、table-layout、native-drop、export-code、conversion、media、windows-artifacts、release 对应的 `*-regression.mjs`。

`markdown-live-controller-regression.mjs` 虽未以相同文件名注册在完整 Regression 中，但 `markdown-live-controller-full-regression.mjs` 实际追加 `--full` 后导入它，覆盖共同断言并增加生命周期用例；不能将文件名差异直接视为漏测。

ConversionLease 和原生提交逻辑位于 `src-tauri/src/conversion/tests.rs`；普通保存故障测试位于 `src-tauri/src/files/atomic.rs` 等原生模块，不能用前端 Mock 测试代替。真实 PDF 测试需显式启用对应 feature，通过专项脚本执行；常规 cargo test 不代表已执行该真实桌面用例。

媒体回归依赖 `.markumo-media-test/fixtures`，生成工具为实际存在的 `scripts/media-fixtures.py`。`media-size-report.mjs`、`generate-bookmark-pdf.mjs`、fixture 和 harness 文件不是完整产品验收通过证明。

## 4. 实现与入口预索引

下表来自实际代码、菜单和命令定义，只用于后续逐项矩阵的定位，不是已完成的逐功能验收矩阵。全部自动化与手工实际结果均为 **未验证 / Not Tested**。

| 领域 | 实现与用户入口 | 已有自动化入口 | 待正式验证的发布风险 |
| --- | --- | --- | --- |
| 文本编辑、保存、冲突 | `src/features/files/FileController.ts`、`AutoSaveController.ts`、`src/editor/core/DocumentManager.ts`；文件/编辑菜单、快捷键 | document-manager、brackets、syntax、highlight-runtime；原生 files 测试 | P0：保存、失败与并发保护；编辑各语言逐项验收待做 |
| Markdown 与源码保真 | `src/editor/markdown/wysiwyg/`、Markdown 模式菜单与格式菜单 | markdown-live-controller-full、markdown-empty、rich-clipboard、table-layout、各 outline 脚本 | P0：局部修改源码保真、模式/多窗格/撤销与输入法待验收 |
| 工作区与文件树 | `src/features/workspace/WorkspaceController.ts`、`src-tauri/src/workspace/`；工作区菜单及树操作 | workspace-p0、workspace-smart-expand、native-drop；原生 workspace/session 测试 | P0：文件操作及恢复；路径变化和桌面交互待验收 |
| 图片与 PDF | `src/components/viewers/`、`src/features/files/media.ts`；文件打开与媒体预览 | media、document-manager；原生媒体测试 | P0：分块读取、版本与资源释放；实机循环待验收 |
| 导入导出 | `src/features/document-conversion/`、`src-tauri/src/conversion/`；文件菜单的导入、导出、重复导出 | conversion、export-code、原生 conversion、原生 PDF 专项 | P0：先完成 Phase 06.2 人工审查，再复核授权与原子提交 |
| 设置、命令、快捷键 | `src/features/shell/mainMenu.ts`、`menuModel.ts`、`keybindings/definitions.ts`、`src/components/modals/SettingsModal.vue` | settings-keybindings、shell-lifecycle | P0/P1：IME、多窗口、迁移与菜单一致性待验收 |
| 启动、会话、关闭、更新 | `src/app/desktopStartup.ts`、`WindowCloseGuard.ts`、`src-tauri/src/session.rs` 与 update 模块 | shell-lifecycle、updater、release；原生 session/update 测试 | P0：数据恢复、迟到结果、关闭与更新保护待验收 |

语言范围应以 `src/editor/languages/index.ts` 的 `languageRegistry` 为准；该注册表区分 full/partial/plain，后续不能将部分语法支持写成全功能支持。未从 README 推断验收通过。

## 5. 前置阻塞与未完成项

| 分类 | 状态与后续要求 |
| --- | --- |
| P0 启动条件 | 缺少 Phase 06.2 人工审查通过证据及最终 Commit；正式验收不能开始 |
| Phase 06.2 安全边界 | 严格跨进程覆盖保护、Pandoc 构建要求与多目标恢复方案需完成原阶段人工审查；不在此处擅自视为接受 |
| 历史静态检查 | Phase 06.2 报告记录严格 Clippy、rustfmt 未通过及基准对比。本阶段未复跑，不能写成成功，也不能据此认定本阶段新增缺陷 |
| 性能与内存 | 无已验收 Commit 基线；启动各场景至少 5 次、固定编辑数据集、50 次资源循环、30 分钟持续编辑均未执行 |
| 平台 | Windows/Linux/macOS 的本阶段完整桌面、安装、签名及升级验收均为 Not Tested；原阶段局部测试不等于本阶段平台通过 |
| 构建与体积 | 本阶段尚未生成可归属于基线的发布构建，没有可靠体积差异或优化收益数据 |
| 功能矩阵与评分 | 尚未完成逐项操作矩阵、七维评分与总分；记为未评估，不能给未测项满分或编造分数 |

本次仅增加前置记录，未发现并确认新的 P1/P2 产品缺陷；不将未测试自动等同为某个具体产品漏洞。

## 6. 恢复正式验收所需信息

需要提供 **已经人工审查通过的 Phase 06.2 最终 Commit SHA**，并确认该提交对应原阶段审查结论。已向用户请求该信息，尚未获得答复。未擅自创建提交或将当前工作树标记为已验收基线。

收到后先核对提交及工作树归属，保留现有用户修改，再按同机、同构建、同数据集建立基线并执行任务书规定的完整矩阵。此前 Phase 06.2 的测试结果仅保留在原报告中，本次没有重新标记为 Phase 07 测试结果。
