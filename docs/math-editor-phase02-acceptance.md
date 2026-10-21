# Phase 02：Markdown 数学公式编辑器稳定性验收

日期：2026-10-21。基于 `main`，包含基准修复 `b4f646d45a64`。

## 生命周期与唯一数据源

`DocumentManager` 的 CodeMirror 文档保存 Markdown 真值。`MarkdownSourceBridge` 维护对应的不可变 ProseMirror 节点和源码区间；NodeView 的 textarea 只承担当前输入和 IME 草稿，不能独立覆盖文档。

1. 点击公式预览时，核对只读状态、节点位置和当前节点，关闭行内源码编辑器，撤销旧的焦点恢复权，显示 textarea 并聚焦一次。
2. 普通输入通过 `setNodeMarkup` 和既有 bridge/publish 路径进入文档；`selfDispatch` 期间不赋值 textarea。内容相同时不再次提交。
3. 外部更新按公式文本的最小差异映射 `selectionStart`、`selectionEnd`，保留 `selectionDirection`。不调用 focus，也不重复发布远程修改。
4. IME 期间保留浏览器原生输入 DOM。结束时先接收待同步的最新文档，再提交完成的组合输入。失焦与结束事件无论先后，都在完成提交后退出。
5. Escape、行内 Enter、块级 Ctrl/Cmd+Enter 退出到 ProseMirror；点击其他编辑区域则由目标接管焦点。
6. 销毁时清空输入属性处理器、移除 composition 监听器和只读刷新回调，使排队任务失效。若输入目标在 compositionend 前被删除，释放控制器的组合输入标志。

## 已复现的根因与修复

| 根因 | 修复与证据 |
| --- | --- |
| `closeInline()` 依据排队前的焦点状态，无条件在微任务中 `view.focus()` | 使用 `focusEpoch` 和当前 activeElement 检查焦点所有权。新增真实点击测试在修复前超时；粗体、斜体、链接、代码到公式的切换在修复后通过。 |
| 外部修改只对原选区截断长度 | 用文本补丁映射端点并保留反向方向；测试其他 Pane 插入、区间内替换、整段缩短和单次发布。 |
| 原生 compositionend 的监听器之间可以出现微任务检查点，子输入提交时父级标志尚未清理 | 父容器在捕获阶段清理结束标志；本地 composing/ending 标志保护输入和退出快捷键。Chromium CDP 原生组合输入复现了 DOM 已有“中文”、Markdown 仍未更新的情况，修复后仅发布一次。 |
| IME 尚未提交时，远程源码已前进，本地仍基于旧 bridge | 先同步最新文档，合并不相交差异；重叠时本次完成的本地公式输入优先并明确通知。其他文档区域仍取最新源码。 |
| 目标被直接销毁时未必有 compositionend | 清理组合输入状态并在当前事务结束后处理待同步内容；对应测试在修复前 `isComposing` 永远为 true，修复后通过。 |
| 块级公式固定写回 `$$\n…\n$$`，改变原来的分隔符布局 | 分离 opening/value/closing，只替换 value，不 trim 公式内容。单行公式、首尾空格、内部空行、关闭分隔符后的空白均保留。 |
| CommonMark 段落范围把含空行的 `$$...$$` 拆成多个节点 | 增加有闭合分隔符的 math block 识别，继续使用既有 protected_source 节点与源码桥接。 |
| 行内公式闭合只检查前一个反斜杠 | 按连续反斜杠的奇偶判断美元符是否转义，验证转义美元符和双反斜杠结尾公式的模式往返。 |
| textarea 的原生 history beforeinput 可绕过文档历史 | 将 historyUndo/historyRedo 接入既有共享撤销栈；只读刷新同时更新原生 readOnly 属性。 |

## 修改范围

- `src/editor/markdown/wysiwyg/MarkdownEditorController.ts`：焦点、IME、同步、只读与销毁生命周期。
- `src/editor/markdown/wysiwyg/MathSource.ts`：分隔符拆分、选区映射、组合输入差异合并。
- `src/editor/markdown/wysiwyg/MarkdownParser.ts`：含空行的公式块与美元符转义判定。
- `scripts/math-editor-regression.mjs`：由 10 项扩展为 30 项，记录浏览器版本和结构化结果，使用系统分配端口。
- 本验收记录。

已审查但无需修改：MarkdownSourceBridge、MarkdownSchema、MarkdownTheme、SmoothCaret、caretOverlay、DocumentManager、EditorPaneItem。Pane 保持按自定义 MIME 类型接管拖放；未新增全局阻止选择或拖放的处理器。

## 自动化执行

环境：Windows x64，Node v22.2.0，系统 Chrome 155.0.8059.85，无头 Chromium 自动化。

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm build` | 通过，退出码 0；有既有动态导入、浏览器 externalization 和 chunk 大小警告 |
| `node scripts/math-editor-regression.mjs` | 30 通过，0 失败 |
| `pnpm test:smoke` | 24 个脚本通过，0 失败，0 跳过 |
| `pnpm test:regression` | 重跑 35 个脚本通过，0 失败，0 跳过，244.39 秒；首轮 31 通过、4 个端口占用启动失败 |

公式专项覆盖真实 activeElement、textarea 原生选区、反向鼠标拖选、双击、三击、Shift 选择、公式与其他编辑区域切换、多 Pane、组合输入、剪切复制、多行粘贴、撤销重做、只读、节点删除、模式往返和保存快照。

原生拖放测试实际使用 mouse/keyboard 操作 textarea、CodeMirror、TabBar 和 TreeNodeItem。另保留合成 MIME 事件作为分发契约测试，不把该测试单独视作原生拖放验证。IME 同时使用 Chromium CDP 原生组合输入和合成事件顺序测试，二者不代表操作系统输入法候选框实测。

保存测试实际将 `saveSnapshot().text` 写入测试目录、关闭文档并读取重开；这验证文档与快照链路，不代表 Tauri 原生保存对话框和 Rust 文件服务已完成端到端交互。

原始证据在未纳入 Git 的 `test-results/math-editor/results.json`、`build.log`、`full-regression.log` 和 `test-results/regression-logs/`。

## 尚未验证与剩余风险

- Windows WebView2：所有真实桌面交互均未验证，不能用 Chrome 结果替代。
- Windows 中文输入法、macOS 输入法：候选框、选词键、系统确认/取消顺序未验证。已验证的是 Chromium 原生组合输入事件与指定事件顺序。
- OS 外部文件拖入、Tauri 原生保存关闭重开未验证；浏览器内工作区文件拖放和文档快照链路已验证。
- 冲突策略明确为“完成的本地组合输入优先此公式”。同一公式的重叠远程内容可能被替代，会给出通知；节点被删除或替换时不复活节点，并通知未提交的源码。复杂多处差异会保守地按一个覆盖范围判断冲突。
- 未承诺非法或未闭合数学 Markdown 在模式切换后仍渲染为公式；模式往返的原样保证针对未改动的源码，输入仍按既有 Markdown 语法解释。

本提交仅包含上述文件。工作区中已有及并行产生的图标、工作区替换、Rust、DocumentManager 等其他修改不纳入本次提交。
