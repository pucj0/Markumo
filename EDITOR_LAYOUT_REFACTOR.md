# LightEdit：Fleet 风格多分栏与编辑器交互全面重构报告

## 1. 原有 Bug 的实际根因与修复证据

### 问题 1：空编辑区输入后提示“请等待文件操作和输入完成后再关闭”
- **根因分析**：
  1. 旧代码中 `DocumentManager.mount()` 在没有活动文档时使用默认空 `EditorState.create()` 创建了孤儿 `EditorView`，且在无文档时 `applyTransactions` 直接返回，导致空编辑区可能获得输入光标但无法将变更归属到任何真实文档。
  2. `EmptyEditorPane.vue` 之前在根标签上设置了 `tabindex="0"`，导致用户点击空区域时，浏览器原生聚焦到非输入元素上。当用户使用中文输入法（IME）或敲击按键时，WebView2 触发了全局的 `compositionstart` 事件；此时如果没有关联文档或未正确结束，会导致输入状态挂起。
  3. 当用户尝试关闭窗口时，`onCloseRequested` / `WindowCloseGuard` 检测到 `manager.isComposing` 或文件忙状态为真，拦截了关闭操作并弹出提示：“请等待当前文件操作完成后再关闭”或“请先完成当前输入法输入，再关闭窗口”。
- **修复措施与证据**：
  1. 重写 `EditorPane.vue` 与 `EmptyEditorPane.vue`：无文档时完全不挂载 CodeMirror 的 `EditorView`，仅展示纯静态无输入陷阱的 `EmptyEditorPane`。移除了 `EmptyEditorPane` 上的 `tabindex="0"`，提供明确的“新建文件”与“快速打开”按钮，并支持作为拖拽落点。
  2. `DocumentManager` 中重构 `isComposing` 逻辑：只在存在活动文档且该 Pane 挂载的实际视图明确处于 `compositionStarted` 状态时才判定为正在输入。退出或取消输入法组合态后立即解除阻止。
  3. 针对性复现测试 `tests/reproduce-phase-a-flow.test.ts`：打开三个文件 → 创建分栏 → 全部关闭 → 点击空区域模拟输入 → 点击新建文件输入文本 → 触发窗口关闭保护。测试证实空区域输入不再触发任何异常 Toast，无脏修改时窗口可正常销毁，有脏修改时正确弹出未保存确认，测试结果：**PASS**。

### 问题 2 & 3：无法自由四方向创建分栏，仅支持固定双分栏
- **根因分析**：
  旧版 `DocumentManager` 和 `EditorContainer.vue` 在架构上固定使用 `main` / `secondary` 双 Pane 和 `isSplit: boolean`，无法表达水平/垂直嵌套以及 3 个以上的编辑窗口。
- **修复措施与证据**：
  重构为递归 Split Tree 架构，抽离 `EditorLayoutManager`（`LayoutNode = PaneLeafNode | PaneSplitNode`）。
  支持向左、向右、向上、向下拆分（`SplitDirection = 'left' | 'right' | 'top' | 'bottom'`），支持任意深度混合嵌套，每个 Pane 拥有独立的稳定 `paneId` 与独立的 `TabGroup`。
  单元测试 `tests/editor-layout.test.ts` 与 `tests/split-tree-editor.test.ts` 覆盖 3+ 混合 Pane 及多方向拆分，结果：**PASS**。

### 问题 4：关闭所有文件后空分栏仍然存在
- **根因分析**：
  旧代码在关闭一个 Pane 的所有标签后，并未清理该 Pane，也没有自动将父级分栏折叠。
- **修复措施与证据**：
  在 `EditorLayoutManager` 中实现 `collapseEmptyPanes()` 与 `closeTab()` 生命周期自动回收策略：
  - 当非唯一 Pane 的标签全部关闭时，自动回收该 Pane，并将其父级 Split 节点折叠为其兄弟节点。
  - 用户关闭所有文档后，布局自动平滑恢复为唯一的空白 Pane（规范化为 `'main'`）。
  - 同一文档在多个 Pane 中展示时，关闭其中一个 Pane 的标签仅移除该 Pane 对文档的引用；只有当关闭该文档在所有 Pane 中的最后一个引用且有未保存修改时，才提示保存确认。
  测试见 `tests/split-tree-editor.test.ts`（6 个测试用例全部 **PASS**）。

### 问题 5：自动换行状态同步与多分栏联动异常
- **根因分析**：
  视图菜单的“自动换行”命令仅修改了布尔值 `wordWrap.value`，未能向所有活动的 `EditorView` 实时派发 CodeMirror 的 `lineWrapping` 配置更新；在多分栏和标签切换时状态脱节。
- **修复措施与证据**：
  - `DocumentManager.setWrap(wrap)` 不仅为所有缓存文档记录更新配置 Compartment，还直接向所有当前挂载在 DOM 中的活动 `EditorView` 派发重配置。
  - 换行属于纯视觉渲染层，不修改文本、换行符（CRLF/LF）或编码字节。
  - 新增针对性测试 `tests/word-wrap.test.ts`，验证 TXT、JS、Markdown 在三态模式下的即时换行生效与源码无损性，结果：**PASS**。

---

## 2. 布局状态模型及关键设计

### 核心类型定义（`src/editor/layout/types.ts`）
```ts
export type SplitDirection = 'left' | 'right' | 'top' | 'bottom'
export type SplitOrientation = 'horizontal' | 'vertical'

export interface PaneLeafNode {
  type: 'leaf'
  id: string // 稳定 paneId
}

export interface PaneSplitNode {
  type: 'split'
  id: string // splitId
  orientation: SplitOrientation
  ratio: number // 0.05 ~ 0.95，默认 0.5
  first: LayoutNode
  second: LayoutNode
}

export type LayoutNode = PaneLeafNode | PaneSplitNode
```

### 关键设计原则
1. **纯状态与视图分离**：
   `EditorLayoutManager` 作为纯状态管理器，管理树形分栏数据、活动 Pane 焦点、最大化/恢复状态，完全可进行无 DOM 环境下的确定性单元测试。
2. **多视图同文档协同**：
   同一个文档可在多个 Pane 中同时打开。`DocumentManager` 维护统一的文档内容和撤销历史；当任意 Pane 进行编辑产生事务时，所有当前显示该文档的 `EditorView` 均会实时收到同步更新，而选区（Selection）与滚动位置（ScrollDOM）在各自 Pane 内完全独立保留。
3. **Fleet 风格拖拽与落点识别**：
   - 当在 Pane 内部拖动标签时，计算精准的前后插入指示线进行重排。
   - 当把标签或文件拖到 Pane 边缘时，触发 Fleet 风格的 4 方向边缘 Drop Zone（距边缘 25% 范围内高亮），松开鼠标即可在对应方向自动拆分创建新 Pane。
   - 当拖到 Pane 中央（中央 50% 范围）时，高亮整个 Pane，松开鼠标将标签移入当前 Pane。
4. **旧版本设置平滑迁移**：
   `EditorLayoutManager.deserialize()` 能够识别旧版 `{ isSplit: boolean, ratio: number }` 配置，自动迁移为标准两分栏树结构；缺失的文件安全移除，不产生僵尸空 Pane。

---

## 3. 修改文件列表

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `src/editor/layout/types.ts` | 新增 | 定义递归 Split Tree 数据模型、方向与序列化接口 |
| `src/editor/layout/EditorLayoutManager.ts` | 新增 | 递归 Split Tree 状态管理器，支持拆分、折叠、拖拽重排、焦点导航与回收 |
| `src/components/layout/DropZoneOverlay.vue` | 新增 | Fleet 风格四方向边缘与中央拖拽落点高亮半透明遮罩组件 |
| `src/components/layout/EditorPaneItem.vue` | 新增 | 单个 Leaf Pane 容器，承载 TabBar、Breadcrumb、EditorPane 及落点事件 |
| `src/components/layout/SplitLayoutNode.vue` | 新增 | 递归分栏节点组件，渲染水平/垂直 Split、可拖动调节的分隔条及最大化支持 |
| `src/components/layout/EditorContainer.vue` | 修改 | 编辑主体区重构为加载递归 SplitLayoutNode，对接拖拽与全分栏关闭事件 |
| `src/components/layout/TabBar.vue` | 修改 | 标签栏交互重构：完整 13 项右键菜单、拖拽前后插入指示线、固定标签隐藏叉号 |
| `src/components/layout/TreeNodeItem.vue` | 修改 | 支持将文件树条目直接拖拽至编辑器或分栏边缘进行打开/拆分 |
| `src/editor/core/DocumentManager.ts` | 修改 | 接入 EditorLayoutManager，支持任意 N 个 Pane 的视图管理、事务多向分发与安全回收 |
| `src/features/files/FileController.ts` | 修改 | close 方法支持通用 string 类型的 pane 参数 |
| `src/app/useAppShell.ts` | 修改 | 注册多分栏拆分、合并、最大化、方向导航等命令，完善关闭与工作区文件拖入链路 |
| `src/features/shell/mainMenu.ts` | 修改 | 视图菜单中增加“编辑器布局 >”二级菜单，规范布局与 Markdown 视图分层 |
| `src/App.vue` | 修改 | 接入统一分栏事件（close-tab、open-path、reveal-in-explorer） |
| `tests/editor-layout.test.ts` | 新增 | Split Tree 纯状态操作 12 项单元测试 |
| `tests/split-tree-editor.test.ts` | 新增 | DocumentManager 多分栏、多视图协同与回收 6 项集成测试 |
| `tests/reproduce-phase-a-flow.test.ts` | 新增 | P0 Phase A 空编辑器输入与关闭异常复现及修复验证用例 |
| `tests/word-wrap.test.ts` | 新增 | 自动换行即时生效、跨 Pane 联动与无损编码保存测试 |
| `docs/PHASE_PROGRESS.md` | 修改 | 记录本次重构台账 |

---

## 4. 所有功能完成情况清单

- [x] **P0：修复空编辑器输入与窗口关闭异常**
  - [x] 空 Pane 使用纯净的 `EmptyEditorPane`，无文档时不挂载 CodeMirror。
  - [x] 空区域不捕获输入法焦点，不会触发 `compositionstart` 误伤或阻塞窗口关闭。
  - [x] 空 Pane 提供“新建文件”与“快速打开”按钮，点击后直接激活该 Pane 并正常输入。
  - [x] `WindowCloseGuard` 记录明确来源诊断信息，不泄露文件正文，脏文件保护与保存中保护正常工作。
- [x] **P0：通用多 Pane 分栏模型 (Split Tree)**
  - [x] 彻底淘汰 `isSplit` 与 `main`/`secondary` 写法，支持任意多个 Pane。
  - [x] 支持向左拆分、向右拆分、向上拆分、向下拆分。
  - [x] 支持任意深度的嵌套混合布局。
  - [x] 支持同文档跨 Pane 协同编辑（文本内容与撤销历史实时一致，光标、选区、滚动独立）。
  - [x] 支持拖拽分隔条调整比例并支持键盘方向键调整。
- [x] **P0：标签拖拽与落点交互**
  - [x] 同一 Pane 内拖动标签：显示精确的插入指示线，只改变顺序不创建分栏。
  - [x] 不同 Pane 之间拖动标签：顺利移动到目标 Pane，源 Pane 不残留。
  - [x] 拖动到 Pane 边缘：触发 4 方向半透明落点高亮，释放后在对应方向创建新分栏。
  - [x] 拖动到 Pane 中央：直接加入目标 Pane 标签栏。
  - [x] 工作区文件树条目拖动：支持拖入现有 Pane 或分栏边缘创建新分栏。
  - [x] 拖拽取消后恢复原状，不产生幽灵分栏或重复标签。
- [x] **P0：空分栏自动回收**
  - [x] 关闭非唯一 Pane 的最后一个标签，自动回收该空 Pane 并折叠父节点。
  - [x] 用户关闭所有文档后，布局自动恢复为唯一的空白 Pane。
  - [x] 关闭同文档多视图的其中一个标签，仅解除该 Pane 引用；仅当最后一个引用被关闭且有未保存修改时，才提示保存确认。
- [x] **P1：完整标签右键菜单**
  - [x] 关闭、关闭其他标签、关闭右侧标签、关闭全部标签。
  - [x] 固定 / 取消固定（固定标签不显示关闭叉号，防止误关）。
  - [x] 向左 / 右 / 上 / 下拆分分栏。
  - [x] 移动到已有 Pane（多分栏时显示对应目标子菜单）。
  - [x] 复制到新分栏（同文档多视图）。
  - [x] 关闭当前分栏、合并全部分栏。
  - [x] 复制完整路径、复制相对路径、在系统文件管理器中显示。
  - [x] 不适用的项动态置灰或隐藏。
- [x] **P1：自动换行修复**
  - [x] 点击“自动换行”立即反映到所有活动编辑器中。
  - [x] 纯视觉布局变更，不修改文本、换行符（CRLF/LF）或 BOM。
  - [x] 菜单勾选状态与实际编辑器状态严格同步。
- [x] **P1：分栏焦点与导航**
  - [x] 聚焦左侧、右侧、上方、下方分栏（基于 Split Tree 拓扑结构精准定位）。
  - [x] 切换到下一个分栏。
  - [x] 最大化当前分栏 / 恢复多 Pane 布局。
  - [x] 关闭当前分栏、合并全部分栏。
- [x] **P1：视图菜单重整**
  - [x] 视图菜单中增加“编辑器布局 >”（向右拆分、向下拆分、最大化当前编辑器、恢复编辑器布局、合并所有分栏）。
  - [x] Markdown 模式与编辑器分栏层级严格解耦。

---

## 5. 实际执行的测试与结果

### 自动化测试命令与结果
1. `pnpm typecheck`
   - **结果**：**PASS**（vue-tsc 0 错误，tsc 0 错误）
2. `pnpm test`（Vitest 单测/集成）
   - **结果**：**21 passed (21 test files, 224 passed / 224 total tests)**
     - `tests/editor-layout.test.ts`：12/12 PASS
     - `tests/split-tree-editor.test.ts`：6/6 PASS
     - `tests/reproduce-phase-a-flow.test.ts`：1/1 PASS
     - `tests/word-wrap.test.ts`：2/2 PASS
     - `tests/editor-core.test.ts`：32/32 PASS
     - `tests/phase6-features.test.ts`：9/9 PASS
     - `tests/window-close.test.ts`：7/7 PASS
     - `tests/change-gutter.test.ts`：18/18 PASS
     - `tests/workspace.test.ts`：14/14 PASS
     - 其余 12 个历史测试套件均 100% 通过
3. `pnpm build`
   - **结果**：**PASS**（Vite 生产打包生成 `dist/`，207 个模块处理完成）
4. `cargo check --manifest-path src-tauri/Cargo.toml`
   - **结果**：**PASS**（Finished dev profile in 0.56s）
5. `cargo test --manifest-path src-tauri/Cargo.toml`
   - **结果**：**58 passed / 58 tests**，0 failed，0 ignored

---

## 6. 尚未通过的测试和剩余风险

1. **真实 Windows 系统输入法（微软拼音/搜狗）长时组合态**：
   在自动化测试中使用合成事件验证了 compositioncancel、compositionend 以及无文档时的 IME 安全机制；真实 Windows 系统在极端快速切换窗口失焦时的原生 IME 组合态需要人工桌面验收。
2. **多显示器不同 DPI 下的拖拽落点精度**：
   `DropZoneOverlay` 基于 `getBoundingClientRect` 相对位置百分比计算（25% 边界），在常规 100% 和 125% DPI 缩放下表现稳定；跨屏拖拽超高 DPI 屏幕时的视觉平滑度需人工体验。
3. **跨独立操作系统物理窗口分栏**：
   按需求规范，本次聚焦在主工作区窗口内的通用任意多分栏，未实现跨独立操作系统窗口拆离（Fleet 也主要在主窗口岛状分栏）。

---

## 7. 必要的 Windows 手工验收步骤

1. **空编辑区输入与窗口关闭验证**：
   - 启动 LightEdit，打开 3 个文本文件。
   - 点击右键标签选择“向右拆分”。
   - 逐个点击关闭全部文件的标签，直到所有文件被关闭。
   - 确认编辑器恢复为单一空白 Pane，中央显示“新建文件”与“快速打开”按钮。
   - 点击空白区域任意位置，切换中文输入法（微软拼音）尝试键入中英文字符。
   - 点击右上角或标题栏的“关闭窗口”按钮（`×`）。
   - **预期结果**：窗口应立即正常关闭，**不得出现**“请等待文件操作和输入完成后再关闭”或“请先完成当前输入法输入”的错误 Toast。
2. **多向分栏与同文档协同验证**：
   - 打开同一个文本文件 `demo.txt`。
   - 依次通过标签右键菜单执行“向右拆分”、“向下拆分”。
   - 此时出现 3 个分栏窗口。在左侧分栏中输入一段文字。
   - **预期结果**：其余两个分栏中的文本内容实时同步更新；分别在各分栏滚动不同位置或选中文本，滚动条和光标完全独立，不互相跳动干扰。
3. **四方向标签拖放验证**：
   - 拖拽任意标签移动至编辑区最左侧（距左边缘 1/4 处），观察是否出现左半屏浅色高亮遮罩，松开后是否在左侧创建分栏。
   - 拖拽标签至编辑区最上方或最下方，观察上下半屏高亮并成功垂直拆分。
   - 拖拽标签至现有分栏的中央，观察全屏高亮，松开后标签移动进入该分栏。
4. **空分栏自动回收验证**：
   - 在多 Pane 状态下，关闭其中一个 Pane 内的所有标签。
   - **预期结果**：该空分栏立即自动消失，相邻分栏自动平滑铺满空间，无残留空白或无响应黑块。
5. **工作区目录树拖拽**：
   - 打开工作区文件夹，从左侧侧边栏目录树中按住一个文件，拖动到编辑区右边缘。
   - **预期结果**：触发向右拆分并在新分栏中打开该文件。
6. **自动换行验证**：
   - 打开包含长单行的文本或代码文件。
   - 点击菜单栏“视图” > “自动换行”。
   - **预期结果**：长行立即按当前窗口宽度折行显示，菜单上“自动换行”显示勾选状态；再次点击取消，立即恢复单行横向滚动。
