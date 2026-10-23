# Typora 1.12.4 图片交互实机研究

研究日期：2026-10-23。研究对象为本机 `D:/Program Files/Typora/Typora.exe`，关于窗口见 [086](images/typora-image-study/086-about.png)。本文只把实际操作和截图支持的行为写为已验证；未操作的组合逐项标为 **NOT TESTED**，不从其他图片类型外推。

## 环境、隔离与证据

- Windows 11 家庭版中文版，系统版本 10.0.26200；用户 AppliedDPI=96（100%）。没有更改系统缩放。
- Typora 1.12.4 Windows x64；Github 主题，见 [001](images/typora-image-study/001-theme.png)。初始最大化窗口 2560×1392，后续恢复为 786×693。视图菜单的“实际大小”有勾选。
- 只在 `%TEMP%/markumo-typora-image-study/` 中编辑任务生成的文档、图片；没有用用户文档做实验。侧边栏曾临时隐藏，研究结束时恢复。主题、图片保存策略、上传服务及安全选项没有更改。
- 当前图片偏好见 [002](images/typora-image-study/002-image-preferences.png)：复制到 `./${filename}.assets`；对本地和网络图片应用规则、允许 YAML 自动上传、优先相对路径均已勾选；为相对路径加 `./`、自动转义 URL 未勾选；上传服务为“无”。这些只是当前配置的观察，不是产品默认值。
- GUI 通过 computer-use 的 `@oai/sky` 实际点击、双击、右键、拖动、输入和滚动，未使用网页模拟替代 Typora。版本元数据、文件属性、文件存在性与生成素材通过本地文件工具检查。
- [observations.json](images/typora-image-study/observations.json) 保存逐步操作说明与当时的辅助功能树。相邻两次采样可能分别包含过渡帧与稳定帧，以明确标注的稳定帧为准；不能仅凭输入调用成功判断结果。
- 网络用 `127.0.0.1:1467` 的独立 HTTP 图片服务和 `127.0.0.1:9` 的不可达地址；正常网络测试没有依赖外网或修改网络权限。
- 最初版本的 Markumo 图片实现已经由其他工作写入仓库；本研究开始后、研究提交前，没有继续修改其图片实现。

## 可执行状态与转换

这里的状态是根据观察提炼的描述，不声称是 Typora 内部类名。图片载入状态与编辑状态相互独立。

| 起点 | 真实操作 | 观察结果 | 证据 |
| --- | --- | --- | --- |
| 正常显示 | 单击图片中部 | 图片保留；出现完整图片语法；普通 Markdown 图片的 alt 被选中 | [004](images/typora-image-study/004-normal-click.png) |
| 源码展开 | 在图片中部双击 | 选中完整图片语法；未打开全屏预览 | [005](images/typora-image-study/005-normal-double-click.png)、[042](images/typora-image-study/042-html-double-click.png) |
| 源码展开 | 单独按 Escape | 本次普通图片源码仍显示，没有撤销已发生的文档修改 | [012](images/typora-image-study/012-source-escape.png) |
| 源码展开 | 点击旁边普通正文 | 稳定后源码收起，光标转入正文 | [014](images/typora-image-study/014-text-settled.png) |
| 一张图片编辑中 | 单击另一张图片 | 先前图片源码收起，新图片源码展开；图片仍在原段落 | [033](images/typora-image-study/033-inline-click.png)、[041](images/typora-image-study/041-html-click.png) |
| 图片选中 | 右键 | 出现图片相关菜单；完整语法选中 | [006](images/typora-image-study/006-normal-context.png) |
| 图片选中 | Shift+F10 | 在源码附近打开上下文菜单 | [029](images/typora-image-study/029-shift-f10.png) |
| 上下文菜单打开 | Down | 首个可用菜单项高亮 | [030](images/typora-image-study/030-context-arrow.png) |
| 上下文菜单打开 | Escape | 此次菜单关闭，图片源码仍展开 | [031](images/typora-image-study/031-context-escape.png) |
| 菜单及子菜单打开 | 点击菜单外 | 菜单关闭 | [046](images/typora-image-study/046-context-outside.png) |
| 菜单打开 | 滚动正文 | 存在不同结果：部分菜单关闭，网络图片菜单及源码悬停菜单曾留在原处；不归纳为统一规则 | [040](images/typora-image-study/040-context-scroll.png)、[082](images/typora-image-study/082-jpeg-webp.png) |
| 源码展开 | 滚动到图片离屏 | 源码随文档离屏；未见固定的整排图片工具栏 | [032](images/typora-image-study/032-scroll.png) |
| 图片源码展开 | 切换到资源管理器再返回 | 文档和图片保留，源码仍展开 | [093](images/typora-image-study/093-open-location.png)、[094](images/typora-image-study/094-regained-focus.png) |
| 空路径 | 点击文件夹、选择临时 PNG | 进入原生选择器；图片恢复；根据现有偏好复制资源，目录不存在时询问创建 | [047](images/typora-image-study/047-empty-file-dialog.png)–[050](images/typora-image-study/050-assets-result.png) |
| 失效路径 | 双击路径、输入一半 | 完整语法仍可编辑；路径不完整时没有预览或大块错误卡片 | [060](images/typora-image-study/060-missing-path-selection.png)、[061](images/typora-image-study/061-path-partial.png) |
| 失效路径编辑中 | 补全为有效路径 | 无需点击离开即可恢复图片 | [062](images/typora-image-study/062-path-recovered.png) |
| 路径内部插入点 | Enter | 插入换行，图片语法被拆开，图片暂时消失；不能把 Enter 概括为“提交编辑” | [063](images/typora-image-study/063-path-enter.png) |
| 路径被换行拆开 | Ctrl+Z | 原语法和图片恢复 | [064](images/typora-image-study/064-path-enter-undo.png) |
| 图片语法选中 | Tab | 实测产生文档缩进字符并收起源码；不是单纯循环表单字段 | [018](images/typora-image-study/018-source-tab.png)、[019](images/typora-image-study/019-tab-undo.png) |

菜单悬停的精确触发延迟、离开延迟，以及所有图片类型的键盘聚焦顺序为 **NOT TESTED**。现有桌面 API 没有独立 hover API；截图中自然出现的源码路径悬停菜单不能替代完整悬停实验。

## 源码与排版：不能把“不跳动”冒充 Typora 行为

独立图片的完整 Markdown 源码出现在图片上方、原段落的行内内容位置；图片继续显示。首张图片在未选中与选中截图中的顶部位置不同，后续标题也发生位移，见 [003](images/typora-image-study/003-baseline.png) 与 [004](images/typora-image-study/004-normal-click.png)。**Typora 展开源码确实会参与排版。**

行内图片展开后，源码位于原文字与图片之间，图片仍属于同一个段落，但文字可能换行、图片位置会变化，见 [032](images/typora-image-study/032-scroll.png) 与 [033](images/typora-image-study/033-inline-click.png)。不能把“没有拆成两个段落”写成“布局没有变化”。

HTML 图片展开的是完整 `<img ... />`，包含 width、alt、title；不是伪装成 Markdown 的两个表单字段，见 [041](images/typora-image-study/041-html-click.png)–[043](images/typora-image-study/043-html-width-edit.png)。引用图片则保留 `![引用图片][logo]`，没有自动内联定义路径，见 [072](images/typora-image-study/072-reference-click.png)。

用户明确要求 Markumo 的源码和宽度控件不挤压正文。因此 Markumo 应采用不参与排版的编辑控件，并在验收报告中列为有意差异，不能同时宣称逐像素 1:1。

## 缩放规则

真实菜单只有 **25%、33%、50%、67%、80%、100%、150%、200%**，见 [007](images/typora-image-study/007-scale-submenu.png)。没有观察到 75%、自定义百分比输入框、像素输入框或右侧悬浮百分比控件；后两项可以通过编辑 HTML 属性实现，但不能伪称是菜单已有功能。

| 选择 | 320×180 图片的显示宽高（截图核对） | 源码结果 | 证据 |
| --- | --- | --- | --- |
| 默认 | 320×180 | 保留 Markdown | [003](images/typora-image-study/003-baseline.png) |
| 25% | 80×45 | 转为 `<img ... style="zoom:25%;" />` | [020](images/typora-image-study/020-scale-25.png) |
| 33% | 约 106×59（亚像素取整） | `zoom: 33%` | [023](images/typora-image-study/023-scale-33.png) |
| 50% | 160×90 | `zoom:50%` | [008](images/typora-image-study/008-scale-50.png) |
| 67% | 约 214×121（亚像素取整） | `zoom:67%` | [024](images/typora-image-study/024-scale-67.png) |
| 80% | 256×144 | `zoom:80%` | [025](images/typora-image-study/025-scale-80.png) |
| 100% | 320×180 | 移除 zoom；仍保留 HTML，不自动转回 Markdown | [026](images/typora-image-study/026-scale-100.png) |
| 150% | 480×270 | `zoom:150%` | [027](images/typora-image-study/027-scale-150.png) |
| 200% | 640×360 | `zoom: 200%` | [028](images/typora-image-study/028-scale-200.png) |

50% 缩放后 Ctrl+Z 恢复 Markdown 和自然尺寸，见 [009](images/typora-image-study/009-scale-undo.png)。从截图与生成素材自然尺寸可以确认比例基于原图尺寸，而非正文宽度。4000×2400 大图在默认与 50% 时都仍受正文宽度限制，见 [074](images/typora-image-study/074-large-baseline.png)、[076](images/typora-image-study/076-large-50.png)；因此不能仅凭大图默认显示宽度推导缩放基准。

显式 HTML width=160 和 width=80 已通过真实源码输入验证，见 [041](images/typora-image-study/041-html-click.png)、[043](images/typora-image-study/043-html-width-edit.png)。缩放后的重新关闭并打开文件、HTML 自定义 zoom 百分比，以及所有极端尺寸组合尚为 **NOT TESTED**。

## 插入、删除和历史

- 原生文件粘贴：从临时资源管理器选中文件 Ctrl+C，在 Typora 的 BEFORE/AFTER 中间 Ctrl+V，插入同段落图片，见 [095](images/typora-image-study/095-explorer-file-paste.png)。操作的是文件剪贴板，不用纯文本模拟文件粘贴。
- 位图粘贴：执行“拷贝图片”，在空段落 Ctrl+V，生成 `network.assets/image-20261023140832367.png`，见 [096](images/typora-image-study/096-copy-bitmap.png)、[097](images/typora-image-study/097-bitmap-paste.png)。文件系统验证新文件实际存在。
- Ctrl+Shift+I：生成空图片语法，初始光标在 alt，见 [098](images/typora-image-study/098-insert-shortcut.png)–[100](images/typora-image-study/100-insert-caret-result.png)。点击路径占位再输入相对路径才完成图片，见 [101](images/typora-image-study/101-insert-src.png)。同名图片已有时实际生成了另一个名称，没有覆盖测试中已存在的文件。
- 单击／选择 alt 后 Delete 只删除 alt，见 [051](images/typora-image-study/051-selected-delete.png)。双击选中完整语法后 Backspace 删除整图，随后不点击别处即可输入中文，见 [052](images/typora-image-study/052-image-whole-selection.png)–[054](images/typora-image-study/054-type-after-delete.png)。这不是中文 IME 组合输入实验。
- 输入与删除分别可撤销，图片删除可重做，见 [055](images/typora-image-study/055-delete-undo.png)–[057](images/typora-image-study/057-image-redo.png)。全部相邻空行、代码块与标题之间、连续图片删除、表格内删除组合尚未全部实机覆盖。
- 真实拖动可选择文字与图片混合内容，见 [102](images/typora-image-study/102-mixed-selection.png)；随后右键图片使选区改为图片源码，见 [103](images/typora-image-study/103-mixed-selection-context.png)。不能宣称原混合选区被保留。
- 本机移动／删除文件的确认、取消、撤销边界详见 [上下文菜单研究](typora-image-context-menu.md)。

## 格式与错误状态

| 场景 | 实测结果 | 证据 | 范围限制 |
| --- | --- | --- | --- |
| PNG、中文空格路径 | 正常显示；中文路径没有对象字符串错误 | [058](images/typora-image-study/058-invalid-baseline.png) | 括号、百分号编码和所有转义组合 NOT TESTED |
| 空路径 | 完整语法、路径占位、文件夹按钮；可恢复 | [044](images/typora-image-study/044-empty-context.png)、[050](images/typora-image-study/050-assets-result.png) | 空 alt 和非空 alt 均显示占位 |
| 不存在路径 | 紧凑完整语法和错误图标；可原位修复 | [059](images/typora-image-study/059-missing-context.png)–[064](images/typora-image-study/064-path-enter-undo.png) | 无大块错误区域 |
| 文件内容损坏 | 源码占位，无正常预览 | [080](images/typora-image-study/080-wide-transparent.png) | 损坏图的完整操作矩阵 NOT TESTED |
| SVG | 临时橙色矩形 SVG 正常显示 | [080](images/typora-image-study/080-wide-transparent.png) | 主动内容与外部 SVG 资源 NOT TESTED |
| GIF | 捕获橙色与蓝色两帧，动画真实运行 | [082](images/typora-image-study/082-jpeg-webp.png)、[085](images/typora-image-study/085-wide-transparent.png) | 不能仅凭一帧断言动画通过 |
| JPEG、WebP | 正常显示 | [082](images/typora-image-study/082-jpeg-webp.png)、[083](images/typora-image-study/083-gif-frame.png) | 各自全部编辑状态 NOT TESTED |
| 透明 PNG | 背景透出，没有不透明黑底 | [085](images/typora-image-study/085-wide-transparent.png) | 仅生成的半透明椭圆 |
| 长图、宽图 | 长图保持窄宽并纵向滚动；宽图限制在正文范围 | [077](images/typora-image-study/077-tall-baseline.png)–[078](images/typora-image-study/078-tall-click.png)、[085](images/typora-image-study/085-wide-transparent.png) | 最大资源预算 NOT TESTED |
| HTTP 可达／不可达 | 可达图正常；不可达图显示源码占位，菜单不同 | [081](images/typora-image-study/081-network-context.png)、[088](images/typora-image-study/088-network-loaded.png) | 真正超时、网络策略拒绝尚 NOT TESTED |
| 外部替换、删除资源 | 已载入视图曾继续显示缓存；源码保留 | [114](images/typora-image-study/114-external-replace.png)–[118](images/typora-image-study/118-external-delete-reload.png) | 不能据此声称自动刷新成功；关闭重开仍待验证 |
| Windows 只读文件属性 | 图片和菜单可见，仍展示编辑操作 | [119](images/typora-image-study/119-readonly-baseline.png)、[120](images/typora-image-study/120-readonly-context.png) | 未证明是 Typora 应用级只读模式；保存行为 NOT TESTED |

## 全场景覆盖边界

每个图片类型的 17 状态交叉组合保存在 [coverage.csv](images/typora-image-study/coverage.csv)。只有存在对应直接证据的格子列为已观察，其余均为 NOT TESTED。Markdown 图片、HTML 图片、引用图片不能互相代替；“看到了菜单”与“执行了菜单项”也不能互相代替。

以下仍需实机补充：严格的键盘聚焦遍历、所有子菜单的键盘展开和 Enter 选择、每种图片 17 状态的完整交叉组合、文件无读取权限、网络策略阻止／真实超时、加载中关闭窗口、超预算图片、跨资源管理器拖入、多图批量插入、表格和列表中的完整插入／删除、长期监听器／内存观察，以及持久化关闭重开。现有 API 不提供独立 hover；跨窗口拖放也受目标窗口边界约束。其他未测项目不能用 API 限制笼统解释。

本文不宣称 Typora 深度矩阵已经全部完成，也不构成 Markumo 1:1 验收通过报告。
