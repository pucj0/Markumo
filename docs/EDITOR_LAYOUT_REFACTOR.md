# 编辑器布局专项 Phase A 暂停记录（2026-10-15）

用户随后明确将任务切换为“启动模式与会话恢复，只修改启动，不进入多分栏或 Markdown 开发”。因此 Split Tree、四方向拖拽、完整标签菜单和 Phase B–D 均未开始，不标记完成。

Phase A 已改的基础修复保留：空 Pane 不再创建默认空 EditorState/EditorView；host 与已绑定文档的 view 生命周期分开；真正的 EmptyEditorPane 有显式新建/快速打开，拖放继续沿用已有授权流程。组合态只检查有文档的真实视图，compositioncancel 经 CM 公共 compositionend 事件通路结束，不修改 CM 私有字段。关闭通过 WindowCloseGuard 合并异步请求，并记录来源/数量/状态、不记录正文。切分关闭重开同一 Vue 批次的生命周期问题已修复。

修复前真实浏览器复现：无文档仍有可编辑 CM，合成 compositionstart 后 isComposing=true、新建被拒；这不是系统 IME 验收。修复后本专项6组浏览器、7个关闭保护单元测试与既有双 Pane 8组通过；当时typecheck/build与182个单元通过。原生专项先完成三文件/双Pane清空和三种关闭入口 dirty 保护2组，随后测试脚本在“放弃标签后立即 openRecent”的异步文件忙时序上等待超时，后两组没有完成。任务切换后不再继续该专项回归。

本轮启动专项另外通过了10组原生检查，其中含空状态、外部窗口隔离、关闭取消与 dirty 保留。它们不替代本专项所有验收：真实系统中文 IME、compositioncancel 主机行为、四方向多 Pane 模型和长时泄漏仍未验收。详情与当前结果见 STARTUP_SESSION_UPDATE.md。

保留修改：DocumentManager.ts、EditorPane.vue、EditorContainer.vue、EmptyEditorPane.vue、WindowCloseGuard.ts、useAppShell.ts、TopBar.vue、App.vue、tests/window-close.test.ts、tests/layout-phase-a-{ui,native}.mjs。本专项 REVIEW/暂停，后续需用户明确继续。
