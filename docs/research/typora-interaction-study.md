# Typora 图片与 HTML 实机交互研究

研究日期：2026-10-16。目标项目：Markumo（原 LightEdit）。先执行本节实机研究，再进行本轮源码修改。现有更名修改保留。

## 环境与证据

实际打开并操作本机 **Typora for Windows x64 1.12.4**，版本见 `test-results/typora-study-2026-10-16/00-about.png`。使用 computer-use 技能的 `@oai/sky`，通过真实鼠标、键盘与窗口辅助功能树操作；没有连接 Typora 内部调试接口、反编译或读取其实现。

仅创建和编辑 `test-results/typora-study-2026-10-16/` 下的独立 Markdown 文件及图片。原有 `visual.md` 窗口只用于查看版本与打开新文件，没有编辑其正文。研究窗口为 786×694；本轮没有重新核对主题菜单与字体设置，因此不据此宣称严格像素一致。截图、辅助功能观察 JSON、`.original` 原文副本均在被忽略的临时目录。

关键文件：`compact.md`、`html-compact.md`、`html-special.md`、`input.md`、`images-small.md`。`visual_assets` 含标准相对图片、128px 替换图片和 `中文 图片.png`。`images-small.md` 同时包含 title、连续图片、HTML img、Mermaid → 图片 → 标题 → SQL。

## 实测步骤与对照

| Typora 操作 | 本机实际观察 | 当前项目的只读检查 | 本轮目标与方案 |
|---|---|---|---|
| 初次打开标准 Markdown 图片 | 默认只有图片，正文前后保留 | LiveImageView 已默认渲染，但没有可持久化的边框选项 | 默认开启实际 img 边界上的细边框，设置只影响编辑器视图 |
| 单击图片中央 | 在预览上方展开完整源码，选中 `example`，图片仍保留 | InlineSourceView.focus 对 image 明确选中 alt | **按用户明确要求改为完整图片语法末尾**，不把此行为声称为 Typora 原样表现 |
| 点击图片左右可见边缘 | 两处也选中 alt；`18`、`19` 截图与选区记录可核对 | 点击回调已有当前 PM Node 身份检查；随后按 PM 位置进入局部源码 | 从 Lezer Image 范围取得 raw end，通过正式 CM selection 事务同步，不猜字符偏移 |
| 图片下方空白处点击 | 本次未改变当前 alt 选区，不能概括为任意空白处都进入下段 | 需检查 NodeView 点击与 blur 引起的布局移动 | 点击实际图片区域才进入源码；正文位置保持正常选区规则 |
| Home / End | 单行源码分别到行首、行尾；带 title 且视觉换行时 End 停在当前视觉行末 | 原实现用首个 `]` 选择 alt，不能满足完整语法末尾 | 直接使用已解析 Image 完整范围末尾，包含 title、括号和 UTF-16 中文/emoji |
| 中文空格相对路径与 title | `![alt 中文](<visual_assets/中文 图片.png> "title 标题")` 正常显示；点击选中 `alt 中文` | 需补充真实点击与源码保真回归 | 继续使用解析器范围，不用正则搜索 DOM 文本猜位置 |
| 连续两张图片，点击第二张 | 只展开第二张的 `![second](...)`，不展开第一张 | 原实现有局部 source range 与事务映射 | 加入相同图片、跨 Pane 改动与旧编辑器失效回归 |
| 局部修改 URL | 将第二张图片的扩展名 `png` 改为 `PNG`，图片保留；会出现图片路径操作菜单 | 需检验即时资源刷新和共享撤销 | 原文局部补丁、资源代次检查、一个共享 CM 历史 |
| URL 修改 Undo / Redo | 关闭路径菜单后 Ctrl+Z 恢复 `png`，Ctrl+Shift+Z 重做为 `PNG`；菜单会再次出现 | 原项目已有共享撤销入口 | 不引入独立 textarea 历史覆盖原文历史 |
| 进入源码模式后返回 | 能在整篇源码与渲染状态切换；源代码模式显示完整图片语法 | 项目提供 Live/Source/Split | 切换不得重写原文或丢失局部更新 |
| Markdown H1 与 HTML H1 | 两者均显示标题；点击 Markdown 标题维持正文编辑，点击 HTML 标题进入原位置的 HTML 源码 | HTML blocks 可能是 `html_block` 或带 HTML label 的 `protected_source`，两条入口均分派 HtmlBlockView | 统一这两条入口的编辑、渲染、失效规则；不能只验证裸 parser |
| HTML H1 点击 | 原位局部源码框，默认 caret 在完整 `</h1>` 后；不弹出独立窗口 | HtmlBlockView 使用 textarea，只有保存时提交，外部更新时 draft 可陈旧 | 使用局部 CM6 编辑器与精确原文范围，编辑即提交共享事务 |
| 输入未闭合 / 闭合 H1 | `<h1>输入阶段标题` 已进入 HTML 源码态；补 `</h1>` 后仍在编辑态；按 Enter 后渲染 H1 并进入后续段落 | 原 HTML 编辑器 Ctrl+Enter 才保存，Enter 只换行 | 明确普通 Enter/Shift+Enter/确认/取消的编辑契约，保留中文组合输入 |
| 行内 span 输入与失焦 | 未闭合时显示淡色原标签、正文未变红；补闭合标签后立即变红，当前源码仍显示；点击其他段落后只显示红字 | HtmlInlineView 将 input 气泡追加到 document.body，并 trim 后才保存 | 去掉正文外属性气泡，在当前原文范围内编辑，保留属性、空格和完整原文 |
| strong / kbd / mark | 正文内显示粗体、键帽与高亮，没有另起块 | 当前安全 renderer 支持这些标签 | 保持行内排版与选择复制，编辑入口支持键盘 |
| div / p / 嵌套标签 | 默认显示正常段落；HTML 源码范围保持完整标签 | 当前 HTML NodeView 与 Markdown block 边界需核对 | 解析边界与源补丁先修正，不能靠负 margin/绝对定位掩盖 |
| details 普通点击 | summary 正常切换 open，显示隐藏内容；hover 有 HTML 源码按钮 | 当前块级视图忽略 summary 默认点击；Ctrl+点击缺少显式优先处理 | 保留交互控件默认动作，提供 Ctrl+点击与键盘编辑入口 |
| details 源码末尾 Enter | 结束源码编辑，恢复 HTML 渲染并出现后续空段落 | 当前 textarea 与段落导航分离 | 用正式编辑器命令确认并导航，不直接修改编辑器 DOM |
| 后续空段落 Backspace | 回到 preceding details 源码末尾 | 需补键盘跨节点进入 HTML 的路径 | 定义按方向、Enter/Backspace 进入局部源码的 selection 规则 |
| HTML 源码 Left / Delete / Undo / Redo | Left 移到末尾 `>` 前；Delete 删除它；Ctrl+Z 恢复，Ctrl+Shift+Z 再删除，最后恢复 | 当前 HTML draft 保存前不进入共享历史，两个 Pane 可能覆盖旧值 | 改为共享历史、目标身份与外部修订检查 |
| Esc | 本次在块级 HTML 源码中 Esc 未退出；不能声称 Typora Esc 一定确认或取消 | 项目 Esc 当前取消未保存 draft | 项目会明确自己的退出规则并记录差异 |
| Setext H1/H2、HTML H2 | 默认层级正确；Setext 出现在大纲 | Outline 仅提取 Lezer ATX/Setext | 补 HTML h1–h6，跳过围栏/代码；保留原文行号用于定位 |
| HTML 标题大纲 | 当前窗口的大纲仅列 Markdown/Setext，没有列 HTML 标题 | 项目同样缺少 HTML 标题提取 | 用户明确要求支持，作为项目增强实现，不声称复制 Typora |
| HTML img | 默认显示图片，单击展开原始 img 并选中整个标签 | SafeHtmlRenderer 的资源挂载接入 HTML 图片；需与 Markdown 图片边框共用设置 | 图片点击和局部源码一致，严格保持 src/alt/title/width 属性 |
| SVG | 简单 rect 正常显示，点击进入块级 SVG 源码 | 当前允许 svg/path，但常用 rect 等缺项 | 定义明确的静态 SVG 白名单；外部链接、脚本、foreignObject/动画不开放 |
| 注释 / 未知 / 未闭合标签 | 注释与未知标签源码可见；未闭合 div 的文字可读，后续 AFTER 没被吞掉 | sanitizer 预览可能移除标签；原文仍保存在 node attrs | 不支持的内容显示可编辑原文，不能悄悄丢失；修复错误占用后继块的情形 |
| Mermaid → 图片 → 标题 → SQL | 默认全部渲染，各占正常文档流位置，无覆盖；见 `65-images-document-end.png` | 图片、Mermaid、HTML 为不同 NodeView，异步尺寸通知需检查 | 使用自然文档流、资源代次与布局测量通知；多栏/滚动/缩放回归 |

## 关键截图索引

- 版本：`00-about.png`。
- 图片默认、中央、Home/End、边缘：`07`–`10`、`18`–`20`。
- HTML 默认、H1 源码、行内源码、details：`28`–`35`。
- HTML Delete/Undo/Redo：`36`–`40`。
- Outline、Setext、SVG、HTML img、未知标签：`42`、`45`–`48`。
- H1 逐步输入与行内闭合：`54`–`59`。
- 中文空格与 title：`63-image-chinese-title.png`、`64-image-wrapped-end.png`。
- 相邻块和连续图片：`65-images-document-end.png`、`66-images-consecutive.png`、`67-consecutive-second-click.png`。
- URL 局部修改和历史：`70-image-url-token.png`、`71-image-url-local-edit.png`、`73-image-url-undo.png`、`75-image-url-redo.png`。

这些是实机截取，不是重绘或 mockup。部分早期捕获发生在 UI 仍更新时，以后续稳定截图和 JSON 中的实际 selected_text 为准；没有依据窗口标题推测 caret。

## 未确认项与边界

- 当前 Computer Use 的 click API 没有按住 Ctrl 的 click 参数或 key-down/key-up，因此 **Typora 原生 Ctrl+点击细节 UNVERIFIED**。已实测普通点击与 HTML 源码按钮；官方资料对 Ctrl+点击的说明不能代替实机证据。
- 中文字符串通过 native type_text 输入，不等于真实 Windows 拼音输入法组合输入；**真实 IME 候选窗、长组合串 UNVERIFIED**。项目需另外做 composition 事件和原生输入回归，并区分这两种证据。
- 渲染文本的系统剪贴板内容、跨多个渲染节点的复杂选择、所有标签逐字符输入时机未逐项穷举，**UNVERIFIED**。已经实测 H1 与 span 的未闭合/闭合/确认过程，不能外推所有 HTML 标签。
- Typora 原生多文件长时间性能、每一种非法 HTML 与暗色主题同设置视觉对比没有执行，不声称完全等价。

## 研究后的实现约束

实际项目已采用 **CM6 原始文本与共享历史 + ProseMirror Live 派生视图 + CM6 代码块/Source/Split**。DocumentManager 中的 CM EditorState 保存可信原文。本轮沿用此架构，不更换核心、不把渲染 HTML 序列化成 Markdown，也不新增整篇 contenteditable 来替代 CM6。选择和局部编辑必须提交到该 CM 状态；局部原位编辑器只负责当前 source range。

下一步先形成根因报告，再修改源码；图片末尾定位和 HTML 大纲按用户要求实现，即使本机 Typora 行为与目标不同也必须明确区分。

## 官方资料（辅助，不冒充实测）

[HTML Support](https://support.typora.io/HTML/) 描述行内闭合后渲染、HTML block 编辑和 Ctrl+点击；[Markdown Reference](https://support.typora.io/Markdown-Reference/) 提供 Markdown 基本语法；[Images](https://support.typora.io/Images/) 描述图片路径及资源行为。上表实测结论来自本机 GUI；官方文档不作为缺少截图项目的 PASS 依据。
