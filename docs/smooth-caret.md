# Smooth Caret

设置 → 编辑 → 光标动画提供关闭、快速跟手、平滑滑动，默认平滑滑动。
旧配置缺少此字段或字段无效时采用默认值；有效配置沿用现有 JSON 持久化流程。

## 实现

- `CaretMotion` 是独立的 TypeScript 插值状态机，使用 cubic ease-out。快速模式横向/跨行为 100/140ms，平滑模式为 120/160ms；参数集中在 `caretTimings`。动画途中从当前呈现位置重定向，不排队。
- `CaretOverlay` 使用每个编辑器各自稳定的 DOM；动画帧只更新 transform。坐标测量与动画分开，处理容器滚动、祖先裁剪、CSS zoom 和小数像素。静止时没有持续的 JS rAF；闪烁使用 WAAPI，并在输入、移动时重置。
- 普通文本、代码和 Markdown 源码使用 CM6 ViewPlugin、`coordsAtPos`、`requestMeasure`。每个缓存文档的 Compartment 经 DocumentManager 的共享配置事务传播，保留各窗格独立选区；`setState` 重建插件时清理旧视觉状态。
- Markdown 即时排版使用独立 PM Plugin View 和 `coordsAtPos`。仅在主 PM 编辑区聚焦、空 TextSelection、可编辑且坐标可测时显示；ResizeObserver、MutationObserver、资源加载和字体事件负责布局失效。
- Markdown 代码块使用自己的 CM6 插件与 Compartment，启用动画时配合 `drawSelection`。NodeView 销毁时一并清理。PM 在嵌套编辑器获得焦点时恢复原生行为。
- 不改真实 Selection、不插入文档装饰字符，不修改 MarkdownSourceBridge、序列化和文件内容。没有新增 JS 动画框架、包或 Rust 依赖。

## 回退与边界

选中文字、多光标、NodeSelection、GapCursor、CellSelection、嵌套的其他输入框、只读、失焦、隐藏页面、组合输入和坐标无效时使用原有光标。CM 的 drawSelection 和选择高亮保留；只有成功绘制视觉光标后才隐藏原有光标层。

横向或纵向超过 320 CSS px、明显的光标高度变化、文档重建、滚动或分栏宽度变化直接吸附。位移阈值不依赖字形高度，因此第 6 行到第 12 行这类普通跨行点击仍播放动画，包含行尾空白区域点击。系统要求 reduced motion 时保留定位与编辑行为，停用位移动画和视觉光标闪烁。

中文输入通过 Chromium CDP 的真实 composition 事件流验证；内嵌 CM 另测组合输入的原生回退。自动化无法验证 Windows 原生拼音候选窗口的实际屏幕位置、所有第三方输入法和 WebView2 的系统无障碍朗读，仍需桌面人工验收。多光标保持原有绘制，不分别插值。

## 验证

运行 `node scripts/smooth-caret-regression.mjs`。可通过 `MARKUMO_PLAYWRIGHT_MODULE` 指定 Playwright 模块绝对路径，通过 `MARKUMO_CHROME` 指定 Chrome 可执行文件。产物位于忽略目录 `test-results/smooth-caret/`。

专项覆盖插值与重定向、横向/跨行、内容增长时的 Enter、快速输入、连续按键、Home/End、PageUp/PageDown、鼠标、撤销重做、IME、原生多光标与选区、关闭/热切换、减少动画、长文档、换行/字号/缩放/窗口尺寸、同文档 CM 双栏、PM 双栏及源码/PM 混合分栏、节点选择、图片与 HTML 布局变化、只读、隐藏恢复、测量失败恢复、销毁、静止帧调度、实际设置界面与重新加载。

已执行并通过：

- Smooth Caret 专项回归（23 项，包含真实 build.bat 第 6／12 行行尾、行中、空行点击与两个动画档位）
- `scripts/rich-clipboard-regression.mjs`（14 项）
- `scripts/outline-navigation-regression.mjs`（9 项）
- `scripts/markdown-empty-regression.mjs`
- `scripts/table-layout-regression.mjs`（4 项）
- `pnpm typecheck`
- `pnpm build`（保留现有 node 模块浏览器 externalization、静态/动态导入和大 chunk 提示）

## 修改文件

新增：

- `src/editor/core/caretMotion.ts`
- `src/editor/core/caretOverlay.ts`
- `src/editor/core/smoothCaret.ts`
- `src/editor/core/smoothCaret.css`
- `src/editor/markdown/wysiwyg/plugins/SmoothCaret.ts`
- `scripts/smooth-caret-regression.mjs`
- `docs/smooth-caret.md`

接入与设置：

- `src/editor/core/DocumentManager.ts`
- `src/editor/markdown/wysiwyg/MarkdownEditorController.ts`
- `src/editor/markdown/wysiwyg/CodeBlockView.ts`
- `src/editor/markdown/wysiwyg/contracts.ts`
- `src/editor/markdown/wysiwyg/MarkdownTheme.css`
- `src/features/shell/editorSettings.ts`
- `src/app/useAppShell.ts`
- `src/components/modals/SettingsModal.vue`
- `src/App.vue`
- `src-tauri/src/commands/settings.rs`（桌面 IPC 字段、校验、旧配置默认值与真实文件保存/读取回归）

`src/editor/core/extensions.ts` 已检查；保留其现有 drawSelection、选区背景及核心扩展，动画通过 DocumentManager 的独立 Compartment 接入。
