# Markdown 图片 UX 审计

日期：2026-10-23。本文初稿和证据在任何产品代码修改之前提交。

## 环境与证据边界

- 基线：`main`，`f4c4c7edb68149bf1a376340c88fa26455a0127f`。保留开始时已有的两个未提交文件，不纳入本专项。
- 用 `pnpm tauri build --debug --no-bundle --config <临时配置>` 构建真实 Windows/Tauri/WebView2 桌面程序；前端内嵌构建产物，不是静态网页或 mock。
- 基线 exe SHA256：`E64A68F4B2E806D02D74618E18510FDE82CDF6CAC1F77BE7010D9B2D7EFD965B`。仓库构建路径直接启动报 `Failed to setup app: 拒绝访问 (os error 5)`；将同一 exe 复制到临时目录后正常运行，没有修改系统安全设置。
- 独立工作区：`%TEMP%/markumo-image-ux-20261023`，独立 profile/WebView2 数据。`audit.md`、`typora.md` 内容相同；`insert.md` 是空白插入用文档。所有测试素材由 Pillow 生成，未修改用户文档。
- 本机 Typora：`D:/Program Files/Typora/Typora.exe`，已实际启动并打开相同文档。未完成其全部操作矩阵，不能据此宣称与 Typora 一致。
- 使用 computer-use / `@oai/sky` 真实点击、按键和滚动。截图保存在 `images/image-ux-audit/`。开始时截取的 `00-existing-desktop.png` 只证明旧窗口原有现象，不替代本次构建证据。
- 用户所述五张原始截图本次未附带，无法逐像素对照；以下独立复现 B1–B5。
- 测试中出现外部桌面输入，暂停输入并询问后，用户明确回复“可以继续独占测试窗口”；重新获取窗口和截图后继续。
- **Not Tested** 表示没有完成真实操作，不代表通过。自动浏览器测试和真实桌面 GUI 分开记录。

## 已确认的问题

### IMG-01 / P1：工具栏覆盖图片、越出正文，长图滚动后消失

- 步骤：打开 audit.md → 单击第一张图 → 点 25% → 选择小图；再滚到长图、单击、继续滚动。
- 预期：靠近可见图片，优先上方，无空间时下方；受编辑器及窗口约束；不改变行高，不滚动跳位。
- 实际：默认工具栏在图上沿内部；25% 时左边伸出正文；长图选中产生明显滚动跳位，继续滚动工具栏离开视口。
- 截图：[正常选择](images/image-ux-audit/05-main-toolbar.png)、[25%](images/image-ux-audit/06-main-25-percent.png)、[长图选择](images/image-ux-audit/12-main-tall-selected.png)、[滚动后](images/image-ux-audit/13-main-tall-scroll.png)。
- Typora：单击显示路径，右键提供缩放子菜单，没有观察到同款横向工具栏；长图交互 **Not Tested**。
- 疑似位置：`presentation.css` 的 `top:8px;left:50%;transform`；`LiveImageView.selectNode/applyAttributes`。
- 场景：小图、长图、窄 Pane、图文混排。
- 方向：实际 DOM 测量、视口与 Pane 交集裁剪、滚动/resize/ResizeObserver 重定位，仅选中图监听，避免选择事务自动滚动。

### IMG-02 / P1：失败信息泄漏 JS 对象，原因和恢复动作缺失

- 步骤：打开不存在、损坏和 6000×4000 PNG 的图片；观察占位及辅助功能描述。
- 预期：区分不存在、未授权、解码失败、安全预算，提示可理解并可修复。
- 实际：各类失败均只剩 alt 标签；辅助功能描述是 `图片无法显示: [object Object]`。初始旧窗口还直接显示 `image.png ([object Object])`。
- 截图：[失败图片](images/image-ux-audit/11-main-failures.png)、[初始旧窗口](images/image-ux-audit/00-existing-desktop.png)。真实窗口辅助功能树记录了不存在/损坏/大图三处对象字符串。
- Typora：缺失路径显示可编辑 Markdown 目标，未观察到对象泄漏；其他错误 **Not Tested**。
- 疑似位置：`LiveImageView.loadImage` 中 `String(error)`；`images.ts` 错误格式化；Tauri 结构化错误。
- 场景：本地读取、解码、预算、HTML 图片回退。
- 方向：统一结构化错误解释；用 textContent 构建错误 DOM，提供属性、重试和授权入口。

### IMG-03 / P1：空路径不能直接修复，路径按钮没有可见响应

- 步骤：单击空路径；选择正常图并点铅笔；右键空路径。
- 预期：单击空路径或铅笔即可打开直观属性，允许选择本地文件。
- 实际：空路径单击仅显示工具栏；铅笔后没有出现编辑界面；右键才能打开浮层，只有 alt/path，没有 title、宽度、对齐和选图。
- 截图：[空路径属性](images/image-ux-audit/10-main-empty-properties.png)、[工具栏](images/image-ux-audit/06-main-25-percent.png)。
- Typora：空路径直接显示输入入口及文件夹按钮，见 [Typora 基线](images/image-ux-audit/01-typora-layout.png)。
- 疑似位置：`MarkdownEditorController` 的 image NodeView 回调、`openInlineAt`、`imageProperties`。
- 场景：第一次插图、路径写错、文件移动。
- 方向：统一属性浮层，显式路径修复和本地重选；不强迫原始源码编辑。

### IMG-04 / P1：常见 HTML 图片退回源码框

- 步骤：打开 `<img src="./images/test.png" alt="HTML 测试" width="160" />` → 单击图片。
- 预期：按图片选择/属性交互，编辑后保持源码可靠。
- 实际：图片变成占满正文的 HTML 输入框，下面出现“完成”；正文重新排版。
- 截图：[源码框](images/image-ux-audit/09-main-html-source.png)。
- Typora：同一元素正常显示，见 [基线](images/image-ux-audit/01-typora-layout.png)；属性编辑往返 **Not Tested**。
- 疑似位置：`imageHtml.ts` 不接受 HTML 数字 width 或无额外属性图片；`MarkdownParser` HTML 分支；`HtmlBlockView`。
- 场景：粘贴常见 HTML、其他编辑器生成的图片、缩放后重新打开。
- 方向：仅将安全白名单单一 img 解析为图片；保留原 HTML source，未改动字节不变；其他 HTML 继续受保护。

### IMG-05 / P2：常驻预览按钮打断图文排版

- 步骤：打开连续两图、行内图和列表图。
- 预期：图片自然参与排版，预览从双击或选中操作进入。
- 实际：每张图下都有“放大预览”，独立占一行；24×24 小图下按钮比图片更宽。
- 截图：[布局](images/image-ux-audit/04-main-layout.png)、[缩小及连续图](images/image-ux-audit/06-main-25-percent.png)。
- Typora：同文档没有此常驻按钮，见 [基线](images/image-ux-audit/01-typora-layout.png)。
- 疑似位置：`LiveImageView.previewButton`；`MarkdownTheme.css .md-image-open`。
- 场景：行内、表格、列表、大量图片。
- 方向：预览保留双击及选中工具栏入口，取消常驻排版占位。

### IMG-06 / P1：Escape 和预览后的焦点恢复不稳定

- 步骤：选中图 → 双击预览 → Escape → 再 Escape；打开空路径属性后 Escape。
- 预期：退出预览恢复编辑焦点；第二次 Escape 取消选择；属性 Escape 关闭。
- 实际：第一次 Escape 关闭预览并保留原图位置；第二次 Escape 工具栏还在；属性输入框 Escape 不关闭。
- 截图：[预览](images/image-ux-audit/07-main-preview.png)、[属性](images/image-ux-audit/10-main-empty-properties.png)。
- Typora：本项 **Not Tested**。
- 疑似位置：`ImagePreview.onclose` 恢复 activeElement；控制器 keymap 与属性输入事件；NodeView.stopEvent。
- 场景：键盘编辑、反复预览、取消操作。
- 方向：显式恢复 editor 焦点/选区；属性 Escape 处理；工具栏 mousedown 防止抢焦点。

### IMG-07 / P1：工具栏插入产生默认失效图并要求编辑源码

- 步骤：空 insert.md → 点击工具栏“插入图片” → Ctrl+Z。
- 预期：明确的路径/文件选择，插入后容易继续写作；一次撤销。
- 实际：直接插入 `![图片描述](image.png)`，显示“空图片路径”，光标在源码末尾；Ctrl+Z 一次恢复空文档（此点通过）。
- 截图：[插入后](images/image-ux-audit/14-main-insert.png)。
- Typora：本项插入流程 **Not Tested**；空路径有可见文件夹入口。
- 疑似位置：`MarkdownEditorController.format('image')`、`queueInlineEdit`。
- 场景：新用户、空文档、工具栏插图。
- 方向：创建空图片并直接打开属性；支持本地选择、保留单次撤销和光标继续输入。

## 真实操作矩阵（初稿时）

| 范围 | 已真实操作/观察 | 尚未执行（Not Tested） |
| --- | --- | --- |
| A2 素材 | PNG/JPEG/GIF/WebP、24×24、320×180、6000×4000、600×6000、中文空格、缺失/空/损坏路径；标题、表格、列表、引用、行内、连续和重复引用均在文档内 | 网络成功加载（测试 URL 故意无资源）；跨目录授权恢复 |
| A3 插入 | 空 Markdown 工具栏插图、一次撤销 | Explorer 拖入、位图剪贴板粘贴、多图插入、手工语法及 HTML 输入、段首/中/尾、表格/列表/标题附近逐项插入 |
| A4 选择 | 单击/双击/右键、点击外部、切换图片、Escape、滚动 | Delete/Backspace、前后 Enter、前后拖选、方向键跨图、复制剪切粘贴、按钮按住拖动、快速循环 |
| A5 排版 | 25%、小图、连续图、行内图、长图、失败图、Live↔Split、尺寸转为受控 HTML | 原图/50/75/100%、全部对齐、撤销重做、Source 单独模式、实际双 Pane、拖窄 Pane、全屏 |
| A6 预览 | 双击打开、Escape 退出、返回原滚动位置 | Fit/原尺寸/放大缩小、长图平移、遮罩、开着调整窗口、循环、保存内容前后比对 |
| B1–B5 | 工具栏越界/消失、对象错误描述、空路径右键、长图、HTML 源码框均独立复现 | 五张原图逐一对照（附件缺失） |
| Typora | 同文档显示、单击路径编辑、右键菜单；PNG/HTML/混排/小图/空路径对照截图 | 完整 A3–A6 对照 |
| 数据安全/性能 | 基线插入单次撤销 | 文件关闭重开、外部变化、标签/Pane 切换、IME、长期内存与大量图片 |

## 修复前结论

插入及属性入口不够直接；单击选择基本有效但工具栏位置不可靠。缩放后源文件确实产生受控 HTML，Split 能显示，但常见 HTML 未统一处理。预览可以打开/退出，不能据此证明所有预览状态安全。无效图恢复困难。源码保真、窄分栏、完整 Typora 对照和内存稳定性仍需专项回归及真实复验，不能宣称体验已完善。

## 后续验证记录

修复、自动浏览器回归、单元测试与最终真实桌面复验分别追加，不覆盖本节原始事实。未完成的项目继续保留 Not Tested。
