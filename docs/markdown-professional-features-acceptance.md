# Markumo Markdown 专业编辑能力增强工程 · 综合验收报告

> 本报告只记录有证据支撑的结论。状态分为四类：
>
> - **已实现且验证**：有代码，且有自动化测试或可复现命令作为证据。
> - **部分实现**：核心路径可用，但存在明确列出的缺口。
> - **尚未验证**：代码存在，但没有在本仓库环境中执行过对应验证（例如需要 Word/LibreOffice 的场景）。
> - **已知限制**：按设计不支持，或受外部条件限制。
>
> 本次审查基线为 `38a69c9`，复核于 HEAD `fe51ae4` 之后的修复提交。结论以当前实际代码为准，不以本文件历史陈述为准。

## 一、状态总览

| 编号 | 功能 | 级别 | 当前状态 | 主要证据 |
| --- | --- | --- | --- | --- |
| P0-1 | Callout 原生结构化编辑 | P0 | 已实现且验证 | `scripts/callout-regression.mjs`（6 项，含源码往返、类型切换、撤销） |
| P0-2 | TOC 原生动态目录 | P0 | 已实现且验证 | `scripts/toc-regression.mjs`（6 项）＋本轮 `tocIndex.ts` 有界缓存 |
| P0-3 | 脚注定义原生编辑与双向导航 | P0 | 已实现且验证 | `scripts/footnote-regression.mjs`（6 项）＋`scripts/repair01-regression.mjs` 第 8–10 项 |
| P0-4 | 图片编辑与属性持久化 | P0 | 已实现且验证 | `scripts/repair01-regression.mjs` 第 5–7 项（20 种宽高/对齐往返、重开、模式切换） |
| P0-5 | 文档内容注入防护 | P0 | 已实现且验证 | `scripts/repair01-regression.mjs` 第 1–4 项 |
| P0-6 | 历史版本本地持久化 | P0 | 部分实现 | Rust 13 项单测 + `scripts/repair02-regression.mjs`（8 项）；**未做**真实桌面端跨进程重开验证 |
| P0-7 | 原生 DOCX 导出 | P0 | 部分实现 | `scripts/repair03-regression.mjs`（12 项结构校验）；**未做** Word/LibreOffice 实际打开验证 |
| P1-8 | 大纲整节拖动源码保真 | P1 | 已实现且验证 | `scripts/repair04-outline-regression.mjs`（11 项，逐字节比对） |
| P1-9 | Front Matter 解析与安全更新 | P1 | 部分实现 | `scripts/frontmatter-regression.mjs`（4 项）；复杂 YAML 明确降级为源码编辑 |
| P1-10 | 裸 URL 增量编辑 | P1 | 已实现且验证 | `scripts/autolink-regression.mjs`（14 项） |

## 二、本轮修复内容（按提交）

### Repair 01 · `fix(markdown): 修复文档内容注入、脚注导航与图片属性持久化`

**注入风险（原为真实 XSS）**

- `FrontMatterCard.ts` 曾把 YAML 的 `status` / `created` 直接拼进 `innerHTML`；`FootnoteDefNodeView.ts` 曾把脚注 label 拼进 `innerHTML`。恶意文档可执行脚本。现全部改为 `createElement` + `textContent`。
- 新增 `safeDom.ts`：`setStaticIcon` 只接受标签与属性白名单（拒绝 `script/iframe/object/foreignObject/use/a`、`on*`、未知属性），Callout / TOC / Front Matter 的固定 SVG 统一走该入口，**用户文本与固定模板彻底分离**。
- `MarkdownSerializer.ts` 的受控 `<img>` 改用 `escapeHtmlAttribute` 转义，`width`/`align` 走白名单（`auto | N% | Npx` / `left|center|right`）。修复前 `src="x" onerror="alert(1)"` 可直接逃逸出属性。

**图片属性持久化闭环**

- 新增 `imageHtml.ts`：`parseControlledImageHtml` 只识别本编辑器写出的那一种 `<img>`，仅允许 `src/alt/title/width/align`；任何额外属性（含事件属性、`style`）继续作为受保护源码。
- `MarkdownParser` 据此将其重新解析为**可编辑 image 节点**。修复前，调整尺寸后保存重开会变成不可编辑的原始 HTML，工具栏消失、属性丢失。

**脚注双向导航**

- 引用点击原先在 `protected_source` 文本里搜索，现统一走 `MarkdownEditorController.footnoteDefinitionPosition` 的节点映射；缺失定义给出明确提示，不虚构定义、不写入正文、不产生撤销步骤。

### Repair 02 · `fix(history): 用受控 Rust 持久化替换 localStorage 历史版本`

- 新增 `src-tauri/src/history.rs`：独立 `history` 目录（与 Crash Recovery 分离）、SHA-256 内容寻址去重、索引只存元数据、原子写入（临时文件 + fsync + rename）。
- 配额：单快照 8 MiB、单文件 40 版、总量 192 MiB；超限按最旧优先清理并通过 `warnings` 回报，写失败向上抛出，不静默吞掉。
- 安全：文件键是路径摘要且**从不参与 I/O**；对象名与版本 id 校验字符集，无任意路径读写。索引损坏则另存备份并重建。
- 前端 `historyService` 改为 IPC 客户端：列表只返回元数据、正文按需读取、失败即报错；`recordVersion` 区分 `disk`（保存前磁盘版本）/`saved`（刚写入）/`manual`（手动）。
- `FileController` 在写入前记录 `getBaselineText()` 的磁盘版本，保存成功后再记录新版本——两者语义不再混为一谈。
- `HistoryDialog` 重写为按需加载、来源标签、恢复前创建「恢复前保护点」、失败即中止；并接入文件菜单「历史版本…」（**此前该面板没有任何入口，属死代码**）。
- 旧 `localStorage` 历史一次性迁移，迁移成功才删除旧键。
- Diff 改为先裁剪公共前后缀、再在窗口内做 LCS，超大文档降级为块级差异。

### Repair 03 · `fix(export): 补全原生 DOCX 导出结构与可验证性`

- 真正的 Word 列表：`word/numbering.xml`（abstractNum/num + 九级 lvl），段落带 `w:numPr`/`w:ilvl`。
- 真正的超链接：为绝对 HTTP(S)/mailto 目标生成 External relationship + `w:hyperlink r:id`；相对目标降级为文本并警告，不产生坏关系。
- 图片：签名识别 png/jpeg/gif/bmp → `word/media` + relationship + `w:drawing`；受 64 MiB 媒体预算与 120 张上限约束，超限降级为替代文字并警告。
- 标题写 `outlineLvl` 与 bookmark；`[toc]` 生成可跳转标题列表；Callout 输出主题色边栏提示块；脚注以文末编号列表导出；KaTeX/Mermaid 以源码/等宽降级——以上均产生显式 warning。
- 取消（AbortSignal）、64 MiB 文档上限、失败不落半成品。
- 返回 `{ bytes, warnings, stats }`，导出路径逐条提示警告；保留 Pandoc 通道。

### Repair 04 · 大纲保真、YAML 安全、TOC 性能、CI 与验收

- `outlineReorder.planOutlineMove` 返回**最小 delete/insert 变更**（不再整篇替换），保留 LF/CRLF、尾部换行状态、Front Matter、代码围栏；无末尾换行文件不新增换行；跨层/自身移动拒绝；`OutlineView` 单事务应用并恢复选区。
- `frontMatterParser` 重写为「只往返它能精确表达的子集」：识别锚点、别名、自定义标签、块标量、流式集合、制表符、重复键；命中即 `editable: false`，卡片只显示原文与「编辑源码」入口，**不再静默重排 YAML**。字段更新只替换值区间，保留注释、顺序、引号风格与 CRLF。
- `tocIndex.ts`：按文档标题结构签名的共享有界缓存（最多 4 条），TOC 节点复用同一次扫描；`TocNodeView` 增加渲染签名，相同标题列表不再重建 DOM。
- `run-regressions.mjs` 的 `FULL_REGRESSION_TESTS` 补齐此前**只进 SMOKE、未进全量**的 15 个套件（八项功能 + 拖放/独立窗口/裸 URL + 四个 Repair 套件）。

## 三、质量门禁与测试结果（本机实测）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | 通过 |
| 生产构建 | `pnpm build` | 通过（`built in ~20s`） |
| Rust 单元测试 | `cargo test --manifest-path src-tauri/Cargo.toml history` | 13 passed / 0 failed |
| Rust 全量 | `cargo test`（172 项基线） | 通过（需将 `TEMP` 指向可写目录，见下） |
| 裸 URL | `node scripts/autolink-regression.mjs` | 14/14 |
| Repair 01 | `node scripts/repair01-regression.mjs` | 10/10 |
| Repair 02 | `node scripts/repair02-regression.mjs` | 8/8 |
| Repair 03 | `node scripts/repair03-regression.mjs` | 12/12 |
| Repair 04（大纲） | `node scripts/repair04-outline-regression.mjs` | 11/11 |
| Callout | `node scripts/callout-regression.mjs` | 6/6 |
| TOC | `node scripts/toc-regression.mjs` | 6/6 |
| 脚注 | `node scripts/footnote-regression.mjs` | 6/6 |
| Front Matter | `node scripts/frontmatter-regression.mjs` | 4/4 |
| DOCX（旧套件） | `node scripts/docx-regression.mjs` | 4/4 |
| Split 预览 | `node scripts/split-preview-regression.mjs` | 4 组全通过 |
| Live 控制器 | `node scripts/markdown-live-controller-regression.mjs` | 21/21 |

**CI 门禁核对**

- `.github/workflows/quality.yml` 的 `Browser Smoke` 作业执行 `pnpm test:smoke`（带 `set -o pipefail`），**未设置 `continue-on-error`**：任一冒烟用例失败会使该 job 失败，因此是阻塞门禁。
- 同一作业另有 `--repeat=3` 的稳定性复跑（split / toolbar / 虚拟化 / 数学）。
- 全量回归此前**缺少**八项功能的套件，本轮已在 `FULL_REGRESSION_TESTS` 补齐。

**关于测试超时**

`markdown-live-toolbar-regression.mjs` 中的 `timeout: 30000` / `60000` 属该文件既有实现（提交 `995c954`、`f288f6d`），不是本轮引入，且该文件当前有他人未提交改动，本轮未改动。核对结论：

- `settingsReady` 的 30s 是**应用外壳整体水合的启动预算**（CI 冷启动需预构建 Vite 依赖），属性能预算。
- `liveReady` 的 60s 出现在「切换编辑模式」之后，确实是宽松值；但由于断言本身必须在预算内成立，初始化失败或懒激活死锁仍会使作业失败，**不构成对功能缺陷的掩盖**。
- 建议后续单独提交把 `liveReady` 收紧到 15s，并附一次实测；本轮不做，以免与他人未提交改动冲突。

## 四、尚未验证与已知限制

**尚未验证（需外部环境）**

1. **DOCX 在 Word / LibreOffice 中实际打开**：本机未安装 Office 或 LibreOffice，未执行真实打开、分页与目录 F9 更新验证。已完成的是解包级结构校验（OOXML 良构、Relationships、numbering、media、drawing、表格、书签、正文完整性）。Pandoc 高级导出通道未在本轮回归中执行。
2. **历史版本的跨进程重开**：Rust 侧有 13 项单测覆盖存储语义，前端有 mock IPC 的契约测试；但未在真实 Tauri 桌面进程中执行「保存 → 关闭 → 重开 → 查看历史」的端到端流程。
3. **WebView2 下的 IME 组合过程**：裸 URL 自动链接在组合期跳过由 `this.composing` 保护，但未做录屏级验证。

**已知限制**

1. **Front Matter**：不引入 YAML 库。锚点、别名、标签、块标量、流式集合、制表符缩进、重复键一律判定为不可可视化编辑，回退到源码编辑。这是刻意的保守选择：宁可少改，也不静默重写用户 YAML。
2. **DOCX**：TOC 无页码（需 Word 分页）；脚注以文末编号列表表示，不是 Word 原生脚注（原生 `footnotes.xml` 与正文引用编号的对应尚未实现）；KaTeX/Mermaid 以源码导出；相对路径图片不嵌入。以上都会在导出时逐条提示。
3. **历史版本**：`MAX_WINDOWS` 之外的多窗口并发由单一存储锁串行化；超大文档（> 8 MiB）不记录历史版本，只提示。
4. **裸 URL**：无分隔符紧邻中文时，linkify（与 GFM、右侧预览一致）把中文并入 IRI，`href` 做百分号编码；保证 `decodeURI(href)` 等于显示文本、源码保持裸 URL、三种模式一致。
5. **大纲拖动**：只支持同一父级内的移动语义校验（跨层移动被拒绝），不支持跨文件拖动。

## 五、复现方式

```bash
pnpm typecheck
pnpm build
node scripts/run-regressions.mjs --smoke          # 冒烟（CI 门禁同款）
node scripts/run-regressions.mjs --full           # 全量（含本节新增 15 个套件）
cargo test --manifest-path src-tauri/Cargo.toml    # Windows 若遇 TEMP 权限问题，先将 TEMP/TMP 指向可写目录
```

浏览器套件默认使用系统 Edge/Chromium；CI 使用 Playwright 自带 Chromium。
