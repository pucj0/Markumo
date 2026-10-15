# Markdown 功能差距矩阵 — 阶段 A（2026-10-15）

审查基线：`1d0a7f3 feat(workspace): 重构主菜单、工作区树与只读 ClassFile 支持` 加开始时已存在的未知后缀/可编辑字节改动。保留所有未提交内容，不提交、推送、发布或进入阶段 B。本次是既有 Phase 5/6 的专项阶段 A，不重新定义 PRD 的 Phase 顺序。

依据为当前真实源码与本轮运行结果；历史报告仅用于定位已有实现。开始前实际 `pnpm test` 为157/157。现有 `tableModel/tableWidget/tableField` 已具备 GFM 单元格源码定位、行列事务与组合输入映射，直接复用，没有重写表格编辑器。

官方对照：2026-10-15读取 [Markdown Reference](https://support.typora.io/Markdown-Reference/)、[Table Editing](https://support.typora.io/Table-Editing/)、[Images](https://support.typora.io/Images/)、[Code Fences](https://support.typora.io/Code-Fences/)、[Auto Pair](https://support.typora.io/Auto-Pair/)。这里只比较公开功能及交互，不假定内部实现。

## 状态含义

- SUPPORTED：本行描述的基本能力存在且本轮有实际测试证据；不等于完整复刻 Typora。
- PARTIAL：基础能力存在，但本行说明的范围或高级交互不足。
- MISSING：没有对应语义/渲染/编辑实现。能输入原始字符不算该能力已支持。
- UNVERIFIED：无法通过本轮环境和真实输入方式验收，不能用历史报告或模拟事件替代。

Source 列评价源码编辑及专属辅助，Split 列评价右侧只读渲染（正式编辑仍在左侧 CM）。只读 Split 中没有交互编辑按钮并不等于正文不能编辑。

## 开始时源码审查矩阵

| 能力 | Live | Source | Split | 源码结论 |
| --- | --- | --- | --- | --- |
| H1–H6/Setext | SUPPORTED | SUPPORTED | SUPPORTED | Live heading装饰，Source Lezer高亮，Split标准标题 |
| 段落 | PARTIAL | SUPPORTED | PARTIAL | 视觉段距已有；没有Typora通用Enter段落/Shift+Enter输入策略 |
| 软/硬换行 | SUPPORTED | SUPPORTED | SUPPORTED | 物理LF可见；Split breaks开启，但智能标点原配置与Live不同 |
| 嵌套引用 | PARTIAL | PARTIAL | SUPPORTED | 已有CM续写/删除；缺少直接空引用逐级退出验证 |
| 无序/有序嵌套列表 | PARTIAL | PARTIAL | SUPPORTED | CM默认Enter续写存在；Tab没有列表专属条件；空项默认可能先变松散列表 |
| 任务列表 | PARTIAL | PARTIAL | MISSING | Live真实复选框事务已有；Split没有任务语义扩展 |
| 强调/删除线/行内代码 | SUPPORTED | SUPPORTED | SUPPORTED | Live按选区显隐，GFM parser和Split标准渲染 |
| 围栏代码 | PARTIAL | PARTIAL | PARTIAL | 已有源码背景及7种懒加载围栏语言；无复制动作，Split无语言高亮 |
| GFM表格 | PARTIAL | PARTIAL | SUPPORTED | Live已有真实Widget和源码行列事务，复杂嵌套降级；缺少Typora完整单元格导航/对齐工具 |
| 图片 | MISSING | PARTIAL | MISSING | Source可编写路径；Live跳过Image，Split显式只显示图片源码 |
| HTTP(S)行内链接 | SUPPORTED | SUPPORTED | SUPPORTED | 安全协议检查，Ctrl/Command+点击打开 |
| 裸URL/引用式/文内锚点/相对文档链接 | PARTIAL | PARTIAL | PARTIAL | Live裸URL未装饰；引用/本地跳转不完整，Split渲染能力较多但打开动作受限 |
| 行内/块公式 | MISSING | MISSING | MISSING | 无数学语义或渲染器；仅源字符 |
| 脚注 | MISSING | MISSING | MISSING | 无脚注扩展、编号、回链 |
| 自动TOC | MISSING | MISSING | MISSING | 现有侧栏大纲不等于文内 `[toc]` |
| YAML Front Matter语义 | MISSING | MISSING | MISSING | 无front-matter扩展/元数据服务；按普通Markdown解析，不声明为YAML块支持 |
| Mermaid图 | MISSING | MISSING | MISSING | 仅未知语言围栏代码，不执行Mermaid |
| GFM Alert/Callout | MISSING | MISSING | MISSING | 仅普通引用，不具备警告级别语义 |
| Markdown自动配对 | PARTIAL | PARTIAL | PARTIAL | CM通用括号配对存在，无Typora完整强调/引号/配对策略面板；Split编辑侧同Source |
| 真实系统中文IME | UNVERIFIED | UNVERIFIED | UNVERIFIED | 合成composition不等于Windows候选框与真实输入验收 |

## 阶段 A 后矩阵

| 能力 | Live | Source | Split | 本轮证据或仍有差距 |
| --- | --- | --- | --- | --- |
| H1–H6/强调/删除线/行内代码 | SUPPORTED | SUPPORTED | SUPPORTED | 新fixture+现有Live单元、真实复杂选区、模式切换及40次点击回归 |
| 段落智能输入 | PARTIAL | SUPPORTED | PARTIAL | 保留现有源文本及视觉段距；不擅自把单个Enter改写为额外空行 |
| 软/硬换行与字面标点 | SUPPORTED | SUPPORTED | SUPPORTED | 共享semantics，Split关闭自动标点变换；LF/显式硬换行一致性测试 |
| 引用续写/空引用逐级退出 | SUPPORTED | SUPPORTED | SUPPORTED | Lezer上下文+CM事务；空引用退出一级，围栏内不误操作；Split左侧同Source |
| 列表/任务Enter、空项退出、Tab层级 | SUPPORTED | SUPPORTED | SUPPORTED | 配置CM续写、专属Tab/Shift+Tab；有序递增、完成任务转未完成、多光标、嵌套与撤销测试 |
| 任务复选框语义 | SUPPORTED | SUPPORTED | SUPPORTED | Live保留原复选框事务；Split补上对应的禁用只读复选框 |
| 围栏语言、高亮、背景、原位编辑 | SUPPORTED | SUPPORTED | SUPPORTED | Live同一个CM的语法高亮；Split安全高亮，左侧直接编辑；复用现有语言包，未知语言保持源码 |
| 围栏复制工具 | SUPPORTED | PARTIAL | SUPPORTED | Live/Split有复制代码按钮；Source仍通过选择文本与标准复制操作 |
| 高级代码块交互 | PARTIAL | PARTIAL | PARTIAL | 不提供Typora全量默认语言设置、逐块换行开关、代码格式化；遵循编辑器自动换行或水平滚动。嵌套容器中的围栏保留源码高亮，不提供专属复制工具条 |
| GFM基本表格与对齐显示 | SUPPORTED | SUPPORTED | SUPPORTED | 复用原Widget、源码编辑和安全Split；现有表格18组UI及原生回归 |
| Typora高级表格工作流 | PARTIAL | PARTIAL | PARTIAL | 没有完整单元格Tab导航、拖拽列等价体验；不重复实现或冒称完全支持 |
| 授权相对路径/失败占位/网络受控图片 | SUPPORTED | SUPPORTED | SUPPORTED | Live直接StateField图片块、Split共用安全DOM；可见原路径、实际点击源码位置、失败可重试。Source保留原始语法 |
| 高级图片/引用图片/表格内图片 | PARTIAL | PARTIAL | PARTIAL | 阶段A仅单行行内链接形式图片。参考式、跨行、表格单元格中的图片保留源码；没有拖放/剪贴板落盘、移动/上传、SVG、typora-root-url |
| HTTP(S)行内/裸URL/尖括号链接 | SUPPORTED | SUPPORTED | SUPPORTED | 共用GFM配置、Live安全标记，测试三种URL语义一致 |
| 引用链接/内部锚点/相对文档跳转 | PARTIAL | PARTIAL | PARTIAL | Source可输入但缺少完整导航；不把渲染出来的链接等同于可打开任意文件 |
| 公式 | MISSING | MISSING | MISSING | 未纳入本阶段实现 |
| 脚注 | MISSING | MISSING | MISSING | 未纳入本阶段实现 |
| 自动TOC | MISSING | MISSING | MISSING | 未纳入本阶段实现 |
| YAML Front Matter语义 | MISSING | MISSING | MISSING | 仍为普通Markdown，不宣称专属元数据编辑；阶段B应先增加安全源码块边界 |
| Mermaid | MISSING | MISSING | MISSING | 围栏源码安全保留 |
| GFM Alert | MISSING | MISSING | MISSING | 仍为普通引用 |
| Typora完整Auto Pair | PARTIAL | PARTIAL | PARTIAL | 复用CM通用配对，没有新增未经验证的复杂强调配对规则 |
| 真正系统中文IME | UNVERIFIED | UNVERIFIED | UNVERIFIED | 必须人工使用真实系统输入法确认，本轮合成测试仅验证组合状态下模式切换保护 |

## 架构和安全决策

1. Markdown源码、CM EditorState/Transaction继续是唯一正式编辑数据。图片加载与复制仅由显示/明确用户操作触发，逐键输入不跨IPC。
2. 块图片由直接StateField提供，选择进入时恢复源码。复用现有表格composition映射；不通过外层绝对定位或嵌套编辑器伪造正文。图片加载后requestMeasure，禁止竖向margin破坏CM测量。
3. 图片相对当前文档解析。Rust使用真实文档token及后端当前工作区根检查路径；独立图片文件授权也可匹配。仅选择一个Markdown文件不会授权其整个父目录：需要加入工作区或单独授权图片。拒绝任意file/data/绝对路径、路径越界、符号链接/联接、非普通文件；读取后复查路径。继续保留既有I/O与文件上限。
4. 本地仅PNG/JPEG/GIF/WebP，4MiB/16MP/单边16384以内；SVG与损坏内容显示原路径。Rust头部边界检查后仍由WebView图像解码器决定是否有效。内存总预算32MiB保留字节、32MP已加载像素；切模式和销毁释放BlobURL、计时器与迟到响应。Live/图片块文档上限1MiB、64个可渲染图片。
5. 网络默认不创建img/src；仅用户点“加载网络图片”后，按文档会话记录该URL许可。仅HTTPS、无URL凭据、匿名跨域、no-referrer；不放开connect-src、不用file协议、不自动上传。服务器无CORS时明确失败。CSP只为img-src增加blob/https。远程响应的下载大小不能在img解码前精确限制，仍受CSP、超时和解码后尺寸/总像素预算保护。
6. Split的v-html来源仅限html:false的markdown-it安全输出：图片仅生成经过转义的占位属性，再由DOM创建img；不接受任意用户HTML。任务标记为固定生成，代码高亮使用Lezer受控class和HTML转义。
7. `semantics.ts`共享GFM与换行/链接/字面标点策略。分栏侧的图片位置来自Lezer精确范围，预览尚未追上源码时拒绝用旧位置跳转。另存为、重命名或移动文档时，通过资源刷新effect和token/路径身份失效旧图片缓存；Split重用占位DOM时先清理旧控件，防止显示旧目录内容或重复路径按钮。
8. 代码块继续使用当前CM语法树的嵌入语言；使用已有依赖按需加载，没有第二个编辑器。复制从当前语法树读取纯代码。Source保持原始编辑，Split高亮为只读DOM。

## 修改文件（仅本阶段增量）

| 路径 | 作用 |
| --- | --- |
| `src/editor/markdown/semantics.ts` | 共享GFM/渲染策略 |
| `src/editor/markdown/images.ts` | 资源Facet、URL分类、安全DOM、受控网络、预算与资源释放 |
| `src/editor/markdown/imageField.ts` | 可测量图片块、精确源码定位、组合输入映射 |
| `src/editor/markdown/smartEditing.ts` | 列表/任务/引用续写与退出、条件Tab/Shift+Tab |
| `src/editor/markdown/codeFence.ts` | 围栏范围模型、纯代码复制、可访问工具条 |
| `src/editor/markdown/rendering.ts` | 安全Split语义、图片源码映射、任务、Lezer高亮与复制按钮 |
| `src/editor/markdown/livePreview.ts` | 复用现有行内装饰，接入图片/围栏/自动链接 |
| `src/editor/markdown/tableField.ts` | 导出已有组合状态effect供图片复用，不改写表格能力 |
| `src/editor/markdown/splitPreview.vue` | 共用renderer/资源，图片DOM生命周期和精确点击导航 |
| `src/editor/markdown/styles.css` | 图片、代码工具、预览语法色与可测量间距 |
| `src/editor/core/DocumentManager.ts` | 每文档资源上下文，兼容本轮开始前Hex修改 |
| `src/editor/languages/index.ts` | Markdown专属keymap及复用全体现有语言围栏包 |
| `src/components/layout/EditorPane.vue` | 给Split传文档资源并校验源码快照后定位 |
| `src-tauri/src/files/images.rs` | 授权相对路径和有预算的栅格图片读取 |
| `src-tauri/src/files/mod.rs` | 注册图片模块，保留已有未知后缀改动 |
| `src-tauri/src/commands/files.rs` | 后端获取工作区授权根，二进制响应 |
| `src-tauri/src/lib.rs` | 注册图片命令 |
| `src-tauri/tauri.conf.json` | 受控图片所需blob/https CSP |
| `tests/fixtures/markdown-stage-a.md` | 中文/英文、基础和差距语法真实fixture |
| `tests/fixtures/assets/pixel.png` | 可实际解码的PNG fixture，浏览器和原生共用 |
| `tests/markdown-stage-a.test.ts` | 真实语法树/事务/语义/源码保留单元 |
| `tests/markdown-stage-a-ui.mjs` | 真DOM/键盘/图片/受控网络/点击/资源释放 |
| `tests/markdown-stage-a-native.mjs` | 原生授权、Blob解码、越界保护及BOM/CRLF磁盘验证 |
| `tests/markdown-live.test.ts` | 保留既有选区/代码字面测试，围栏新增显隐后收紧断言范围 |
| `src-tauri/src/files/tests.rs` | 图片权限、越界、格式、尺寸与头部边界回归，保留原有测试 |
| `docs/PHASE_PROGRESS.md`、本文 | 台账、差距与证据 |

## 验证结果

用户最后明确要求“不要回归了，你测试太久了”，已停止后续测试并清理本轮测试进程。下表保留已实际完成的结果；最后排队的重复typecheck被自动审批依据该指示拒绝（NOT RUN），没有重试。此后不再追加验证；真实IME等缺项继续保留，状态REVIEW。

| 实际执行命令 | 最终结果 |
| --- | --- |
| `pnpm typecheck` | 前次PASS（含Node配置与测试类型）；用户停止后的最后重复运行NOT RUN |
| `pnpm test` | PASS，13个文件、175/175；其中阶段A18项 |
| `pnpm build` | PASS，185 modules；仅既有Tauri静态/动态导入拆包提示，无新增依赖 |
| `cargo check --manifest-path src-tauri/Cargo.toml --offline` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline` | PASS，45/45，含3项新增图片安全/头部测试 |
| `node tests/markdown-stage-a-ui.mjs` | PASS，11组；受控图片加载/网络许可/代码复制/三模式/另存为与移动资源刷新/智能列表/选择/组合状态保护/24次长文真实点击/明暗窄窗/BlobURL全部释放 |
| `node tests/markdown-click-ui.mjs` | PASS，既有40次真实DOM点击、滚动、编辑及撤销，不以CM坐标同时构造点击和期望 |
| `node tests/ux-special-ui.mjs` | PASS，18组；既有表格Widget/行列事务、坐标、Split锚点、真实选择和布局回归 |
| `node tests/phase2-ui.mjs` | PASS，9组；所有已有语言切换、普通文本、标签/撤销/关闭与窄窗 |
| `node tests/editor-phase6.mjs` | PASS，8组；双Pane、独立光标/滚动、共享历史、查找替换及销毁 |
| `node tests/markdown-stage-a-native.mjs` | PASS，4组；真实Windows WebView2/Rust IPC/临时磁盘，授权与越界/SVG拒绝、实际Blob解码、源码点击/撤销/重做/BOM/CRLF保存、三模式/预览图片跳转 |
| `node tests/editor-native.mjs` | PASS，13组；原有自动保存冲突、关闭保护、设置重启、三模式30次、表格、40次点击、选区、双Pane与真实磁盘回归 |
| `git -c core.safecrlf=false diff --check` | PASS |
| 独立lint | NOT RUN，仓库未配置lint命令 |
| 真实系统中文IME候选/提交/选区替换 | NOT RUN；模拟composition只验证状态保护，绝不等同真实IME验收 |
| 系统剪贴板读写新专项 | NOT RUN；复制按钮通过真实UI和受控TextClipboard provider验证源码提取/调用，避免覆盖用户现有剪贴板 |
| 原生高DPI/真实触控板/macOS/Linux/长时RSS | NOT RUN；浏览器缩放或资源计数不等于这些验收 |

浏览器环境：独立 `localhost:1422`、Playwright + msedge。证据：`test-results/markdown-stage-a/`（最终真实明暗图片截图、results.json）、`test-results/markdown-clicks/`、`test-results/ux-special/`、`test-results/phase2/`、`test-results/phase6-review/`。原生专项目录 `test-results/markdown-stage-a-native/1792028585430/`；完整原生回归 `test-results/editor-native/1792028236828/`。新PNG fixture与此前原生测试常量为相同字节，现统一从fixture读取。

过程中发现并修复：极小图片被路径按钮覆盖；空任务项默认先转松散列表；补空引用逐级退出；修正维度保护及对应断言；修正代码围栏新显隐后原有测试的边界范围；文档另存为/移动时旧图片缓存需要失效。测试生成器字符串转义、当前活动图片造成的占位预期、组合事件对非空选择的正常替换行为，以及主题测试最初没有切换真实body.light，均已修正测试设置并完整复跑；路径刷新单元测试也等待真实异步语言加载完成后再检查装饰。没有通过删掉实际错误断言或把合成IME标为系统通过来完成验收。

两次原生启动安全前置检测发现用户窗口后退出，用户保存关闭确认后复跑通过；不关闭用户未知窗口。测试仅操作专用临时profile/工作区，未读写用户正文文件或系统剪贴板。当前为 REVIEW：实现与可执行检查完成，等待人工输入法/平台验收和用户评审；不生成安装包。

## 必要的人工验收

1. 打开本仓库为工作区，再打开 `tests/fixtures/markdown-stage-a.md`。Live应显示PNG；缺失图片保留路径和重试，远程图片默认关闭。单文件打开且未授权图片目录时应提示授权，而非读取任意父目录。
2. 点击图片，核对光标进入对应 `![...]` 源码；将路径改错再撤销/重做，在Source/Live/Split切换并保存，原始编码/BOM/换行不得发生隐式转换。
3. 逐项尝试列表、有序数字、任务的Enter续写，空项退出，Tab/Shift+Tab层级；空引用Enter退出一级，嵌套与多光标输入不应改动其他行。
4. 在Live和Split点击复制代码，用系统粘贴到临时草稿检查内容；检查未知语言保持源码、长行随编辑器换行设置换行或水平滚动、代码点击可直接编辑。
5. 使用真正Windows微软拼音等输入法，在标题/列表/引用及图片前后连续输入中文，进行候选选择、撤销重做、跨块选择与模式切换保护。此项本轮没有冒称通过。
6. 长文滚动后点击指定行，核对状态栏行号与实际改动行。再以实际Windows DPI、触控板和明暗主题查看图片/表格下方的光标与选区位置。

## 阶段 B 建议（未开始）

1. B1：统一参考链接/图片和锚点/相对文档导航，补YAML安全块与元数据解析，先明确路径授权。YAML目前会被普通Markdown当作分隔线/标题等解释，不应提前宣称安全元数据块已实现。
2. B2：高级表格键盘导航及图片选取/拖放/剪贴板落盘，事务、重命名和授权一起验收。
3. B3：脚注和文内TOC；再分别评估公式与Mermaid依赖体积、隔离渲染和超时，不合并为一个大功能。
4. B4：GFM Alert、可配置Auto Pair与段落输入策略，以及真实中文IME、Windows DPI/长时内存专项验收。

阶段 A 完成后停止，等待用户评审；上述建议不构成实施授权。
