# Markdown WYSIWYG 验收报告 — 2026-10-15

当前状态：**REVIEW，核心重构可运行，尚未达到全部人工完成门槛**。六个内部阶段已连续实施，不请求逐阶段授权，也没有进入通用 Phase 7/8。

开始/结束 HEAD：`25d1a640a60e826692b2510dd8fcae9655ae20c9`。工作树保留原 Logo、菜单、视觉和打包等未提交修改，加本次源码/依赖/测试/文档。没有提交、推送、安装或发布。完整文件用途见 `MARKDOWN_WYSIWYG_ARCHITECTURE.md`；保真契约见 `MARKDOWN_SOURCE_PRESERVATION.md`。

## 真实命令与证据

| 命令/项目 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS，TS/Vue/Node 配置与测试类型 |
| `pnpm test` | PASS，25 文件、258/258；新增 WYSIWYG 模型 13 项 |
| `pnpm build` | PASS；独立运行及最终 package 的 beforeBuild 都实际执行，2290 modules |
| `cargo check --manifest-path src-tauri/Cargo.toml --offline` | PASS；仅环境硬链接缓存复制警告 |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline` | PASS，84/84（含新增排版设置持久化/范围测试） |
| `node tests/editor-browser.mjs` / `node tests/markdown-click-ui.mjs` / `node tests/markdown-wysiwyg-ui.mjs` | 已迁移到同一生产行为驱动；最终 9/9，含 40 个真实字形点击位置、逐次精确源码/Undo；0 pageerror |
| `node tests/markdown-wysiwyg-native.mjs` | PASS，Windows Tauri/WebView2 6/6：5 组真实 Rust/磁盘/图片 + 1 组受控剪贴板 provider 的应用路由，0 pageerror |
| `node tests/markdown-wysiwyg-performance.mjs` | PASS，真实 Edge、懒加载边界/性能/销毁/GC 样本 |
| `node scripts/package.mjs --skip-install` | PASS，最终前端 + Rust release + NSIS；未安装/发布 |
| `git -c core.safecrlf=false diff --check` | PASS |
| 独立 lint | NOT RUN，仓库没有 lint 配置/命令 |
| 原生微软拼音候选/提交/替换、真实系统图片剪贴板/拖放/选择框、高 DPI、macOS/Linux、长时 RSS、安装/卸载 | NOT RUN，本轮没有用合成事件/浏览器截图冒称通过 |

浏览器证据：`test-results/markdown-wysiwyg/results.json`、`performance.json`、`live-document-light.png`、`live-document-dark.png`。通过实际正文编辑、键盘、DOM 选择与剪贴板事件验证，不以截图替代编辑。

原生最终证据：`test-results/markdown-wysiwyg-native/1792050176892/results.json`、`native.png`、`tauri.log`，只操作该目录下独立 profile、Markdown 与 PNG。6 组依次覆盖：

1. 原生打开/三模式/no-op 保存，磁盘含 BOM 的 Buffer 完全一致。
2. PM 标题/表格/嵌入代码编辑，实际 Ctrl+S 走 Rust，保存 BOM/CRLF 与内存 snapshot 完全一致。
3. Live 修改、Source Undo、Live Redo、dirty 关闭拒绝。
4. 授权 Rust 图片读取/Blob 解码、远程不自动请求、替代文字局部修改/Undo。
5. 外部修改测试 fixture 后保存拒绝，磁盘 Buffer 不变、Live dirty 内容保留。
6. 嵌入代码块通过真实应用 Ctrl+V 路由粘贴 `**literal paste** | 中文`，保持代码纯文本并正确 Undo。该组明确使用受控文本/图片剪贴板 provider，不读写用户系统剪贴板，不等同系统剪贴板验收。最终审查修复了旧主 CM 身份检查误拒绝嵌入代码粘贴，以及 Live 构造失败回退失效。

首次环境失败也保留：沙箱默认网络解析失败后在正常权限下载依赖；沙箱 Edge 启动失败/跨沙箱本地连接超时后使用独立正常权限回环服务。首次 Rust 为 60/83，重定向 TEMP 到仓库 fixture 后 80/83，剩余三项是沙箱不允许创建硬链接/联接；正常权限执行后全部通过，最终加设置测试 84/84。没有降低文件安全断言。

开发服务曾对首次延迟依赖预优化触发重载，导致扩展测试失败；现显式预优化依赖。测试目录被忽略监听，因此生成唯一 TS fixture 文件名，避免读旧 Vite 缓存。模型/浏览器还发现并修复文本节点 attrs、链接点击/浮层、引用定义前空白累积、表格反斜杠管道符与语言围栏边界。没有把这些中间失败计为通过。

## 用户验收条款映射

| 条款 | 当前证据/限制 |
| --- | --- |
| 1–2 标题/粗体点击稳定 | 真实 PM 节点；正文键盘编辑/40 字形点击，无整段标记展开 |
| 3 链接局部改 URL | 浏览器真实点击/属性输入/源码验证；键盘进入链接自动浮层尚缺 |
| 4–7 单元格、无整表源码、Tab/行列 | 真实 tableEditing/键盘/工具栏/精确 Undo；鼠标矩形选择依赖官方插件，完整系统剪贴板矩阵仍需人工 |
| 8–12 代码块/围栏/行号/语言/复制 | 嵌入 CM 实际输入与共享 Undo，行号从 1，语言/复制已测；系统剪贴板目标粘贴需人工 |
| 13 图片直接显示和操作 | 原生授权 PNG/属性/Undo 通过；系统图片导入入口复用，截图/原生拖放/选择框需人工补验 |
| 14 列表自然续写 | Schema-list/inputrules/真实任务事务已实现；复杂嵌套、空项及引用连续边界需要完整人工验收 |
| 15 连续中文 IME | NOT RUN；合成 composition 只验证禁止保存/切模式保护 |
| 16–18 撤销、多 Pane、模式不丢内容 | 浏览器真实编辑、共享历史及 30 次三模式；原生跨模式 Undo/Redo |
| 19–21 no-op 字节、无关块、BOM/编码/CRLF | 模型逐块/单元格保真 + 原生 BOM/CRLF Buffer；其他编码/混合 EOL 走原完整 Rust 回归 |
| 22–24 默认关闭自动保存、脏关闭、外部冲突 | 默认设置/AutoSave/FileController 单元 + 原生 dirty/conflict；文件安全算法未替换 |
| 25 长文点击位置 | 40 DOM 字形坐标真实点击，精确比较插入源码再 Undo；不使用 CM/PM 坐标 API 生成预期 |
| 26 深浅主题 | 实际 body.light/深色文档截图及目视；Windows 原生 DPI 仍需人工 |
| 27 非 Markdown CM | 浏览器 TXT 实际 CM、网络请求不含 PM/KaTeX/Mermaid |
| 28 销毁/泄漏 | 60 次标签切换、只剩 1 个当前编辑器、dispose 后 PM/CM 为 0，GC 后堆下降；不冒称长时原生 RSS 已验收 |
| 29 无图钉 | 生产 TabBar 删除、DOM 无 pin-icon；右键固定/取消固定保留 |
| 30 块间键盘 | 代码边界箭头/Mod+Enter、表格 Tab、PM 基础导航已接入；完整 Windows 手动矩阵待验 |

## 性能和体积

Edge headless，1280×900，开发服务单次本机样本。`performance.json` 是测量原值；不是跨平台 SLA。

| 项目 | 实测 |
| --- | --- |
| TXT 首次页面导航到 CM | 215.6 ms；未请求 ProseMirror/KaTeX/Mermaid |
| 首次打开综合 Markdown | 147 ms |
| 102400 UTF-16 字符 / 112996 UTF-8 字节 Markdown | 加载 129.9 ms；30 次事务中位数 2.0 ms / P95 4.8 ms；编辑器 DOM 身份不变 |
| 1200000 字符 Markdown | 131.5 ms，明确 Source 回退，内容完整 |
| 1000 行代码块 | 加载 32.2 ms，插行事务 5.4 ms，变成 1001 行 |
| 101 行表格连续 100 次输入 | 加载 20.1 ms；事务中位数 0.7 ms / P95 1.5 ms |
| 60 次标签切换及 dispose | dispose 前 1 个 Live，之后 PM/CM=0；CDP GC 堆 28,230,884→11,800,872 字节 |

开始时 `dist/assets` 已有 20 文件、1,356,550 字节；最终 137 文件、5,995,160 字节（含按需图表代码与 KaTeX 多格式字体），增加 4,638,610 字节。Live 控制器包约 281.79 kB（gzip 87.83 kB），只在 Live 动态加载；KaTeX 259.05 kB、Mermaid core 590.68 kB 均按需。存在 >500k 图表 chunk 警告，没有通过抬高阈值隐藏；后续可评估限定图表类型/字体格式以压缩发行体积。

本轮开始时已有 Logo 版安装包历史记录为 3,695,344 字节（3.52 MiB）；最终本地 NSIS 为 **5,514,037 字节（5.26 MiB）**，增量 1,818,693 字节（约 1.73 MiB）。路径 `src-tauri/target/release/bundle/nsis/LightEdit_0.1.0_x64-setup.exe`。没有运行安装/卸载或发布 Release。中间一次构建出现 bundle marker 写入占用警告，最终构建正常写入；最终仍有既有 bundle identifier `.app` 和 Tauri 静态/动态导入分块提示。

## Windows 人工步骤与未完成门槛

1. 在工作区打开 `tests/fixtures/markdown-wysiwyg.md`；依次点击标题、强调、表格、代码，连续编辑，确认没有整块标记闪烁。代码行号从 1，Tab 缩进/Shift+Tab、末行边界导航、复制到临时草稿。
2. 表格最后单元格 Tab 增行，Shift+Tab 反向，行列增删、左右/居中对齐、右键工具和鼠标矩形选择；复制/粘贴多单元格、中文、转义管道符、空格与空单元格。
3. 使用真实微软拼音，在正文、标题、任务、单元格、嵌入代码中连续选候选、替换选区；组合期间尝试保存/切模式，完成后重试。合成测试不能代替本项。
4. 测试系统截图粘贴、本地图片 Drop、文件选择框，改全局/文档图片目录，相对路径/替代文字/删除/失败占位/远程确认。重命名、移动、另存为后确认资源刷新。
5. 两 Pane 同文档交替输入、独立选区与滚动、跨模式撤销/重做；打开未修改文件并切模式保存，用外部工具逐字节比较；外部改盘后保存应拒绝。
6. 125%/150% Windows DPI、真实触控板、明暗主题、长时内存；安装/卸载与 macOS/Linux 尚未验收。

未实现/限制：Live 没有多光标；查找/替换明确转 Source；字符级模式位置映射是近似；脚注自动编号/回链、完整 Callout 内联富格式、完整相对单文件链接授权对话框、复杂 HTML/合并表格没有完整富文本实现。修改一个受支持顶层子树可能规范化该子树的语法，保真保证不扩张为“所有修改都全字节保留”。

旧 CM decoration 的模型测试保留；原 `editor-browser`/`markdown-click-ui` 产品入口已迁移，历史 DOM 驱动留在 `tests/legacy`。其他历史专项端到端脚本（如旧图片/UX/native 综合脚本）仍含旧 Live DOM 选择器，本轮未将其结果冒充新内核验收；应继续迁移或改为 Source/隔离模块回归，不能把它们的历史 PASS 当成当前 PASS。

综合结论：可以评审真正的正文、表格和代码原位编辑；当前仍为 REVIEW，**不是全部需求 DONE**。后续优先完成真实中文 IME、系统图片入口和键盘/选区人工矩阵，再解决更细的内嵌来源保真与扩展富格式，不擅自推进产品 Phase 7/8。
