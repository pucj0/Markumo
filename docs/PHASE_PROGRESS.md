# LightEdit 阶段进度与验收台账

### 2026-10-15 Markdown WYSIWYG 编辑内核专项（六内部阶段连续授权）
- **状态 REVIEW**。用户明确覆盖旧同区 CM Live/禁止 ProseMirror/逐阶段审批约束，保留其余安全和 Git 规则；已按六个内部阶段连续实现，不推进通用 Phase 7/8。开始/结束 HEAD `25d1a64`，原 Logo/菜单/视觉/打包改动保留，无提交、推送、安装或发布。
- 普通文本及 Markdown Source/Split 编辑侧保留 CM；Live 动态加载原生 ProseMirror，GFM 表格真实单元格模型，代码为嵌入 CM NodeView（从 1 行号/语言/复制/边界键）。每文档仍经 canonical CM 历史与原 FileController/Rust 保存；未修改块/普通表格单元格保留源码、过期补丁拒绝。YAML/复杂 HTML/未知扩展保护，公式/图表按需安全渲染，目录/脚注/Callout 基础适配。独立排版设置，移除标签图钉，固定右键保留。
- 最终前端 unit **258/258**、专属模型 **13**、typecheck/build、cargo check、Rust **84/84** PASS。浏览器 **9/9**（含 40 字形精确点击、30 次模式切换、真实表格/代码/链接/任务、跨 Pane/模式、HTML/剪贴板、合成组合保护、只读、扩展、主题与销毁），Windows Tauri/WebView2 **6/6** PASS（5 组真实磁盘/图片：BOM/CRLF no-op/编辑保存、跨模式历史/脏关闭、授权图片、外部冲突；1 组受控剪贴板 provider 验证代码块真实应用粘贴路由）。合成 composition 不代表系统 IME，受控 provider 不代表系统剪贴板验收。证据、环境中间失败与命令见 [验收报告](MARKDOWN_WYSIWYG_ACCEPTANCE.md)。
- 实测 112996 字节混合 Markdown 加载约 129.9 ms、事务中位 2.0/P95 4.8 ms；1000 行代码事务 5.4 ms；101 行表格 100 次连续事务中位 0.7/P95 1.5 ms。1200000 字符明确 Source 回退；60 次标签切换后 dispose PM/CM=0，GC 堆下降。普通 TXT 未加载 PM/数学/图表。数据是本机样本，不是跨平台承诺。
- 最终本地 NSIS 约 **5.26 MiB**（实际字节与体积增量见验收报告），新增依赖为必要 ProseMirror 官方模块及延迟 KaTeX/Mermaid/DOMPurify；markdown-it/KaTeX 已去重。安装/卸载、真实中文 IME、系统图片入口、高 DPI/触控板、跨平台、长时 RSS NOT RUN；无独立 lint。部分旧专项 E2E 的旧 Live DOM 驱动仍需后续迁移，未冒称旧历史 PASS 为当前证据。
- 完整设计/文件清单：[架构](MARKDOWN_WYSIWYG_ARCHITECTURE.md)、[源码保真](MARKDOWN_SOURCE_PRESERVATION.md)、[逐条验收与人工步骤](MARKDOWN_WYSIWYG_ACCEPTANCE.md)。Live 多光标、精确字符级模式映射、完整脚注编号/回链/Callout 富格式、单文件相对目标授权等仍有边界；没有将专项标记 DONE。

### 2026-10-15 移除编辑区装饰色条
- 现有 Phase 6 视觉修订：按用户截图移除 `src/components/layout/EditorPaneItem.vue` 活动分栏标签栏的顶部 accent 内阴影，以及 `src/components/layout/TabBar.vue` 固定标签的 accent 底边；当前标签继续以背景/中性边框识别，固定状态保留图钉。仅删除两条 CSS 规则，无新增依赖或编辑行为变更；本文件记录验证。
- PASS：`pnpm build`（含 vue-tsc 类型检查）；本地 Edge 真实生产组件浏览器验证 4/4（明暗主题 × 单/双分栏），确认标签栏无顶部阴影、固定标签无 2px 彩色底边、图钉及选中背景保留，console/page errors=0。证据 `test-results/editor-chrome/results.json` 和四张截图。
- REVIEW，人工复验：打开多个文件并固定标签，切换当前标签/分栏及明暗主题，确认两处色条消失。Windows Tauri/DPI、macOS/Linux、Rust check/tests、安装包重打 NOT RUN（本轮仅 CSS）；无独立 lint 配置，无新增单元测试。未满足完整 Phase 原生验收门槛，不推进下一 Phase；图片原生验收继续暂停。未提交、推送或发布。

### 2026-10-15 顶栏菜单点击展开与悬停切换
- 现有 Phase 6 菜单交互增量，按用户最新确认覆盖早期“关闭时悬停即展开”的行为：`src/components/layout/AppMenu.vue` 仅在已有菜单展开时响应悬停切换；初始、Esc 或点击外部关闭后，必须再次点击才能展开。保留展开态跨分类切换、键盘方向键/Enter 与多级菜单逻辑，无新增依赖或编辑器改动。
- `tests/menu-ui.mjs` 更新真实鼠标/键盘交互验收，并适配当前欢迎页的新建入口、已有“拆分分栏”层级及脏文档操作前后源码比较；本文件记录状态。未覆盖原有 Logo/构建等未提交修改。
- PASS：`pnpm typecheck`、`pnpm build`、菜单模型 Vitest 10/10；真实浏览器完整菜单 UI **8/8**，覆盖关闭态四分类悬停不展开、点击开启后的文件→编辑→视图→格式切换、Esc/点击外部后不误展开、键盘导航、子菜单、编辑事务和脏文档保护，console/page errors=0。证据 `test-results/main-menu/results.json` 及明暗/窄窗截图。首次完整回归发现两个旧脚本前提不符，修正测试选择器/基线后完整通过，未为此更改生产行为。
- REVIEW，待用户实际确认；人工复验：关闭态悬停→点击文件→移到编辑→Esc→再次悬停，并重复外部点击关闭。Windows 原生/DPI、macOS/Linux NOT RUN；Rust check/tests、安装包重打 NOT RUN（仅前端事件条件修改，无 Rust 变更），独立 lint 未配置。未提交、推送、发布或推进下一 Phase；图片原生验收保持暂停。

### 2026-10-15 简约 Logo 重绘
- 用户追加视觉修改：手工 SVG 几何 L + 插入光标，深墨色/暖白/低饱和绿，替换渐变纸笔图形。`public/logo.svg` 为母版，标题栏使用 SVG；同步 `public/logo.png`、32px favicon、Tauri PNG 和包含 16/24/32/48/64/256 的 Windows ICO。无新增依赖，不改编辑功能。
- PASS：Tauri CLI 实际图标派生、PNG/ICO 格式与尺寸/同源哈希检查、512px/32px目视、`pnpm typecheck`。发现 Cargo 曾复用旧 ICO 的 Windows resource，已在 `src-tauri/build.rs` 增加 ICO/PNG 监听；再次完整打包并读取 PE 资源，六种 EXE 内嵌图标与新 ICO 逐帧字节相同。最终安装包 3695344 字节（3.52 MiB）。保留 NSIS 宏修复，实际未安装、未运行应用或修改系统图标缓存。
- REVIEW，文件用途/人工验收见 [LOGO_REFRESH.md](LOGO_REFRESH.md)；系统桌面/DPI与跨平台运行 NOT RUN。未提交、推送或发布，未开始新 Phase，图片原生验收继续暂停。

### 2026-10-15 NSIS 重复宏打包修复
- 仅修复用户报错的打包单点，不推进完整 Phase 8：Tauri 先包含 `FileAssociation.nsh`，钩子的 `!ifdef/!undef` 只处理 define 符号，无法删除已有宏；两处改为 `!ifmacrodef/!macroundef`，保留原有安全关联逻辑，不改生成脚本或编辑器业务。
- PASS：关联/打包针对性 Vitest 14/14；`node scripts/package.mjs --skip-install` 全链路（Vue typecheck/build、Rust release、makensis）通过，产出 `src-tauri/target/release/bundle/nsis/LightEdit_0.1.0_x64-setup.exe`，3813757 字节（3.64 MiB）。变更文件：`src-tauri/windows/installerHooks.nsh` 宏替换、`docs/PACKAGING.md` 故障说明、本进度记录。
- REVIEW；未运行安装/卸载，未改系统关联，未提交/推送/发布。图片原生验收仍按用户要求暂停。

### 2026-10-15 Markdown 图片资源与文件图标专项
- 既有 Phase 5 图片增量及用户追加图标修订，不推进新 Phase。五种图片位置、默认 assets、文件名变量、路径选项、全局/文档覆盖、统一菜单/命令/粘贴/原生 Drop 导入，先保存 Markdown/取消不落盘，成功后 CM 事务插入。Rust 文档/窗口/原生来源授权，真实落盘、重名避让、目录句柄/Unix openat 防链接逃逸；保留远程默认关闭和现有图片预算。文档设置不写 YAML。
- 52 种 16px 本地 SVG，覆盖支持语言、常见资源与特殊文件；树/标签/搜索/快速打开共用，深浅主题适配，无前端新依赖。仅将 Cargo.lock 已有 rustix 声明为 Unix 直接依赖并补 Windows 剪贴板 feature/图片读取能力。
- 实测 PASS：当前工作树前端 245/245、Rust 83/83、cargo check、生产 src 的 TS/Vue 类型检查、图片相关 28 项、图标浏览器三组（52 字形/主题/三组件）。整仓 typecheck/build FAIL：并行新增 `tests/batch-syntax-and-encoding.test.ts:94` 两个未使用参数，保留另一专项修改。无独立 lint 配置。
- 用户明确选择“另一处仍在进行，暂缓原生验收”，已停止 Windows 图片端到端，不再启动测试窗口。此前原生尝试被实例标识冲突/进行中的布局白屏阻断，无图片交互通过记录。系统拖放/剪贴板/选择框、IME/DPI 与 macOS/Linux NOT RUN。状态 REVIEW；完整文件用途、证据与手工步骤见 [MARKDOWN_IMAGE_ASSETS.md](MARKDOWN_IMAGE_ASSETS.md)，图标截图 `test-results/file-icons/`。未提交、推送或发布。

### 2026-10-15 Windows BAT/CMD 中文编码识别及语法高亮专项
- 范围与目标：彻底解决包含中文的 BAT/CMD、TXT、INI、CFG 等文件（GB2312、GBK、CP936、GB18030、UTF-8、UTF-16）打开显示为 HEX 十六进制、无高亮的问题，使 LightEdit 具备类似 Notepad++ 的通用传统编码识别与高亮能力。
- 根因排查与修复：
  1. 编码检测原有问题：旧流程（BOM → UTF-8 → 失败即退回 HEX）对无 BOM 的 GBK/GB2312 批处理脚本一律判定 UTF-8 失败并回退为十六进制视图。已在 `src-tauri/src/files/codec.rs` 改造为严格四层检测：BOM 严格优先 → 严格 UTF-8 → 排除已知二进制魔数（ClassFile、PNG、ZIP、PDF、GZIP、EXE、ELF 等）与 NUL/控制字符 → 对文本扩展名尝试 `GB18030`（兼容 GB2312、GBK、CP936）与 `windows-1252` 解码。
  2. 编码边界与严格校验：要求解码后文本无非法控制字符，且必须通过**字节级 100% 无损往返校验**（`GB18030.encode(&text) == original_bytes`），并验证存在有效 CJK 字符/全角符号；非文本扩展名或随机二进制坚决不误判为中文，仍走 HEX 安全路径。
  3. 状态栏编码交互重构（`StatusBar.vue`）：编码展示区改造为交互式下拉菜单（`ContextMenu`），支持“以指定编码重新打开”、“转换为指定编码并保存”、“另存为指定编码…”，提供 UTF-8、GB18030、UTF-16LE、UTF-16BE、Windows-1252 及 HEX 字节模式。
  4. 重新打开与转换安全保护：区分“重新打开”与“转换编码”，重新打开不改变磁盘字节；当前文档有未保存修改时，触发 `DiscardDialog` 询问用户（可放弃重新打开或保存后重新打开），绝不静默丢失未保存内容。从 HEX 模式重新打开为 GB18030 时，自动恢复常规文本编辑与语法高亮。
  5. 保持原编码与换行符：无修改直接保存保证原文件字节 100% 一致；编辑中文后保存维持 GB18030 编码与 CRLF；转换编码到无法表示字符的编码时阻止有损保存，原文件与编辑内容均安全保留。
  6. Windows Batch 语言高亮：在 `src/editor/languages/batch.ts` 基于 CodeMirror 6 `StreamLanguage` 实现轻量高效的 Batch 词法解析器，支持 `@echo`、`echo`、`rem`、`::`、`set`、`setlocal`、`endlocal`、`call`、`if`、`else`、`for`、`goto`、`exit`、`powershell`、`%var%`、`!var!`、`%~dp0`、`%1`、`%%i` 等，纯文本装饰高亮，绝不执行脚本；将 `.bat` 与 `.cmd` 映射为 `Batch`。
- 实测结果：
  1. `pnpm typecheck`：PASS（0 错误）。
  2. `pnpm test`：PASS 全仓库 24 套件 **245/245** 测试全部通过（新增 `tests/batch-syntax-and-encoding.test.ts` 8 项全过）。
  3. `pnpm build`：PASS，Vite 生产构建成功，成功产出 `dist/assets/batch-*.js`。
  4. `cargo test --manifest-path src-tauri/Cargo.toml`：PASS **83/83** 全部通过（新增 GB2312/GBK/GB18030 批处理与文本无损往返、HEX 切回、二进制排除测试）。
  5. `cargo check`：PASS。
- 状态 REVIEW。未提交、推送或发布。详见 `BAT_ENCODING_AND_HIGHLIGHT_UPDATE.md`。

### 2026-10-15 保存机制与外部文件打开行为专项
- 范围仅四项：Windows 保存对话框文件类型、保存导致桌面图标移动、自动保存默认开启、重复双击创建多窗口。未改动 Markdown 与分栏业务。
- 根因（均经实测或代码路径确认）：
  1. `save_dialog` 只设置文件名，没有 `add_filter`；并确认 Tauri 的 `blocking_save_file()` **不返回所选过滤器**，因此默认类型必须在打开对话框前确定、扩展名在拿到用户输入后补全。
  2. 旧保存用同目录临时文件 + `ReplaceFileW`：实测**文件 ID 改变**（`1688849860475895` → `1407374883765253`），且每次保存都在目标目录创建/删除临时文件与临时目录 → 资源管理器把桌面文件当作新项目重排图标。
  3. `defaultSettings()` 与 Rust `EditorSettings::default()` 都是 `autoSave: true`，且前端 `autoSave = ref(true)`。
  4. `route_launch` 对任何非空文件参数都新建 `file-N` 窗口；另外前端监听的 `files-pending` 事件 Rust 从未 emit，导致“交给已有窗口”的链路此前不通。
- 修复：新增 `write_checked_preserving_identity`（Windows 已有文件原位写入：独占写句柄 + 同一句柄复核版本 + `%TEMP%` 已 fsync 回滚备份 + 失败回滚与备份路径上报），新文件仍原子创建，会话/首选项等内部数据继续 `write_checked` 原子替换；`save_dialog` 增加 18 组过滤器与默认类型排序、按文档扩展名补全且不重复扩展名；`autoSave` 默认关闭 + `settingsVersion` 迁移（旧文件读作 1，无法区分来源的 `autoSave: true` 予以保留并给出一次性提示，不强行覆盖）；`route_launch` 重写为文件路由器（`plan_external_open` 纯函数：已打开→激活标签不重读盘、已排队→留在该窗口、已有单文件窗口→加标签、仅工作区窗口→新建/复用独立单文件窗口、未运行→单文件窗口无草稿），以规范化路径 + 原生文件 ID 去重，前端新增 `external-activate` 处理。
- 过程中发现并修复多分栏重构遗留回归：`EditorPaneItem`/`SplitLayoutNode` 的 computed 读取非响应式的 layout 状态且未接收 `revision`，导致“以文件启动后编辑区显示空状态、标签栏为空而文档其实已载入”。已把 `revision` 传入分栏子树并恢复 `main-pane`/`secondary-pane` 类名。同时修掉 `EditorContainer` 同时转发 `close-tab` 与 legacy `close-main`/`close-secondary` 造成的同一标签重复关闭（脏文档重复确认），并把已失效的“源码/即时排版”按钮点击改为菜单助手。
- 实测 PASS：`pnpm typecheck`、`pnpm test` 23 套件 **236/236**、`pnpm build`、`cargo check`、`cargo test` **82/82**；`node tests/external-open-native.mjs` **5 组真实 DOM 断言**（真实 release 程序 + WebView2 CDP：单文件启动一窗一标签、重复 3 次与并发 4 次双击不增窗不增标签且未保存内容逐字节保留、不同文件成为同窗第 2 标签、磁盘与主会话均未被写入）；`tests/external-open-native.ps1`（单进程单窗口）；`tests/desktop-icon-save.ps1` 与 `-DesktopFixture`（旧策略丢失文件 ID、新策略保持文件 ID 与创建时间、目录无残留条目）。
- 状态 REVIEW：资源管理器鼠标双击/右键打开方式、工作区窗口端到端场景、桌面图标坐标截图、断电场景未验证（NOT RUN）；Playwright 相关脚本已按新默认值与新菜单更新但本环境无法运行。详见 `SAVE_AND_EXTERNAL_OPEN_UPDATE.md`。未提交、推送或发布。

### 2026-10-15 Windows 文件关联与右键菜单集成专项
- 根因分析：
  1. `src-tauri/tauri.conf.json` 中此前未配置 `bundle.fileAssociations`，且未配置 NSIS 关联脚本，导致生成安装包未向 Windows 注册任何打开方式或文件类型。
  2. Tauri 默认的 `APP_ASSOCIATE` 宏直接将 `Software\Classes\.${EXT}` 默认值强行覆盖为应用 ProgID，会直接抢占用户已有的默认应用（如 Notepad、VS Code、Typora 等），破坏用户配置。
  3. Windows 11 “打开方式”、“选择其他应用”与“默认应用设置”依赖 `Applications\lightedit.exe`、`SupportedTypes`、`OpenWithProgids` 以及 `Capabilities\FileAssociations` + `RegisteredApplications` 规范注册，单纯覆盖扩展名默认键无法被 Windows 11 正常索引。
- 修复方案：
  1. 在 `src-tauri/tauri.conf.json` 中配置官方 `bundle.fileAssociations`，完整声明首批 29 种文本与代码格式（.txt, .md, .markdown, .json, .jsonc, .xml, .yaml, .yml, .js, .jsx, .ts, .tsx, .vue, .html, .css, .scss, .java, .py, .go, .rs, .sql, .log, .ini, .cfg, .conf, .properties, .sh, .bat, .cmd），声明 role 为 Editor。
  2. 新增 `src-tauri/windows/installerHooks.nsh` 并通过 `bundle.windows.nsis.installerHooks` 接入：
     - 重定义 `APP_ASSOCIATE` 与 `APP_UNASSOCIATE` 宏：仅向 `OpenWithProgids` 注册应用 ProgID，绝不覆盖扩展名默认 ProgID，绝不抢占用户原有默认程序。
     - `NSIS_HOOK_POSTINSTALL`：以 currentUser 范围（HKCU）注册 `Applications\lightedit.exe`（FriendlyAppName、DefaultIcon、open\command、29 种扩展名 SupportedTypes）、Windows 默认应用能力（`Software\LightEdit\Capabilities\FileAssociations` 与 `RegisteredApplications`）、Windows 10/11 经典右键菜单（`SystemFileAssociations\.${EXT}\shell\LightEdit` 与 `text\shell\LightEdit`，命令带完整双引号 `"$INSTDIR\lightedit.exe" "%1"`，显示“使用 LightEdit 打开”并带图标），并通过 `SHChangeNotify` 立即刷新 Shell 缓存。
     - `NSIS_HOOK_PREUNINSTALL`：严格仅清理 LightEdit 自主创建的注册项（RegisteredApplications、Capabilities、Applications\lightedit.exe、SystemFileAssociations 专用项与 ProgID），绝不删除其他软件关联或修改 UserChoice。
  3. Windows 11 新版右键菜单顶层限制：根据微软官方规范，新版 Win11 顶层上下文菜单必须依赖包含稀疏包标识（Sparse Package Identity）与注册为 COM InProcServer32 的 `IExplorerCommand` 实现，不能使用 Shell Verb 伪造。本轮严格遵守规范，实现 Windows 10 标准右键菜单、Windows 11 “显示更多选项”与“打开方式”，新版顶层菜单列为后续规划，不引入沉重运行时。
- 实测结果：
  1. `pnpm typecheck`：PASS，0 错误。
  2. `pnpm test`：PASS，全仓库 22 个测试套件，231/231 个测试用例全部通过（包含新增 `tests/windows-associations.test.ts` 7/7 用例）。
  3. `pnpm build`：PASS，Vite 生产构建成功。
  4. `cargo check`：PASS。
  5. `cargo test`：PASS，58/58 个 Rust 单元/集成测试全部通过。
  6. 状态：REVIEW。未提交、推送或发布。详细实施见 `WINDOWS_ASSOCIATIONS_UPDATE.md`。

### 2026-10-15 Fleet 风格多分栏与编辑器交互全面重构专项
- 根因排查与修复：
  1. 空编辑区输入异常与窗口关闭拦截：旧代码在无文档时仍可能在 DOM 中挂载 EditorView，且 `EmptyEditorPane` 的 `tabindex="0"` 导致中文输入法（IME）在空区域激活 `compositionstart`，触发 `isComposing` 或文件繁忙保护；修复为无文档时不挂载 CodeMirror，去除空区域无意义焦点捕获，`isComposing` 仅对拥有真实活动文档的 Pane 生效，合成输入结束/取消可靠恢复正常关闭与切换。
  2. 窗口关闭保护诊断：完善 `WindowCloseGuard`，关闭请求记录来源（titlebar/command/native）、阶段与状态诊断，严禁记录正文；保留脏文档弹窗确认和保存中的防丢保护。
- 架构全面重构为递归 Split Tree（Phase B）：
  1. 抽离类型安全的 `EditorLayoutManager`（`LayoutNode = PaneLeafNode | PaneSplitNode`），彻底淘汰旧版单一 `isSplit` 与固定 `main`/`secondary` 限制，支持水平、垂直与任意深度混合嵌套分栏。
  2. 每个 Leaf Pane 拥有独立 `TabGroup` 与稳定 `paneId`，`DocumentManager` 维护基于 `paneId` 的 `EditorView` 映射，统一事务派发到所有同时展示相同文档的视图，跨 Pane 协同编辑底层无损同步，光标、选区、滚动位置完全独立。
  3. 空分栏自动回收策略：关闭非唯一 Pane 的最后标签时自动回收该 Pane 并将父级 Split 折叠为兄弟节点；关闭全部文件时平滑恢复为单一空白 Pane，不留僵尸分栏与悬空分隔线；同一文档在多 Pane 打开时，关闭单侧标签仅解除该 Pane 引用，仅在最后引用关闭且有未保存修改时触发保存确认。
- 标签拖拽与落点高亮（Phase C）：
  1. 实现 Fleet 风格的 4 方向边缘 Drop Zone（left / right / top / bottom）与中央 Drop Zone，提供半透明落点高亮遮罩（`DropZoneOverlay.vue`）。
  2. 支持内部标签同组内拖拽重排（精准前后插入指示线）与跨 Pane 移动/拆分。
  3. 工作区文件树（`TreeNodeItem.vue`）支持直接拖入编辑器中央或边缘创建对应方向分栏，严格遵守 Tauri 路径与授权保护；拖拽取消完全恢复原状态。
  4. 完整 13+ 项标签右键菜单（`TabBar.vue`）：包含关闭、关闭其他、关闭右侧、关闭全部、固定/取消固定、向左/右/上/下拆分、移动到已有分栏、复制到新分栏（同文档多视图）、关闭当前分栏、合并全部分栏、复制完整路径、复制相对路径、在系统文件管理器中显示等，根据状态动态置灰。固定标签默认不显示普通关闭叉号。
- 自动换行、焦点导航与视图菜单（Phase D）：
  1. 修复自动换行即时生效问题：主菜单“自动换行”命令与 `wordWrap` 响应式双向同步，触发 CodeMirror lineWrapping 重配置并实时派发至全部打开的 EditorView；纯视觉排版，不改变换行符（CRLF/LF）、BOM 或 UTF-8 字节。
  2. 视图菜单重整：在“视图”菜单中增加“编辑器布局 >”（向右拆分、向下拆分、最大化当前编辑器、恢复编辑器布局、合并所有分栏），与 Markdown 模式层级清晰隔离。
  3. 分栏焦点导航命令与快捷键体系：支持聚焦左/右/上/下分栏、切换下一个分栏、最大化/恢复分栏、关闭当前分栏、合并所有分栏。
- 验证结果：
  1. `pnpm typecheck`：PASS，0 错误。
  2. `pnpm test`：PASS，全仓库 21 个测试套件，224/224 个用例全部通过（包含新增 `tests/editor-layout.test.ts`、`tests/split-tree-editor.test.ts`、`tests/reproduce-phase-a-flow.test.ts`、`tests/word-wrap.test.ts`）。
  3. `pnpm build`：PASS，Vite 生产构建成功（207 modules transformed）。
  4. `cargo check` 与 `cargo test`：PASS，58/58 个 Rust 单元/集成测试全部通过。
  5. 状态：REVIEW。详细设计、根因分析、修改清单与 Windows 手工验证见 `EDITOR_LAYOUT_REFACTOR.md`。不自动提交、推送或发布。

### 2026-10-15 本地打包脚本专项
- 仅增加打包入口/文档与针对性脚本测试：Windows `build.bat` 生成 NSIS EXE；macOS/Linux 的 `build.sh` 调用同一个 `scripts/package.mjs`，分别选择 APP/DMG 与 DEB/AppImage。对应系统本机构建，跨系统请求明确失败；不引入依赖、不改编辑器业务、不提交/推送/发布。
- 默认锁定依赖安装后复用 Tauri 生产构建，可 `--skip-install`；`--check` 不安装/编译。补齐 Cargo PATH，保留代理/签名环境，清除继承的开发配置，mac 图标在生成目录派生，使用 Cargo metadata 定位输出，失败返回非零码，无强制结束进程或自动安装行为。
- 实测PASS：`node --check scripts/package.mjs`、7个针对性 Vitest 用例、Windows CMD 实际 `build.bat --check`（Node/pnpm/Rust/Cargo基础检查）；`build.bat --platform macos --check` 按预期退出1。`git diff --check` PASS。完整构建/安装/签名和macOS/Linux运行均NOT RUN；本轮只交付脚本，不宣称安装包已生成或跨平台验收通过。REVIEW，使用说明及文件用途见 `PACKAGING.md`。

### 2026-10-15 启动模式与会话恢复专项
- 本轮仅修改启动/文件关联分流/欢迎空状态/Last Session 与必要的窗口授权隔离。Rust先分类App/File Launch；无参数恢复真实会话或欢迎页，有参数只开本批文件；不创建Untitled。已运行时外部文件进入独立file-N窗口，不打扰主工作区；Ctrl+O保留当前模式。
- 新增独立schema v1 last-session.json，记录根、真实文件标签顺序/编码、活动标签和侧栏布局；不使用Recents代替标签，不记录正文。前端去重合并写入，Rust只接受本窗口授权token；临时窗口无会话写权限。工作区/搜索/队列/grant按窗口隔离，销毁只回收自身授权。保留原安全读写、脏文档与保存/IME关闭保护。
- 实测PASS：typecheck、前端186/186、build、cargo check与Rust49/49；浏览器2组、真实Windows启动/单实例/多窗口/关闭重启10组。证据 `test-results/launch-session-native/1792030774965/`，逐项范围/文件/测试/限制见 `STARTUP_SESSION_UPDATE.md`。
- REVIEW：Explorer实际关联/双击、系统选择器、真实系统IME和跨平台仍NOT RUN；没有安装、修改系统关联、提交、推送或发布。旧版无真实标签快照时不从Recents猜测会话。
- 上一多分栏专项按用户新范围停止；仅保留Phase A已改基础修复，B–D未开始。旧原生专项后两组未完成及复现证据如实记录于 `EDITOR_LAYOUT_REFACTOR.md`。

### 2026-10-15 Markdown 专项阶段 A — 核心审查与基础所见即所得
- 用户最后要求停止回归，已停止后续测试并清理本轮测试进程。保留已完成的真实结果，最后重复typecheck因该指示被自动审批拒绝，NOT RUN且未重试；不再补跑或推进阶段B。
- 范围仅为既有Phase 5/6增量：按Typora官方公开文档建立Live/Source/Split三模式差距矩阵；复用原表格Widget；实现授权相对栅格图片/失败路径/受控网络/精确源码点击，围栏语言复用/安全高亮/复制，列表与任务续写/空项退出、引用逐级退出与条件Tab/Shift+Tab，共享GFM/换行/链接/标点策略。
- CM源码/Transaction仍唯一数据，块图片直接StateField测量；图片不开放file协议，Rust token+当前工作区根范围检查，4MiB/16MP/单边16384及全局保留字节/像素预算，迟到响应/BlobURL/计时器销毁。无新依赖，保留本轮前未知后缀和字节编辑未提交修改。
- 最终实测PASS：typecheck/build、前端175/175、Rust45/45及cargo check；新Markdown UI11组（含另存为/移动资源刷新及24次长文图片布局真实点击）、既有40次点击、表格18组、基础9组/双Pane8组；原生图片4组及完整编辑13组（含40次点击/BOM/CRLF/保存冲突/关闭保护/三模式/表格）。证据与逐文件用途见 `MARKDOWN_PARITY.md`。
- 状态REVIEW；真实系统中文IME、系统剪贴板新专项、原生DPI/触控板、跨平台和长时RSS仍NOT RUN。公式/脚注/TOC/YAML元数据语义/Mermaid/GFM Alert及高级图片/表格工作流不冒称完成。阶段B仅列建议，未开始；不提交、推送、发布或更新安装包。

### 2026-10-15 未知后缀与可编辑 ClassFile 字节
- Phase 3/6 既有文件链路增量。遵循用户最新指示，覆盖此前“.class 默认只读”的要求：后缀只决定语法高亮，不限制文本打开、编辑、保存与另存为；文本 `.class`、`.bat/.cmd`、未知后缀和无后缀均进入普通编辑器。
- 真正的 ClassFile/NUL/默认编码无法解码的非 BOM 数据以可逆 Hex 进入同一 CodeMirror 标签，可编辑、撤销/重做、手动/自动保存与分栏。Rust 严格解析字节并继续使用授权 token、版本冲突校验及原子保存；禁止把 Hex 展示文字转 UTF-8 覆盖原文件。可选“查看 JVM ClassFile 结构”和“编辑文件字节”保留原有结构查看能力。
- 实测PASS：typecheck/build、前端157/157、Rust42/42及cargo check，浏览器基础9组/分栏与搜索8组、Windows原生真实文件7组（含bat/cmd、文本class、未知/无后缀、二进制class编辑保存与失败保护、最近重开）。原生证据 `test-results/file-types-native/1792026785582/`；限制及修改清单见 `FILE_TYPES_EDITING_UPDATE.md`。状态REVIEW，不提交/推送/发布或开始下一Phase。

### 2026-10-14 工作区工具栏、Batch 与行标记专项
- 明确授权的 Phase 4/5/6 增量，五项工作区工具/合并新建/真实懒加载定位/有预算展开和取消、全高度虚拟树、Batch/CMD纯文本保留编码BOM/CRLF、标签隐藏滚动条及活动定位、真实CM行身份/历史/成功保存基线的3px橙绿gutter。没有新依赖，不替换现有文件服务或保存语义。
- 实测最终 PASS：typecheck/build，前端149/149，Rust38/38与cargo check；新UI8组、主菜单8、基础9、选区5、双Pane8、Markdown40次真实点击和编辑体验18组；Windows原生编辑13、工作区13（含万文件/双根/定位、UTF-8与UTF-16LE Batch手动/自动保存字节及失败保留）。证据与完整修改清单/预算见 `WORKSPACE_EDITOR_UPDATE.md`。
- 状态REVIEW；真实IME、系统选择框/触控板/多显示器DPI、macOS/Linux与长时内存仍待人工。不更新/发布安装包，不提交或推送、不自动推进下一Phase。

### 2026-10-14 四组主菜单重构
- 文件/编辑/格式/视图，类型化多级MenuNode+稳定CommandRegistry，业务与展示分离，工作区与历史折叠菜单、文件/根/标签右键，MD格式真实事务含表格、勾选/单选、菜单键盘/焦点/边界与顶部精简。保留命令面板底层能力，快捷键v3迁移保护自定义，Mod+R防刷新。官方Tauri文本剪贴板插件仅read/write-text能力。
- 用户一度要求停止测试，旧选择器缺项如实保留；随后工作区任务重新授权测试，最终相邻专项复跑已通过上述检查。菜单迁移、依赖、快捷键冲突与人工缺项见 `MAIN_MENU_REFACTOR.md`。REVIEW，无提交/推送/发布。

### 2026-10-14 目录树与 ClassFile 专项
- 用户授权既有文件/工作区增量修复：移除380px限高、单一滚动区、动态虚拟行数和ResizeObserver、全宽长名/完整悬停/隐藏工具/统一图标/活动文件定位；按内容识别ClassFile并接入只读结构和授权版本检查的分页Hex查看。前端与Rust均阻止文本保存覆盖，不运行目标字节码，不新增依赖，保留忽略规则。
- 用户最后明确要求“不用验证，修改完即可”。最终测试、构建和原生验收NOT RUN；此前中间Rust check曾PASS、typecheck发现文本fixture类型错误已修正但未复跑，不能作为最终通过证据。详情见 `TREE_CLASSFILE_UPDATE.md`。
- 状态REVIEW；不提交、推送或发布，不自动推进Phase。上一安装包不包含本次新修改。

### 2026-10-14 编辑体验专项收尾
- 明确授权的 Phase 4/5/6 增量修复，详情见 `EDITOR_EXPERIENCE_SPECIAL.md`。typecheck/build PASS，111个前端单元、20个模型检查、36个 Rust 测试 PASS；新增浏览器18组、原生编辑13组、工作区11组及既有点击/双Pane回归 PASS。
- 用户要求停止后续验证；新 NSIS 安装包已构建，安装/卸载与发布版冒烟未执行，不标记安装交付 DONE。原生 IME/系统 DPI/跨平台/长时内存缺项仍保留。没有提交、推送或自动推进新 Phase。

## 状态说明
- NOT_STARTED：尚未实施
- IN_PROGRESS：正在开发或修复
- REVIEW：代码已提交审查但未验收
- DONE：验收标准均满足且已获确认
- BLOCKED：依赖或环境阻塞（必须说明）

| Phase | 目标 | 状态 | 验收证据 / 备注 |
|---|---|---|---|
| 1 | Tauri 2 + Vue 3 项目骨架和 Fleet 风格 UI | REVIEW | 2026-10-13 复审：typecheck/build、开发与生产浏览器 8 组回归 PASS；Rust/Cargo/MSVC 缺失，桌面验收未完成。见 PHASE1_REVIEW.md |
| 2 | CodeMirror 6 通用文本内核、多语言、多标签 | REVIEW | 2026-10-13：typecheck/build、32 个单元测试、开发/生产浏览器各 8 组回归 PASS；真实桌面与原生 IME 待验。见 PHASE2_IMPLEMENTATION.md |
| 3 | Rust 文件读写、保存、单文件和最近使用 | REVIEW | 2026-10-14 保存拒绝访问专项修复：构建 exe 继承 Low MIC 标签导致无法写桌面，已恢复生成目录 Medium；前端 89/89、Rust 30/30，Desktop/natapp 独立 fixture 原生 5/5；保存阶段/有效不可写提示修正。见 PHASE3_SAVE_PERMISSION_FIX.md；完整人工验收仍待补齐 |
| 4 | 工作区目录树、快速打开与全文搜索 | REVIEW | 2026-10-14 复审修复：typecheck/build PASS，前端 79/79（工作区 12），Rust 25/25，Windows 真实桌面 9/9；修复授权同步、取消/Unicode/分批、忽略语义、移动/确认、万级虚拟树。系统选目录框、IME/DPI 与跨平台仍待补验。见 PHASE4_REVIEW.md |
| 5 | Markdown 同区 Live Preview / Source / Split | REVIEW | 2026-10-14 复审：修复任务/代码分隔符/视口装饰/IME 位置映射与安全链接；typecheck/build PASS，前端 89/89（Markdown 10），Rust 29/29，真实 CM DOM 8/8、Windows 模式/10 次历史与磁盘字节通过。原生中文 IME 等人工项待验。见 PHASE5_REVIEW.md |
| 6 | 分栏、查找替换、快捷键与效率功能 | REVIEW | 2026-10-14 复审：真实双视图同步、标签拖放、独立视图、共享历史与授权、AST 左右大纲、零长度/分组替换、设置/快捷键持久化修复；DOM 8/8、原生双阶段 5/5（含桌面退出重启）；此前工作区原生 9/9。系统 Explorer/clipboard 等仍待验。见 PHASE6_REVIEW.md |
| 7 | 恢复、文件监控、安全与性能 | NOT_STARTED | |
| 8 | 桌面打包、平台验收及正式发布准备 | NOT_STARTED | |

### 常驻横向菜单栏修正 — 2026-10-14
- 用户图片澄清：菜单分类一直可见，替换此前Logo点击后展开分类的解释。Phase 6增量，保持REVIEW。
- 文件/编辑/格式/视图/工作区/帮助常驻同一自定义标题栏，悬停或点击展开；帮助直达真实快捷键设置。保留设置、手动字号、默认自动保存与编辑区提示精简。窄窗收起重复工具而保留六个菜单，模式切换也可从视图菜单执行。
- 实测PASS：typecheck/build、前端103/103、菜单4组、设置2组、文件契约5组、基础UI9组、原生编辑12组、真实工作区11组，含菜单退出保护/格式/磁盘与原生780px无溢出。Rust35/35与check在本轮自动保存验证中已通过，菜单追加未改Rust。
- 新证据：test-results/editor-native/1791966740563/、test-results/phase4-native/1791966850561/、test-results/menu/menubar.png；文件用途/人工缺项见 [MENUBAR_UPDATE.md](MENUBAR_UPDATE.md)。未提交/推送或开始下一Phase。

### 设置、自动保存与编辑区精简 — 2026-10-14
- 范围：Phase 6首选项增量及用户明确要求的真实文件自动保存单项；保持REVIEW，不启动完整Phase 7恢复/备份/监控或Phase 8。
- 完成：分类导航/统一控件/设置齿轮与字体键盘图标、手动整数字号、默认开启1.5秒延迟自动保存及开关/延迟持久化；移除编辑区说明条、重复徽章、侧栏教程和保存成功Toast，真正错误仍保留。
- 自动保存复用CM snapshot与Rust expectedVersion/编码/BOM/EOL/原子保存；一个计时器与串行队列，不逐键IPC。草稿/不可写路径跳过；IME/工作区操作/确认延期，写入中关闭保护；新编辑保持dirty再存，错误暂停而不反复重试。
- 最终PASS：typecheck/build、前端103/103、cargo check、Rust35/35、rustfmt、设置2组、菜单4组、Markdown40次点击、选区5组、分栏8组、文件契约5组、基础UI9组、主题3组、原生编辑12组、多文件夹磁盘11组。独立lint NOT RUN（未配置）。
- 证据：test-results/settings/、test-results/editor-native/1791965740296/、test-results/phase4-native/1791965888540/。完整文件用途、失败修复与风险见 [SETTINGS_AUTOSAVE_UPDATE.md](SETTINGS_AUTOSAVE_UPDATE.md)。
- 缺项：真实中文IME/DPI/触控板/跨平台仍待人工；首次原生15秒标签等待曾超时，完整复跑通过但首次超时原因未确定，后续跟踪。未提交或推送，保留用户索引和已有改动。

### 用户指定编辑体验、多文件夹及 Markdown 点击修复 — 2026-10-14
- 范围：既有 Phase 4–6 增量修复；保留 REVIEW，不开始 Phase 7/8。用户明确要求替换系统标题栏、添加多个文件夹和将文件路径移到底栏，覆盖对应 PRD 布局参考。
- 完成：14px新默认、Ctrl/Command+滚轮字号缩放、Fleet查找替换、单条自定义标题栏/圆角菜单、18项Markdown源码格式事务、中文快捷键、已打开/最近文件转菜单、独立文件默认隐藏文件侧栏、最多16个不重叠目录的真实工作区/搜索/快速打开与配置恢复。
- Markdown点击错行实际复现：竖向margin及块分隔线造成CM行坐标累积误差，改为可测量padding和行内Widget；段落增加视觉留白，源码零额外换行。路径替代底栏模式文字，上方仅保留编辑工具。
- 最终PASS：typecheck/build、前端96/96、cargo check、Rust34/34、菜单4组、Markdown真实鼠标40次点击/编辑/撤销、选区5组、双视图8组、主题3组、基础UI9组、IPC契约5组、Windows原生编辑11组及多文件夹磁盘11组。lint NOT RUN（未配置）。
- 证据：test-results/editor-native/1791964497582/、test-results/phase4-native/1791964554730/、test-results/markdown-clicks/、test-results/menu/。过程失败、文件用途、验收条款/边界详见 [EDITOR_UX_UPDATE.md](EDITOR_UX_UPDATE.md)。
- 人工缺项：实际系统选目录、标题栏拖拽/窗口边缘缩放、原生中文IME、DPI/高对比和跨平台；跨根移动明确拒绝。未提交、推送或操作Git索引，用户已有暂存/删除状态保留，正常热更新策略保持。

### 用户指定的三态主题与 Logo 更新 — 2026-10-14
- 范围：Phase 6 首选项完善，以及用户明确要求的品牌资源替换。仅替换已有 UI/favicon/桌面图标；没有开始 Phase 7、Phase 8 打包或发布，阶段保持 REVIEW。
- 主题支持浅色、深色、跟随系统；新设置默认跟随系统，旧 dark/light 设置保持原选择。系统事件只更新实际界面/CM6 主题，不覆盖 system 偏好；卸载清理监听。原生标题栏使用 Tauri setTheme，按序执行，添加单项窗口权限。
- 内置 imagegen 生成紫色纸页/编辑笔图案，官方 Tauri icon 工具机械缩放/编码；替换顶部 Logo、PNG favicon、PNG/ICO 桌面资源，移除旧 L 图标。没有增加依赖。
- 实测：typecheck/build、前端 90/90、cargo check、Rust 31/31、主题浏览器 3/3、已有 UI 9/9、文件 IPC 契约 5/5、Windows 原生 6/6 PASS。浏览器首次复跑遇到 IPv6 localhost 地址与空 CM DOM 文本断言问题，修正测试后全通过。lint NOT RUN（未配置）。
- 证据：`test-results/theme/`、`test-results/phase2/`、`test-results/phase3/`、`test-results/editor-native/1791958251570/`。系统变化在浏览器通过媒体模拟验证，原生实际主题/标题栏和 system 退出重启通过；真实 Windows 系统设置切换、任务栏缓存和 macOS/Linux 仍待人工验收。
- 完整文件用途、生成提示词、人工步骤及风险见 `THEME_LOGO_UPDATE.md`。未提交、推送或改动 Git 索引；正常开发热更新策略保留。

### 选区不可见专项修复 — 2026-10-14
- 范围：Phase 6 主题补丁后的编辑选区显示回归，修复既有 CM6 主题，保持各阶段 REVIEW，不推进 Phase 7/8。
- 真实鼠标拖选复现：选区状态为 3–22，但选区内/外截图像素均为 `[39,44,54]`。不透明 active-line 覆盖了下方 drawSelection 层；改为半透明后又确认旧选择器优先级不足，CodeMirror 默认聚焦选区色仍覆盖自定义色。
- 修复：当前行使用半透明专用变量，聚焦/失焦选区各用专用颜色，并采用与实际 CM 层级一致的选择器；编辑内容区域显式允许文本选择。保留 gutter 高亮、原生 drawSelection、事务和共享撤销架构，无新依赖。
- 实测 PASS：`pnpm typecheck`、`pnpm build`（152 modules，既有分块提示）、前端 90/90、cargo check、Rust 31/31、选区浏览器 5/5、主题 3/3、双窗格 8/8。选区测试使用真实鼠标与键盘并检查实际截图像素，覆盖明暗/失焦/多行、双窗格、Markdown Source/Live/Split，不只检查 CSS。
- 原生复跑 NOT RUN：`pnpm test:native:editor` 安全前置检测发现已有用户 LightEdit 进程并退出，未启动 fixture、未关闭窗口或修改用户文件。已补充原生选区测试，待用户保存关闭后运行。独立 lint NOT RUN（未配置）；原生 DPI、IME、高对比及跨平台仍待人工验收。
- 文件：`src/editor/core/extensions.ts`（选区/当前行样式）、`src/styles/variables.css`（颜色变量）、`tests/selection-checks.mjs`（共享鼠标/键盘/截图像素校验）、`tests/selection-ui.mjs`（真实 App 专项）、`tests/editor-native.mjs`（原生专项场景）、`package.json`（test:ui:selection 入口）、本台账。证据 `test-results/selection/`、`test-results/theme/`、`test-results/phase6-review/`。
- 人工步骤：在当前开发窗口拖选同一行和跨行文本、按 Shift+方向键、切换深浅主题、点击工具栏移开焦点，确认选区仍明显且撤销/重做正常。正常热更新策略未改；专项实现/可执行检查完成，原生缺项不冒称通过。未提交、推送或改动 Git 索引。

---

### Phase 1 — 日期：2026-03-30
> 以下为原实施记录，并非本次复审的完整验证证据；最新结论以 2026-10-13 复审和 `PHASE1_REVIEW.md` 为准。原记录中的 Markdown 模式切换已改为禁用占位，窗口彩色示意点已移除，状态栏不再宣称磁盘已同步。
- **状态**：REVIEW
- **实现范围**：
  1. 完成 Tauri 2 (`src-tauri`) 官方规范工程配置：`Cargo.toml`、`tauri.conf.json`、`capabilities/default.json`、`build.rs`、`src/main.rs`、`src/lib.rs`、`commands/app.rs`；
  2. 完成 Vue 3 + TypeScript + Vite 纯净前端骨架：`package.json`、`vite.config.ts`、`tsconfig.json`、`tsconfig.node.json`、`index.html`；
  3. 按照 `docs/prototype.html` 高保真实现 Fleet 风格 Design Tokens（深色 Midnight / 浅色 Paper）、CSS Reset 与全局样式；
  4. 实现完整 Fleet UI 壳组件：
     - `TopBar`：窗口红黄绿小点、Logo、标题、快速检索入口、单文件/工作区切换、专注模式、主题切换、设置入口；
     - `ActivityBar`：极简侧边工具条（文件树、搜索、大纲、设置）；
     - `Sidebar`：侧边栏 Explorer 容器，支持 190–420px 流畅鼠标拖拽调宽与折叠；
     - `TabBar`：紧凑标签栏，支持区分 Pinned 与 Temporary Preview 标签、未保存圆点、关闭与新建；
     - `Breadcrumb`：层级路径面包屑、语言模式芯片、软换行、大纲开关；Markdown 文件条件渲染 Live/Source/Split 切换按钮，非 Markdown 文件严格隐藏；
     - `EditorContainer`：代码与文本容器（默认打开普通代码文件 `main.rs`，非 Markdown，遵守 Phase 1 验收标准；明确标识 CM6 内核将在 Phase 2 挂载，不以 textarea 伪造内核）；支持空状态 Hero 引导页；
     - `StatusBar`：24px 极简状态栏，显示工作区模式、未保存状态、行列号、Spaces 缩进、编码、换行符、语言模式、字符计数；
     - `CommandPalette`：`Ctrl+P`（文件检索）与 `Ctrl+Shift+P`（命令操作）快速打开面板，支持键盘上下键选择、Enter 执行与 Esc 关闭；
     - `SettingsModal`：首选项弹窗（主题选择、字号滑块、自动换行、大纲开关、Markdown 默认模式）；
     - `Toast`：轻量操作反馈提示。
- **主要变更文件**：
  - `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.npmrc`
  - `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/app.rs`
  - `src/main.ts`, `src/App.vue`, `src/types/index.ts`
  - `src/styles/variables.css`, `src/styles/reset.css`, `src/styles/main.css`
  - `src/components/common/Icon.vue`, `src/components/common/Toast.vue`
  - `src/components/layout/TopBar.vue`, `src/components/layout/ActivityBar.vue`, `src/components/layout/Sidebar.vue`, `src/components/layout/TabBar.vue`, `src/components/layout/Breadcrumb.vue`, `src/components/layout/EditorContainer.vue`, `src/components/layout/StatusBar.vue`
  - `src/components/modals/CommandPalette.vue`, `src/components/modals/SettingsModal.vue`
- **自动化验证**：
  - `pnpm run build` (`vue-tsc --noEmit && vite build`)：**PASS**（耗时 892ms，47 modules transformed，0 类型错误）
  - 前端静态预览服务 (`vite preview`)：**PASS**（HTTP 200，无控制台报错）
  - `cargo check`：**NOT RUN**（当前宿主执行环境未安装 Rust/Cargo 工具链，将在环境配置完毕后执行）
- **人工验收步骤**：
  1. 运行 `pnpm run dev` 并在浏览器打开查看 Fleet 风格 UI；
  2. 点击右上角单文件/工作区切换按钮，检查侧边栏与活动栏显隐切换；
  3. 拖拽侧边栏右侧边缘，检查宽度是否在 190–420px 之间平滑调整；
  4. 点击右上角或设置中的深色/浅色切换，检查色彩变量与对比度是否平滑过渡；
  5. 按下 `Ctrl+P` 或 `Ctrl+Shift+P`，检查命令面板弹出、键盘上下选择与 Enter 动作；
  6. 点击 TabBar 中的不同文件标签（`main.rs`, `EditorView.ts`, `settings.json`, `README.md`），检查面板联动；注意非 Markdown 文件不出现 Markdown 工具条，只有切换到 `README.md` 时才出现。
- **未解决问题/风险**：
  1. 宿主环境缺失 Rust 工具链（`cargo` / `rustc`），后续构建桌面可执行文件前需宿主安装 Rust；
  2. Phase 1 编辑器仅为布局容器，CodeMirror 6 内核将在 Phase 2 正式接入。
- **下一阶段前置条件**：
  Phase 1 获得用户评审批准，进入 Phase 2（引入 CodeMirror 6 统一内核、多语言高亮与多标签状态管理）。

### Phase 1 复审 — 日期：2026-10-13
- **状态**：REVIEW，未达到完整桌面验收门槛，未标记 DONE。
- **审查依据**：AGENTS.md、PRD 第 0–5 节与 Phase 1 标准、prototype.html；检查全部 `src`/`src-tauri` 代码、依赖、构建配置及 UI。
- **修复**：示例树折叠与无效节点、弹窗 Esc/焦点循环/快捷键隔离、命令过滤后选择索引、拖拽卸载与失焦清理、Toast 定时器、新建标签回收、窄窗口布局、误导性的同步提示、未实现功能禁用、favicon 404、原生窗口示意按钮重复、Tauri CLI/图标/CSP、配置文件类型检查。
- **真实验证**：`pnpm typecheck` PASS；`pnpm build` PASS（48 modules；资源体积为前端构建结果，不代表安装包）；已有 Playwright + Edge 的开发/生产浏览器回归均 8/8 PASS，console/page errors 0；保存 10 张明暗/不同宽度截图并检查布局；`pnpm tauri info` 执行成功但报告工具链缺失；`pnpm tauri dev` 启动失败，找不到 Cargo；cargo check/test 未能执行；lint/独立 unit runner 未配置。
- **Git 限制**：根目录无 `.git`，`git status`/`git diff` 均不能执行。修复前临时快照未能跨沙箱进程保留，未将其作为差异证据；不得将当前源码审查描述为历史 Git diff 审查。未初始化 Git、未提交、未推送。
- **遗留**：Rust/MSVC 编译、真实 Tauri 启动、CSP/IPC 在 WebView2 内的运行、原生窗口/真实 DPI/输入法及 macOS/Linux 尚未验收；源码中示例文本仅用于只读 UI，文件读写与编辑内核尚未实施。
- **详情**：`docs/PHASE1_REVIEW.md`（逐项结论、修改文件用途、复现命令和风险）。保持 Phase 2–8 为 NOT_STARTED；下一阶段必须另行授权。

### 仓库发布准备 — 日期：2026-10-13
- 用户明确授权将当前 Phase 1 代码提交并推送到 `https://github.com/pucj0/lightEdit`；此前禁止自行提交/推送的限制在本次授权范围内解除，不包含推进下一阶段或发布 Release。
- 新增 `README.md`：提供浏览器启动、Windows Tauri 环境配置、验证命令与常见问题；强调当前仅为只读 UI 骨架。
- 推送前重新执行 `pnpm typecheck` 与 `pnpm build`：PASS（48 modules）；无应用代码变更，不重复执行已通过的 UI 回归。
- 先前无 Git 仓库的说明为复审时的历史事实；本次按授权建立仓库基线，不回写历史审查结论。
- Phase 1 保持 REVIEW，Rust/MSVC 与真实桌面验收尚未完成，Phase 2–8 仍为 NOT_STARTED。

### Phase 2 — 日期：2026-10-13
- **授权与前置条件**：用户明确要求开始 Phase 2。按当前指示继续；Phase 1 桌面编译/运行未完成的事实保留，不将 Phase 1 标为 DONE。
- **状态**：REVIEW，代码和浏览器验证完成，未获最终实机验收确认；Phase 3–8 均保持 NOT_STARTED。
- **实现**：真实 CodeMirror 6 内核；DocumentManager 独立 EditorState/基线/滚动缓存；TabGroup 预览替换、固定、首次编辑 pin 和释放；元数据包含 URI、语言、行列、字符数、dirty、编码/EOL 等，全文不进入 Vue `v-model`。
- **语言**：21 个模式，官方包按需加载；支持 Markdown、JSON/JSONC、YAML、TOML、JS/TS/JSX/TSX、Vue、HTML/CSS、Python、Go、Rust、SQL、XML、INI；CSV/Log/Plain Text 使用纯文本内核；未知与无扩展名退回 Plain Text。状态栏可手动切换，加载失败保留源码并提示纯文本降级/重试。
- **交互**：行号、软换行、Spaces 2 缩进、括号匹配/自动闭合、折叠、基础语言补全、撤销/重做、Ctrl+F/Ctrl+H 查找/替换；跨标签保留光标、多选区、滚动、折叠与撤销记录；脏标签关闭弹窗、浏览器 beforeunload、Tauri 关闭保护接线。
- **范围取舍**：本阶段单 pane/一个可扩展 TabGroup；分栏与组间拖放留给 Phase 6。所有可编辑内容仍为明确标记的内存样例/草稿；真实 Rust 文件 I/O 留给 Phase 3。Markdown 暂为真实 CM6 源码编辑，Live/Split 禁用并标明 Phase 5。
- **测试修复**：增加完整组合输入生命周期检查，发现 `EditorView.composing` 尚未输入字符时为 false，改用 `compositionStarted`；语言/主题/换行重配置延后至组合结束，防止丢输入。修复打包分块、命令面板异步元数据变化时的选择索引保持。
- **真实证据**：`pnpm typecheck` PASS；`pnpm test` 32/32 PASS；`pnpm build` PASS，103 modules，无大块警告；编辑器内核 414.75 kB（gzip 134.98 kB），入口 121.70 kB（gzip 46.79 kB），语言模块为独立 chunk。开发及生产的 Playwright/Edge 回归各 8/8 PASS，console/page errors 0；保存并检查明暗/窄窗口截图。
- **NOT RUN / FAIL**：cargo check/test 已尝试，找不到 Cargo，编译器未执行；`pnpm tauri dev` FAIL（cargo metadata program not found）；独立 lint 未配置；真实 Windows 中文 IME、原生窗口/CSP/IPC 与 macOS/Linux 未验。
- **Git**：本次开始时发现两份旧参考副本和 `tests/phase1-ui.mjs` 的用户删除，未恢复或覆盖。最终保留旧 UI 测试删除，新建 Phase 2 测试并更新入口。审查实际 Git diff，未提交/推送。期间参考副本状态由外部操作改变，不纳入本轮修改。
- **详细报告**：`docs/PHASE2_IMPLEMENTATION.md`，包含修改文件用途、验证命令、手工步骤、遗留风险与完成门槛。

### Phase 3 — 日期：2026-10-13
- **授权/状态**：用户明确要求继续 Phase 3，并确认未安装 Rust/Cargo/MSVC，要求先实现并记录缺项。状态 REVIEW；未达到完整桌面完成门槛，不标 DONE，不进入 Phase 4。
- **实现**：Rust 官方文件对话框与单实例插件；打开/保存/另存为、拖拽/启动参数队列、近期与独立布局；路径授权 token/代次、规范化路径与链接校验、版本摘要、严格编码/BOM、只读与权限检查、同目录原子替换和异常备份。
- **编辑器**：保持真实 CM 事务与独立状态缓存；持久化 RangeSet/StateField 保留混合 EOL、末尾状态和合并撤销；保存快照只清理已写版本，期间新修改仍 dirty；关闭确认支持保存、放弃与取消；Rust 默认阻止未经前端确认的关闭。
- **UI**：默认单文件草稿；打开/保存按钮和快捷键/编码命令；浏览器磁盘操作禁用，样例只在显式 `?demo=1` 下展示。目录树/搜索与 Markdown Live/Split 保持后续阶段标记。
- **真实证据**：`pnpm typecheck` PASS；`pnpm test` 51/51 PASS（32 既有＋19 文件状态）；`pnpm build` PASS，106 modules。开发与生产浏览器均原有 8/8＋文件 5/5 PASS，错误 0；检查明暗/窄窗口截图。文件 gateway/IPC 替身仅用于测试，不等于 Rust 或磁盘通过。
- **缺项**：已尝试 cargo check/test，找不到 cargo，编译器/fixture 未执行；`pnpm tauri dev --no-watch` FAIL（cargo metadata program not found）；lint/cargo fmt/clippy、原生对话框、Windows ACL/占用/替换、真实退出/启动参数/拖拽、原生 IME/DPI、macOS/Linux NOT RUN。
- **风险/取舍**：Rust 未编译，无 Cargo.lock；原子检查和跨进程 rename 间仍有竞态；Windows 故障备份、Unix ACL/xattr 待验。保守限制文件/解码文本 16 MiB、200,001 行、批次 20 文件/约 64 MiB；拒绝文件符号链接/硬链接。文件监控、崩溃恢复和大文件优化仍属 Phase 7。
- **Git/报告**：保留既有 Phase 2 未提交修改和用户删除的旧测试；检查累计 diff 和新文件，无提交/推送。详见 `docs/PHASE3_IMPLEMENTATION.md` 的文件用途、逐项验收、命令、手工步骤及风险。

### Phase 3 补验 — 2026-10-13
- 用户已安装 Visual Studio 2026/C++/SDK、Rust/Cargo 1.99.0 MSVC、WebView2，最小 Rust 编译运行 PASS。crates.io 直连 TLS 失败，验证现有本地代理后可用；未关闭证书验证。
- 复现启动 os error 5；原生程序无法写入 AppData/系统 Temp。新增 `scripts/tauri.mjs`，仅 dev 使用被 Git 忽略的 `.lightedit-dev/` 存放 WebView2、Temp 与开发偏好；CLI 其他命令和正式数据目录不重定向，无新依赖。
- 真实 `pnpm tauri dev --no-watch` 编译运行 PASS：LightEdit 窗口、HTTP 200、开发配置实际写入。没有用浏览器模拟替代此启动证据。
- Rust fixture 首次系统 Temp 权限失败；重定向测试 Temp 后发现删除冲突分类错误，在 `files/atomic.rs` 修复写入前版本检查。最终 cargo check PASS，Rust 13/13 PASS（含 Windows ACL/占用与真实字节往返）。保留实际 Cargo.lock。
- tests/ 在本轮期间被外部删除，pnpm test 曾 FAIL；用户明确授权恢复四个当前回归文件后，typecheck/build、51/51 前端 unit PASS；浏览器改用独立测试服务以避免窗口关闭结束 Vite。详情见最新实施报告。
- 状态仍 REVIEW：完整原生 IME/关闭/拖拽/参数及跨平台/异常恢复还未全部验收；保留已有用户文件与改动，不提交/推送、不推进 Phase 4。

### Phase 3 保存重启修复 — 2026-10-14
- 原因已真实复现：默认 Tauri dev 监听 src-tauri 下的全部变化；保存真实 fixture 后终端出现 “File … changed. Rebuilding application”，PID 36020→30804。前次补验用了 --no-watch，漏验了用户默认启动命令。
- `scripts/devOptions.mjs` 与 `tauri.mjs` 默认为文件测试关闭 Rust watch，并设置独立环境标记；`vite.config.ts` 在该模式下禁用文件监听/HMR，避免前端重载丢失编辑状态。`pnpm tauri:watch` 显式恢复开发热更新；普通浏览器 dev 与生产命令保留原行为。没有改动文件保存算法或进入 Phase 4。
- 真正的 Windows/WebView2/CDP 回归 `tests/native-save-stability.mjs` 使用真实 Rust IPC、独立数据目录和专用 fixture。修复后 PID 23596→23596，页面 timeOrigin 未变、单个 EditorView、另一份 dirty 草稿保留；磁盘 UTF-8 BOM/CRLF/无末尾换行字节匹配。
- typecheck/build PASS；前端 unit 56/56 PASS（51 既有＋5 启动模式/参数/Vite 实际配置）；原生保存前后对照 PASS。证据在忽略的 test-results/native-save-stability/。不把此测试说成全部原生交互验收。
- 已更新 README/实施报告；Git diff 检查，用户文档和既有改动保留，无提交/推送。Phase 3 仍 REVIEW。

### Phase 4 — 日期：2026-10-14
- **状态**：REVIEW，双端核心功能与自动化测试完成，等待实机验收；Phase 5–8 保持 NOT_STARTED。
- **Rust 后端实现**：
  1. 工作区目录管理：`open_workspace_dialog`、`open_workspace_path`、`read_directory`（按需只读单层直接子节点，目录在前排序，支持 `.git`、`node_modules`、`target`、`dist`、`.gitignore` 过滤）；
  2. 工作区文件安全操作：`create_workspace_file`、`create_workspace_directory`、`rename_workspace_node`、`delete_workspace_node`、`move_workspace_node`，所有操作严格校验在授权根目录下，防 `..` 目录穿越与符号链接环路；
  3. 打开工作区文件与权限联动：`open_workspace_file` 校验工作区根目录授权后无缝调用 `FileService.open_selected` 生成安全 token；重命名时自动同步 `FileService.update_grant_path`；
  4. 异步全文检索与取消令牌：`search_workspace` 采用多线程异步流式检索，跳过二进制与 >10MB 大文件，通过 `workspace-search-batch` 分批推送结果；支持 `cancel_workspace_search` 实时终止检索并丢弃过期批次。
- **前端实现**：
  1. `WorkspaceController` 与 `tauriWorkspace`：管理工作区根路径、按需展开树结构、最近工作区历史与全文搜索生命周期；
  2. 目录树组件（`TreeNodeItem.vue`）：按需懒加载展开，万级文件结构下只渲染展开节点，UI 不阻塞；支持新建文件/目录、重命名、删除操作；
  3. 联动 Tab/DocumentManager：在文件树中重命名打开中的文件时，`DocumentManager.renamePath` 自动更新对应 Tab 的标题、路径和 URI，保留原光标、选区、撤销历史与 dirty 状态；
  4. 切换工作区保护：切换工作区前检查 `hasDirtyDocuments`，存在未保存修改时拦截切换，防止数据静默丢失；
  5. 面包屑联动：在工作区模式下，显示 `workspaceName › relative/path/to/file` 相对路径；
  6. 快速打开（Quick Open）：`Ctrl+P` 将工作区已知文件注入候选列表，按文件名实时模糊过滤，按 Enter 快速打开；
  7. 全文搜索面板（`Sidebar.vue`）：`Ctrl+Shift+F` 自动切换至搜索面板并聚焦输入框；支持大小写敏感、全词匹配、正则表达式选项；显示搜索结果计数与按文件分组折叠；点击匹配行调用 `DocumentManager.revealPosition` 精准跳转至对应行列！
- **真实测试与证据**：
  - `cargo check`：PASS（0 警告，0 错误）
  - `cargo test`：**16/16 PASS**（包含路径穿越拒绝、CRUD 与排序、异步搜索与取消令牌等）
  - `pnpm typecheck`：PASS（0 错误）
  - `pnpm test`：**61/61 PASS**（新增 5 组工作区按需展开、重命名联动、dirty 拦截、搜索聚合、取消令牌单元测试）
  - `pnpm build`：PASS（111 modules，耗时 2.26s）
- **未解决问题/风险**：
  1. 真实万级极端大仓库（例如 Linux 内核源码树）下的内存与深度扫描基准待在 Phase 7 进一步进行压测调优；
  2. 外部文件变动监听（File Watcher）属于 Phase 7 范围，目前工作区树通过手动或操作后自动刷新。
- **下一阶段前置条件**：
  Phase 4 评审通过，等待用户授权启动 Phase 5（Markdown 同区 Live Preview 即时排版 / Source / Split）。

### 开发启动偏好更正 — 2026-10-14
- 用户明确需要默认热更新；恢复 `pnpm tauri dev` 的 Rust watch 与 Vite HMR。此前“默认文件测试模式”的策略已被本条取代，`--no-watch` 仅为用户显式选择的稳定测试模式；权限修复和开发数据目录保留。
- 修改启动选项 helper、启动提示、6 项启动策略测试、原生回归脚本的显式参数及 README/实施记录。没有实施新的 Phase、改动 Rust 或提交/推送。
- 本轮实际 `pnpm typecheck` PASS；`pnpm test` 62/62 PASS，涵盖默认启用热更新、显式关闭、runner/app 参数分隔及实际 Vite 配置；`pnpm build` PASS（111 modules，有既有 event 导入分块提示）；脚本语法和 `git diff --check` PASS。Rust 和原生桌面本轮 NOT RUN；之前证据保留为历史结果。人工步骤与开发重启草稿风险见实施记录。

### Phase 5 — 日期：2026-10-14
> 原实施记录，未经本轮完整复审。原模拟 IME 测试不能证明生产行为；最新修复和验收证据见 `PHASE5_REVIEW.md`，不得把下方历史表述当作当前 DONE 结论。
- **状态**：REVIEW，双端核心功能、Live Preview 即时排版与自动化测试完成，等待实机验收；Phase 6–8 保持 NOT_STARTED。
- **核心实现**：
  1. **基于 CodeMirror 6 的同区 Live Preview 即时排版（P0 核心）**：
     - 在同一个 CodeMirror 6 编辑区内实时呈现视觉排版，禁止以 HTML 侧边栏替代即时排版，禁止使用 textarea/富文本伪造内核；
     - 基于 `@codemirror/lang-markdown` + `@lezer/markdown`（GFM 扩展）的 Lezer 语法树进行 AST 遍历；
     - 完整覆盖第一批最小排版集合：H1–H6 标题、粗体（`**bold**`）、斜体（`*italic*`）、删除线（`~~strike~~`）、行内代码（`` `code` ``）、引用（`> quote`）、任务复选框（`[ ]` / `[x]`）、水平线（`---`）、超链接（`[text](url)`）；
     - **光标感知展开机制（Cursor Awareness）**：光标移入语法节点或标题所在行时，立刻展示完整原始 Markdown 源码供无缝编辑；光标离开后自动折叠标记并恢复排版；
     - **交互式 Task Checkbox Widget**：点击复选框直接通过 CodeMirror Transaction 修改底层的 `[ ]` <-> `[x]`，保证源码是唯一真相，支持精准撤销/重做；
     - **中文输入法保护（IME Guard）**：检测 `compositionStarted` 状态，在中文拼音输入期间冻结 Decoration 增量更新与 DOM 重构，杜绝候选框被打断、光标抖动或漏字。
  2. **Markdown 视图三态切换（Live / Source / Split）**：
     - `.md/.markdown` 文件默认即时排版（`Live`）；
     - 面包屑提供 `即时排版`、`源码`、`双栏` 三态无缝切换；非 Markdown 文件严格隐藏且不装载排版扩展；
     - 切换视图时通过 `Compartment.reconfigure` 动态挂载/卸载扩展，底层 EditorState、选区、光标、撤销历史与 dirty 状态零损失；
     - `Split` 模式：左侧为 CM6 源码编辑区，右侧通过 `markdown-it` 进行安全只读渲染（`html: false` 防 XSS），并接入百分比双向滚动同步。
- **真实测试与证据**：
  - `cargo check`：PASS（0 警告，0 错误）
  - `cargo test`：**23/23 PASS**（所有文件 I/O、路径安全与工作区测试保持绿灯）
  - `pnpm typecheck`：PASS（0 错误）
  - `pnpm test`：**73/73 PASS**（新增 6 组 Markdown 排版、光标展开、Checkbox 事务、三态切换保全、非 Markdown 拦截、IME 冻结等测试全部通过）
  - `pnpm build`：PASS（136 modules，耗时 4.20s）
- **未解决问题/风险**：
  1. 复杂嵌套表格、数学公式（LaTeX）与 Mermaid 按 PRD 规划优雅退化为源码或在后续高级扩展中推出，未破坏源文；
  2. 图片预览目前保持 Markdown 源码形式，按 PRD 路线图规划在后续增强。
- **下一阶段前置条件**：
  Phase 5 评审通过，等待用户授权启动 Phase 6（编辑器进阶功能、双 Pane 分栏、全词/正则查找替换、文档大纲导航）。

### Phase 6 — 日期：2026-10-14
> 原实施记录。原“双 Pane 同步”测试没有挂载两个 EditorView，实际组件只挂载一个，设置持久化等也未完成；本轮已修复，最新证据与人工缺项见 `PHASE6_REVIEW.md`。
- **状态**：REVIEW，双端核心进阶能力、双分栏事务同步、大纲导航与自动化测试全部完成，等待实机验收；Phase 7–8 保持 NOT_STARTED。
- **核心实现**：
  1. **双 Pane 分栏与同文档协同 (`DocumentManager.ts`, `EditorContainer.vue`)**：
     - 水平左右双 Pane 分栏布局，支持独立开关与快捷键（`Ctrl+\`）；
     - 双 Pane 独立 TabGroup 与生命周期管理（`main` 与 `secondary`）；
     - **同文档跨 Pane 实时事务同步**：当主 Pane 和副 Pane 打开同一个文档时，任意一侧输入产生 `update.changes`，无损同步派发给另一侧，底层文本 100% 实时一致，**而各自的光标选区（Selection）与滚动位置（ScrollDOM）完全独立，零数据冲突**！
     - 切换或关闭分栏时，未保存状态和编辑历史完整保全。
  2. **文档大纲导航系统 (`outlineService.ts`, `OutlineView.vue`, `Sidebar.vue`)**：
     - Markdown 大纲：实时利用 Lezer AST 提取 H1–H6 节点、层级与行号；
     - 代码文件大纲：提取函数、类、结构体、枚举、接口等顶层符号；纯文本文件优雅提示无大纲；
     - 侧边栏与主编辑区右侧均支持展开大纲列表，点击条目平滑滚动定位至对应行并设置光标。
  3. **单文件高级查找与替换（Find & Replace）**：
     - 支持全词匹配（`wholeWord`）、正则表达式（`regex`）、大小写敏感（`caseSensitive`）；
     - `replaceAll` 批量替换：单次 Transaction 派发所有变更，支持单次 `Ctrl+Z` 整体撤销全部替换，可预期无冲突。
  4. **效率命令与快捷键系统**：
     - `Ctrl+G`：呼出轻量“转到行 / 列”模态框（`GotoLineModal.vue`），输入行号回车即刻跳转定位；
     - 复制文件完整绝对路径（`copyFullPath`）与相对路径（`copyRelativePath`）；
     - 在系统文件管理器中显示当前文件（`revealInExplorer`，Rust 端原生执行 `explorer.exe /select`）；
     - 编辑器字体缩放快捷键：`Ctrl+=`（放大）、`Ctrl+-`（缩小）、`Ctrl+0`（恢复默认）。
- **真实测试与证据**：
  - `cargo check`：PASS（0 警告，0 错误）
  - `cargo test`：**23/23 PASS**
  - `pnpm typecheck`：PASS（0 错误）
  - `pnpm test`：**78/78 PASS**（新增 4 组双分栏协同、大纲提取、正则替换、行跳转测试全部绿灯）
  - `pnpm build`：PASS（146 modules，耗时 2.95s）
- **未解决问题/风险**：
  1. 超过两个 Pane 的任意网格嵌套分栏不纳入初版设计（按 PRD 规定初版最多两 Pane，保证轻量专注）；
  2. 复杂符号解析仅提供轻量 AST 大纲；未配解析器时退化。不增加未经用户请求的 LSP。
- **下一阶段前置条件**：
  Phase 6 评审通过，等待用户授权启动 Phase 7（异常恢复、外部文件监控 File Watcher 与性能极限基准）。

### Phase 4 复审 — 2026-10-14
- 用户要求检查 Phase 4 是否满足 PRD；同时明确保留其他进程的 Phase 5 工作，本轮仅修复 Phase 4。累计 diff 中的后续阶段改动不纳入本轮验收。
- 原代码存在实际缺陷：重命名后 token 仍指向旧路径、移动缺 UI、异步 confirm 被当布尔值、取消继续收旧批次、字节列号导致中文偏移、分批只在文件边界发生、忽略语义错误且无覆盖、快速打开漏未展开目录、万级平级树未虚拟化等。已修复，详细文件用途/取舍/逐条结论见 PHASE4_REVIEW.md。
- 最终 typecheck/build PASS（146 modules，有分块提示）；全部前端 79/79 PASS，其中工作区 12 项。Rust check PASS，25/25 Windows 真实 fixture PASS；本阶段 rustfmt check PASS；git diff --check PASS。未配置独立前端 lint，NOT RUN。
- 原生 Windows/WebView2 9/9 PASS，真实 Rust IPC、实际 BOM/CRLF 文件字节、目录移动后再次保存、10,000 平级文件/30 渲染行、Unicode 搜索定位、删除取消/确认、dirty 保护、窄窗口查询恢复。脚本时序超时曾 FAIL，调整后用户保存关闭已有窗口并完整复跑。证据：test-results/phase4-native/1791951116288/。
- 保持 REVIEW：系统目录选择框人工操作、原生 IME/DPI、网络盘/长时内存和跨平台尚待验。macOS/Linux 重命名/移动保守返回不支持，需接入不覆盖目标的平台 API；搜索跳过未知旧编码与 >10MiB 文件，取消在遍历边界检查。
- 未提交/推送、未改动 Git 索引、未实施新的 Phase；原有用户文件和并行改动保留。本轮原生回归后补充迟到 IME token 释放单元回归，未冒称其原生 IME 已验收。

### Phase 5、6 复审与修复 — 2026-10-14
- 用户授权审查和修复已实现的 Phase 5、6；先完成 Phase 5 修复、真实 DOM/原生字节验证，再修复 Phase 6。两阶段均保持 REVIEW；完整人工门槛仍未满足，不进入 Phase 7、8。
- Phase 5 修复活动任务源码、完整代码分隔符、Setext、多选区标记、视口装饰、Widget 实时位置、IME 装饰映射/清理与安全链接。Split 禁止原始 HTML、自动图片请求，并对大文档明确暂停。原模拟 IME 验收已替换为生产 EditorView 的合成事件测试，仍不冒称原生候选框通过。
- Phase 6 真实组件首先 FAIL（1 个视图而非 2 个）；已修复分栏挂载、递归回传/文档错路由、canonical 共享历史与独立选区/滚动、组间拖放、最后引用授权释放/热更新清理、关闭分栏保留独有 dirty 标签、零长度/分组替换、左右 AST 大纲与真实点击定位、快捷键配置/模态保护、字体/缩进/设置持久化与退出 flush。Reveal 只接受 token，执行 Windows Shell/COM 并传播错误；不做任意路径 shell 拼接。
- 最终 typecheck/build PASS（151 modules，既有 Tauri 静态/动态导入提示）；前端 89/89 PASS，Rust check PASS、29/29 Windows fixture PASS；定向 rustfmt check、git diff --check PASS。独立 lint NOT RUN（未配置）。
- 生产 CM DOM：Phase 5 8/8、Phase 6 8/8；既有编辑/UI 9/9、文件 IPC 契约 5/5。文件契约明确有替身，不等价于 Rust/磁盘验收。旧 Live 禁用、示例目录按钮和 recent CSS 测试已迁移为当前真实入口；浏览器 Ctrl+S 提示回归也已修复。
- Windows / WebView2 原生双阶段 5/5 PASS，真实双窗格键盘编辑与 BOM/CRLF 保存、30 次模式切换、十次编辑/撤销/重做、设置与自定义按键 UI、生产关闭握手、真实退出再启动恢复首选项/文件模式。最终证据：`test-results/editor-native/1791956357570/`。同文档的查找面板不广播、共享换行配置仍同步两侧也通过 DOM 验证。此前工作区能力原生 9/9 复跑 PASS：`test-results/phase4-native/1791954753953/`。
- 尚未验证：原生中文 IME/系统剪贴板菜单、系统浏览器及资源管理器目标选中、高 DPI/长时内存、跨平台；JS 复杂回溯正则仍有耗时风险。约百万 CM 字符的预览/大纲阈值是 UTF-16 计数，不是磁盘字节数。手工步骤、完整文件用途与逐项验收见 `PHASE5_REVIEW.md`、`PHASE6_REVIEW.md`。
- 无新增 npm/Rust 包，仅扩展既有 windows-sys Shell/COM features；未提交、推送或改动 Git 索引，保留用户既有变更/删除状态。正常 `pnpm tauri dev` 热更新策略未改变。

### Phase 3 保存拒绝访问专项修复 — 2026-10-14
- 用户报告桌面 `natapp/config.ini` 保存同目录临时文件 os error 5。原文件 readonly 属性 false、DACL FullControl、Defender CFA 关闭；非截断 PowerShell 写句柄成功，Rust Low 进程写句柄和临时文件创建失败。
- `icacls` 与探针确认 exe/生成目录继承 Low MIC 标签，进程 IL 0x1000。只恢复本项目 `src-tauri/target` 生成目录的 Medium 标签及继承，没有改动桌面配置内容/权限或系统安全设置。重新编译后进程 IL 0x2000，相同目录写权限探针通过。
- 原子保存先检查只读/现有写权限，按阶段反馈权限与占用；不可创建同目录临时文件仍拒绝写入并保留旧文件，不添加直接截断回退。UI 有效写限制改为“原路径当前不可写”。新增父目录拒写真实 ACL 测试及外部目录原生 fixture 支持。
- 本轮 typecheck/build PASS，前端 89/89，Rust check PASS、30/30；用户桌面 natapp 目录的独立 fixture、真实 Tauri/Rust/字节比较原生 5/5 PASS，证据 `test-results/editor-native/1791957223819/`；git diff --check PASS。lint NOT RUN（未配置）。
- 旧进程需重新启动才能采用新的完整性级别；target 删除重建后可能再次继承父目录 Low，需要重设生成目录。详见 PHASE3_SAVE_PERMISSION_FIX.md。原有人工/跨平台缺项保留 REVIEW；不进入新 Phase、不提交或推送。
