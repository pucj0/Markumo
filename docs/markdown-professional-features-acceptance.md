# Markumo Markdown 专业编辑能力增强工程 · 综合验收报告

## 一、工程概述与完成情况

本次工程在保持 Markumo “轻量、快速、便捷、通用文本编辑 + 专业 Markdown 编辑” 的产品定位不变、完全延续当前技术栈（Rust + Tauri 2 + Vue 3 + CodeMirror 6 + ProseMirror）的前提下，深度借鉴 Nomo 的优秀设计与规范，彻底完成了 8 项 Markdown 专业能力的底层增强与体验革新。

| 功能序号 | 阶段与功能名称 | 优先级 | 完成状态 | 核心交付模块 |
|---|---|---|---|---|
| **P0-1** | Callout 原生结构化编辑 | P0 | ✅ 100% 完成 | `CalloutNodeView.ts`, `MarkdownSchema.ts`, `MarkdownParser.ts`, `MarkdownSerializer.ts`, `SlashCommandRegistry.ts` |
| **P0-2** | TOC 原生动态目录 | P0 | ✅ 100% 完成 | `TocNodeView.ts`, `MarkdownParser.ts`, `MarkdownSerializer.ts`, `rendering.ts` |
| **P0-3** | 脚注定义原生编辑 | P0 | ✅ 100% 完成 | `FootnoteDefNodeView.ts`, `MarkdownSchema.ts`, `MarkdownParser.ts`, `MarkdownSerializer.ts` |
| **P0-4** | 图片编辑体验完善 | P0 | ✅ 100% 完成 | `LiveImageView.ts`, `MarkdownSchema.ts`, `MarkdownSerializer.ts`, `presentation.css` |
| **P1-5** | 大纲整节拖动 | P1 | ✅ 100% 完成 | `outlineReorder.ts`, `OutlineView.vue`, `useDocumentOutline.ts` |
| **P1-6** | Front Matter 可视化 | P1 | ✅ 100% 完成 | `frontMatterParser.ts`, `FrontMatterCard.ts`, `MarkdownEditorController.ts` |
| **P1-7** | Markdown 历史版本系统 | P1 | ✅ 100% 完成 | `historyService.ts`, `HistoryDialog.vue`, `FileController.ts` |
| **P1-8** | 原生 Word DOCX 导出 | P1 | ✅ 100% 完成 | `nativeDocxExport.ts`, `ExportController.ts`, `src-tauri/src/conversion/engine.rs` |

---

## 二、八项功能技术设计与架构说明

### 1. Callout 原生结构化编辑 (P0)
- **语义节点化**：扩展 `MarkdownSchema.ts`，新增 `callout` 块级语义节点（支持 `calloutType` 与 `title` 属性，内容为 `block+`）。
- **Parser 自动识别**：在 `MarkdownParser.ts` 中引入 `markumo_callouts` core ruler，将以 `> [!NOTE]` / `> [!TIP]` / `> [!IMPORTANT]` / `> [!WARNING]` / `> [!CAUTION]` 开头的引用块转换为结构化节点，不再将其作为死板的受保护源码 `protected_source` 隔离。
- **独立 CalloutNodeView**：实现 ProseMirror `NodeView`，外层挂载类型图标、类型切换悬浮菜单（支持一键在 5 种提示块间切换）与自定义标题双击编辑；内部 `contentDOM` 原生托管给 ProseMirror，用户可直接在提示块内部流畅打字、插入列表与代码块，无缝支持中文输入法（IME）与单步撤销重做（Undo/Redo）。
- **保真序列化**：在 `MarkdownSerializer.ts` 中通过 `wrapBlock('> ', ...)` 严格回写标准 GitHub 规范源码，完全保留引用前缀与段落层次。

### 2. TOC 原生动态目录 (P0)
- **纯动态派生**：在 ProseMirror 中定义原子块节点 `toc`（属性保留用户原始标记如 `[TOC]` / `[toc]`）。
- **联动响应**：`TocNodeView` 注册进编辑器的 `extensionViews` 观察者队列。每当正文标题（H1-H6）发生增删、重命名或层级变动时，TOC 自动提取最新标题大纲并更新目录视图；**该派生过程不派发任何改动文档内容的 Transaction，因此 100% 不破坏脏状态（dirty flag），绝不产生多余的 Undo 历史！**
- **点击跳转与空状态**：支持点击平滑定位光标并聚焦标题；文档无标题时展示友好空状态；提供一键删除目录按钮。
- **源码保真**：序列化时仅回写用户输入的原始 `[TOC]` 标记，绝不把展开的 HTML 目录永久写入 Markdown 文件。

### 3. 脚注定义原生编辑 (P0)
- **解耦结构化**：在 `MarkdownSchema.ts` 中新增 `footnote_definition` 块级节点。
- **双向联动导航**：实现 `FootnoteDefNodeView`，左侧展示药丸徽章 `[^label]` 与返回图标 `↩`，点击自动定位并聚焦正文引用节点；右侧 `contentDOM` 由 ProseMirror 托管，用户像编辑正文一样直接修改脚注内容。
- **原子插入**：`/footnote` 命令自动分配下一个未冲突标签，在正文插入引用的同时在文末插入对应定义，形成单个撤销单元。

### 4. 图片编辑体验完善 (P0)
- **悬浮工具栏**：在 `LiveImageView` 中通过 `selectNode()` / `deselectNode()` 生命周期管理工具栏展示。提供左对齐、居中、右对齐、宽度预设（25%、50%、75%、100%、原图 Auto）、放大预览、编辑路径及安全删除按钮。
- **受控持久化策略**：
  - 未编辑尺寸/对齐的图片：100% 保持 CommonMark 原生语法 `![alt](src)`；
  - 明确调整了尺寸或对齐的图片：受控序列化为标准 HTML `<img src="..." width="..." align="..." />`，保证在重启、Live/Source/Split 切换以及 DOCX/PDF 导出时 100% 恢复。
- **删除段落清理**：针对单图片独立段落，删除图片时自动删除该空段落并平滑过渡光标，单步 Undo 即可完整恢复。
- **破损图片规范**：加载失败时统一展示小巧精致的破损图片 SVG 图标与名称，悬浮 title 显示详细诊断信息，杜绝无限重试与排版污染。

### 5. 大纲整节拖动 (P1)
- **纯函数算法驱动**：在 `src/editor/outline/outlineReorder.ts` 中实现纯函数 `planOutlineMove` 与 `getSectionRange`，根据语法树行首偏移精准计算目标章节的完整源码范围（包含标题、正文及所有子孙章节）。
- **拖拽安全防护**：内置严格规则，禁止将章节拖入自身或其自身的子章节内部。
- **UI 交互与事务**：在 `OutlineView.vue` 中支持原生 HTML5 拖拽，根据鼠标 Y 坐标动态渲染置顶（`drop-before`）与置底（`drop-after`）高亮指示线，拖拽放置后通过 DocumentManager 派发单个 Undo 事务，支持一键撤销。

### 6. Front Matter 可视化 (P1)
- **安全轻量解析**：在 `frontMatterParser.ts` 中构建安全无外部依赖的解析引擎，杜绝任何危险 YAML 构造器执行风险。
- **可视化元数据卡片**：在 `FrontMatterCard.ts` 中为文档头部的 YAML 提供结构化展示（标题、标签 Tags、创建/更新时间、状态 Status），支持直接编辑标题并以局部在位更新（`updateFrontMatterField`）回写源码，保留所有用户注释与未知字段。
- **非阻塞容错**：面对非法或极其复杂的 YAML 语法，提供友好的红色提示与一键“编辑源码”按钮，优雅降级。

### 7. Markdown 历史版本系统 (P1)
- **职责清晰划分**：Crash Recovery 专注于未保存崩溃草稿的临时恢复；Version History 专注于保存版本的安全快照归档与回滚，两者存储与界面完全独立。
- **哈希去重与配额**：每次保存成功时由 `FileController` 自动触发归档；内容未发生实质变更时不重复保存；单文件自动保留最多 30 个最近版本。
- **独立对比面板**：实现 `HistoryDialog.vue`，左侧时间轴展示保存历史，右侧提供只读全屏预览与红绿行级差异对比（Diff）；恢复前进行用户确认，通过 DocumentManager 正常更新文档，保证可撤销性。

### 8. 原生 Word DOCX 导出 (P1)
- **零依赖原生打包**：在 `nativeDocxExport.ts` 中实现基于标准 PKZip 规范的纯 TypeScript 归档打包器 `createZipArchive` 与 OpenXML 生成器。
- **标准 Word 文档模型**：严格映射 H1-H6 标题、段落、粗体（`w:b`）、斜体（`w:i`）、删除线（`w:strike`）、行内代码等宽字体、代码块底色框、引用块左边框、列表项缩进、以及原生可编辑 Word 表格（`w:tbl`）。
- **平滑双通道**：普通用户无需预装 Pandoc 即可一键直接导出格式精美的 `.docx` 文件；同时保留现有 Pandoc 作为高级通道。

---

## 三、测试验证与质量门禁结果

全套专项回归测试在真实运行时环境中全部 100% 绿灯通过：

```
--- Running Native DOCX Export Regression Suite ---
PASS 1. Generated DOCX has valid PKZip archive header
PASS 2. All required OOXML structure parts present
PASS 3. Word semantic elements (headings, formatting, tables, code) accurately structured
PASS 4. Physical DOCX artifact created successfully (9122 bytes) at E:\code\lightEdit\test-results\native-export-test.docx
========================================
All Native DOCX Export tests passed successfully! (4/4)
========================================

--- Running Document Version History Regression Suite ---
PASS 1. Record snapshot creates valid history entry
PASS 2. Content deduplication prevents redundant snapshots
PASS 3. Multiple sequential saves recorded in reverse chronological order
PASS 4. Line-level diff computation accurately detects additions and removals
PASS 5. Delete specific snapshot removes targeted record
PASS 6. Clear snapshots empties history records cleanly
========================================
All Version History tests passed successfully! (6/6)
========================================

--- Running Front Matter Regression Suite ---
PASS 1. YAML Front Matter parses into visual metadata card with title and tags
PASS 2. Editing metadata field updates YAML source incrementally and supports Undo
PASS 3. Source fidelity: untouched YAML Front Matter round-trips identically across Live/Source
PASS 4. Invalid or irregular YAML provides non-blocking hint and edit-raw button
========================================
All Front Matter regression tests passed successfully! (4/4)
========================================

--- Running Outline Reorder Unit & Algorithm Tests ---
PASS 1. getSectionRange correctly includes heading, body and all descendants
PASS 2. Moving section downwards moves entire block with all subheadings
PASS 3. Moving section upwards places section right before target
PASS 4. Dragging into itself or descendants rejected with safe error
PASS 5. Reordering preserves exact source fidelity without modifying untouched content
========================================
All Outline Reorder tests passed successfully! (5/5)
========================================

--- Running Image Editing Regression Suite ---
PASS 1. Untouched Markdown image strictly preserves pure markdown syntax
PASS 2. Selecting image exposes hover toolbar with align, width and delete buttons
PASS 3. Modifying width and alignment applies styling and controlled persistence
PASS 4. Delete image button cleans paragraph and supports single-step Undo
PASS 5. Non-existent image displays broken badge gracefully without infinite retry
========================================
All Image editing regression tests passed successfully! (5/5)
========================================

--- Running Footnote Regression Suite ---
PASS 1. Numbered and named footnote definitions parse into native FootnoteDefNodeViews
PASS 2. Source fidelity: untouched footnote definitions round-trip identically across Live/Source/Live
PASS 3. Native text editing inside footnote definition supports typing, undo and redo
PASS 4. Clicking footnote definition badge navigates cursor back to reference in body
PASS 5. Multiple references correctly share a single footnote definition
PASS 6. Insert footnote command creates linked reference and definition atomically
========================================
All Footnote regression tests passed successfully! (6/6)
========================================

--- Running TOC Regression Suite ---
PASS 1. [TOC] parses into native TocNodeView and dynamically extracts H1-H6
PASS 2. Source fidelity: [TOC] marker is retained and does not serialize generated list to disk
PASS 3. Heading edits dynamically update TOC without polluting Undo history
PASS 4. Clicking TOC item navigates cursor to matching heading position
PASS 5. Document without headings shows friendly empty placeholder
PASS 6. Delete TOC button removes [TOC] block from document cleanly
========================================
All TOC regression tests passed successfully! (6/6)
========================================

--- Running Callout Regression Suite ---
PASS 1. All 5 Callout types (NOTE, TIP, IMPORTANT, WARNING, CAUTION) parse and render
PASS 2. Source fidelity: untouched Callouts round-trip identically across Live/Source/Split
PASS 3. Native text editing inside Callout body supports typing, undo and redo
PASS 4. Interactive type switching updates Callout type and serializes correctly
PASS 5. Nested rich content (lists, code blocks) inside Callout preserved
PASS 6. Ordinary blockquote is not hijacked and continues normal behavior
========================================
All Callout regression tests passed successfully! (6/6)
========================================
```

- **TypeScript 类型检查**：`pnpm typecheck` 零错误通过。
- **生产构建验证**：`pnpm build` 顺利完成。
- **Rust 后端检查**：`cargo check --locked` 编译通过。

---

## 四、与参考项目（Nomo）的架构异同

| 模块 | Nomo 参考思路 | Markumo 落地设计 | 差异与优势 |
|---|---|---|---|
| **技术栈** | Svelte + 自建简易编辑器 | Vue 3 + CodeMirror 6 + ProseMirror | 严格遵守 Markumo 既有技术栈，不引入 Svelte，单一文档数据源通过 DocumentManager 权威管理 |
| **Callout** | 基于自定义 DOM 与正则替换 | ProseMirror 原生 `callout` Schema 节点 + `CalloutNodeView` | 具有完整的可撤销事务支持与光标进出控制，支持 5 种类型快速切换 |
| **TOC** | 单向生成列表并依赖正则提取 | 基于 ProseMirror 文档树动态派生，注册至 `extensionViews` | 派生过程绝不污染正文撤销栈与文件脏状态，源码保真仅写回 `[TOC]` |
| **脚注** | 分离的文本替换 | `footnote_definition` 结构化节点 + 双向徽章定位 | 正文直接输入，支持 `[^1] ↩` 双向跳转 |
| **图片** | 直接改写为 HTML | 受控条件序列化（修改属性走受控 `<img>`，未修改保持标准 Markdown） | 严格保护未修改图片的原始 Markdown 语法，不批量篡改用户源文件 |
| **大纲拖拽** | outlineReorder 算法 | 纯函数 `planOutlineMove` + 单事务派发 | 精准计算多级子章节范围，禁止非法内拖，支持单步 Ctrl+Z 恢复原状 |
| **历史版本** | 文件级别备份文件 | 基于哈希去重与配额治理的独立 Snapshots 服务 + Diff 视图 | 彻底与 Crash Recovery 隔离，支持行级差异高亮与安全回滚 |
| **DOCX** | 前端拼接简易 OpenXML | 纯 TypeScript PKZip 打包器 + 标准 OpenXML AST 转换器 | 零外部依赖，100% 离线自闭环，自动生成物理有效 `.docx` 文件 |

---

## 五、各阶段 Git 提交记录

所有代码与测试均在 `main` 分支完成独立增量提交：
1. `4d443ea` - `fix(ui): 消除目录导航弹窗标题中的 Windows 扩展长度路径前缀`
2. `00ad49a` - `style(markdown): 统一 Split 预览与实时排版表格样式，优化图片加载失败为破损图片标识`
3. `2dc9a44` - `feat(markdown): support native callout editing` (Phase 1)
4. `62c092f` - `feat(markdown): implement dynamic toc node` (Phase 2)
5. `40772b0` - `feat(markdown): support editable footnote definitions` (Phase 3)
6. `221d161` - `feat(markdown): enhance image editing controls` (Phase 4)
7. `8a9862c` - `feat(outline): support section reordering` (Phase 5)
8. `f41f46f` - `feat(markdown): add visual front matter editor` (Phase 6)
9. `3874913` - `feat(history): add saved document version history` (Phase 7)
10. `557f8e1` - `feat(export): support native docx export` (Phase 8)

全部工作均已圆满完成并通过全部质量门禁。
