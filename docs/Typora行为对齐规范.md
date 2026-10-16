# LightEdit — Typora 行为对齐规范 (Typora Behavior Specification)

> 最新覆盖说明：[语言与局部编辑整改报告](统一语言与Typora编辑体验整改_2026-10-15.md)。不能把“所有行内标记永远隐藏”视为 Typora 目标：支持的链接、图片、强调/行内代码可随焦点局部编辑源码，标题只显示级别标识；正文、表格、代码不整块展开，局部 CM 共用 canonical 历史。代码选择器现为搜索 listbox/键盘，46 条注册/按需 loader，普通与内嵌使用统一颜色，SVG 复制。菜单在正常流 footer 展开；未实测的 Typora 行为/视觉仍 UNVERIFIED。

版本：2026-10-16  
参考官方基准文档：
- [Quick Start](https://support.typora.io/Quick-Start/)
- [Markdown Reference](https://support.typora.io/Markdown-Reference/)
- [Search](https://support.typora.io/Search/)
- [Images](https://support.typora.io/Images/)
- [Links](https://support.typora.io/Links/)
- [Code Fences](https://support.typora.io/Code-Fences/)
- [Table Editing](https://support.typora.io/Table-Editing/)
- [Typeset](https://support.typora.io/Typeset/)
- [HTML](https://support.typora.io/HTML/)

环境更正（2026-10-15）：本轮发现已运行的 Typora 客户端（`README.md - Typora`），但 Computer Use 读取窗口被拒绝；本轮未获得用户参考截图内容或同设置 Typora 实测。下文是行为目标，不能作为已验收证据。当前功能/交互测试与所有视觉 UNVERIFIED 项见 [复验报告](Typora体验复验与修复_2026-10-15.md) 和 [差距矩阵](Markdown功能差距矩阵.md)。

---

## 1. 核心交互契约 (Interaction Contract)

LightEdit Markdown Live 遵循以下 10 条交互准则：

1. **阅读态优先呈现**：排版内容（正文、表格、代码高亮、公式、图表、图片）默认直接呈现排版效果，严禁常态展示 Markdown 标记符号。
2. **就地编辑 (In-place Editing)**：点击元素时保持当前排版形态，不展开为整段原始反引号或管道符源码。
3. **锚定微交互工具**：链接、图片、表格等专属工具栏必须紧邻当前元素（Popover / Anchored Floating Toolbar），彻底废弃编辑器顶部的全屏 Sticky 工具条。
4. **模式连贯性**：查找 (Ctrl+F) 与替换 (Ctrl+R) 必须在 Live 模式内执行，严禁因查找命令强行退回 Source 模式。
5. **快捷键模式隔离**：快捷键（如 Ctrl+F、Ctrl+R、Ctrl+B、Ctrl+I、Tab、Shift+Tab）在当前 Live 模式完整处理，不破坏排版容器。
6. **文档结构不跳动**：呼出工具浮层或搜索条时，采用 absolute/fixed 浮层停靠，不挤压 Markdown 排版文档，避免页面宽度和垂直位置跳动。
7. **组件生命周期稳定**：常规输入与光标移动不重复触发 NodeView 卸载重载；图片资源与重型图表按需加载、具备缓存防闪烁。
8. **输入法完整保护 (IME Safety)**：中文组合输入状态下（compositionActive）拦截任何破坏性模式切换与快照覆盖。
9. **跨块撤销/重做一致**：所有通过 Live 界面引发的文字、属性、行列修改均进入统一的 DocumentManager 历史，保持与 Source 模式对称。
10. **源码保真与安全**：查看、搜索、无害属性变更及未修改块在 MarkdownSourceBridge 中保持 100% 原始字节与格式一致（CRLF、BOM、缩进、未修改代码块围栏）。

---

## 2. 交互细则与验收矩阵

### 2.1 查找与替换 (Live Search & Replace)
- **快捷键**：
  - `Ctrl+F`：在 Live 模式右上角呼出紧凑查找条，焦点直达查找输入框。
  - `Ctrl+R`：在 Live 模式呼出查找替换条并展开“替换”行。
  - `Enter`：跳转到下一个匹配项。
  - `Shift+Enter`：跳转到上一个匹配项。
  - `Escape`：关闭查找面板，平滑恢复正文光标。
- **匹配与高亮**：
  - 正文中通过 ProseMirror DecorationSet 呈现所有匹配（弱高亮）与当前焦点匹配（强高亮）。
  - 内嵌代码块中的匹配项同步联动高亮。
  - 支持“区分大小写”、“全词匹配”、“正则表达式”三种选项。
  - 支持中文字符、英文字符与标点符号。
  - 搜索计数格式：`当前序号 / 总匹配数`（如 `3 / 15`），无匹配时提示 `0 处`。
- **替换行为**：
  - “替换”替换当前高亮匹配；“全部替换”一次性原子替换所有匹配。
  - 替换动作通过 ProseMirror Transaction / DocumentManager 分发，Undo/Redo 完备可用。

### 2.2 图片展示与交互 (Image Experience)
- **默认形态**：
  - 仅显示图片本身，保持固有比例，最大宽度适应内容区（100%），无固定高度裁切。
  - 单独成段的图片自动居中显示；行内图片按行内流动排列。
  - 彻底去除 `.md-image-status`（如“已加载”）、去除路径文字按钮及多余卡片边框。
- **点击交互**：
  - 点击图片显示轻量选中光晕（Accent Outline）。
  - 在图片正下方/上方浮出轻量悬浮工具栏，提供：
    - `路径 (src)` 输入框（可手动修改或触发替换）。
    - `替代文本 (alt)` 输入框。
    - `删除图片` 动作按钮。
  - 浮层支持 Escape 关闭或点击外部自动收起。
- **资源安全与加载**：
  - 本地图片严格沿用 Rust 授权读取机制；远程图片遵守允许列表；图片加载失败展示友好占位及重试。

### 2.3 链接交互 (Link Popover)
- **默认形态**：
  - 普通链接文字带主题强调色与下划线，不显示原始 `[text](url)`。
- **点击与悬浮**：
  - `Ctrl+Click`（或 `Cmd+Click`）：直接在外部浏览器打开链接，或在文档内平滑跳转到对应 Heading 锚点。
  - 普通单击：在被点击的链接节点下方呼出紧凑悬浮卡片。
  - 悬浮卡片功能：
    - 文本输入：实时同步链接显示内容。
    - URL 输入：实时更新链接目标地址。
    - 操作按钮：`打开链接`、`复制链接`、`取消链接 (Unlink)`。
  - 交互细节：Enter 确认应用，Esc 退出编辑，点击正文其他位置自动保存并关闭。

### 2.4 代码块交互 (Code Fence & Syntax)
- **视觉排版**：
  - 采用柔和的背景色（如 `--md-code-bg`），圆角与适度内边距。
  - 块内左侧默认包含从 1 开始的代码行号（行号与代码编辑区分界清晰，行号不可选入剪贴板）。
  - 默认隐藏常驻的粗暴工具条，不出现三反引号 ```` ``` ````。
- **语言切换器**：
  - 代码块右下角常驻轻量语言徽标；鼠标悬浮或聚焦时高亮。
  - 点击徽标或输入快捷聚焦，弹出语言可搜索输入框，支持切换 JavaScript、TypeScript、Java、SQL、Python、HTML、CSS 等。
  - 切换语言立即刷新语法高亮，并安全同步底层 fence info string，历史可撤销。
- **复制按钮**：
  - 右上角按需显示（悬浮或聚焦显示）“复制代码”按钮，复制纯代码文本（无行号、无围栏）。
- **Mermaid 特例**：
  - Mermaid 代码块默认直接渲染可视化流程图/时序图。
  - 顶部/右上角提供轻量“编辑源码”切换开关，点击后展开内联 CodeMirror 编辑源码，失焦或点击“完成”后重新渲染。

### 2.5 表格操作与浮动工具栏 (Table Editing)
- **排版视觉**：
  - 极细边框（1px solid），表头（th）轻量背景加粗，单元格留白舒适（padding: 6px 12px）。
  - 表格自适应容器宽度，内容超长时支持横向无损滚动。
- **跟随式工具栏**：
  - 点击表格任意单元格时，浮动工具栏跟随锚定在表格上方。
  - 工具栏操作：前插行、后插行、删除行、前插列、后插列、删除列、左对齐、居中、右对齐、删除表格。
  - 离开表格且失焦时自动隐藏。
- **键盘导航**：
  - `Tab`：跳到下一个单元格；如果在最后一个单元格按 `Tab`，自动新增一行并聚焦首列。
  - `Shift+Tab`：跳到上一个单元格。
  - `Ctrl+Enter`：当前行后快速插入新行。

### 2.6 选区浮动格式条 (Floating Selection Bubble)
- 当用户在正文中通过鼠标或键盘选择文本时，在选区上方平滑浮现迷你格式条：
  - 粗体 (`Ctrl+B`)
  - 斜体 (`Ctrl+I`)
  - 删除线 (`Ctrl+Shift+X`)
  - 行内代码 (`Ctrl+```)
  - 插入链接
- 选区折叠或失焦时自动淡出，不阻碍正常输入打字。

### 2.7 扩展语法与数学公式
- **数学公式 (KaTeX)**：
  - 行内与块级公式默认渲染 KaTeX 排版数学符号。
  - 点击后在公式旁弹出轻量 LaTeX 源码编辑框，实时预览渲染结果。
- **目录 (TOC)**：
  - `[toc]` 语法节点直接呈现为树形标题导航，点击任意项平滑滚动并聚焦正文 Heading。
- **Front Matter (YAML)**：
  - 文档开头的 YAML Front Matter 渲染为优雅的紧凑元数据徽章条，支持展开修改源码。
