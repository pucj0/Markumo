# Markumo Phase 07 — 最终质量验收与性能治理

日期：2026-10-20，Asia/Shanghai。仓库：https://github.com/yuanmahome/Markumo。

**结论：C — Not Ready。** 已修复大 Markdown 历史同步的实际性能缺陷及 Mermaid 图表 DoS。开发工具链依赖审计、严格静态检查仍失败；目标平台桌面、隔离安装升级和受信任签名等验证不完整，当前不能放行 RC。

## 1. 基线、人工前提与工作树

- 分支 `main`；HEAD / 已人工通过的 Phase 06.2 Commit：`503153b849411a99938e0ed180804656b13f2be5`。
- 用户在本聊天明确确认“已审查通过，以此提交为基线”，之后才开展正式 Phase 07。
- 本阶段修改尚未提交。修复依据为 diff、红/绿日志和 `test-results/phase07/summary.json` 的文件 SHA-256 清单；没有可虚构的 Phase 07 修复 Commit。
- 三处既有用户修改保留：`src/editor/languages/index.ts`、`ExportAppearance.ts`、`ExportStyles.ts`。其 LF 规范化内容均等同于基线，未覆盖或回退。
- 未修改版本号、创建 Tag/Release、推送、执行安装器或真实自动更新。版本仍为 1.0.4。

环境、工作树、脚本与产物清单见本地忽略目录 `test-results/phase07/` 中的 `environment.json`、`inventory.json`、`summary.json`。大型原始资料不加入 Git；本报告、功能矩阵和统计表为可提交交付物。

## 2. 环境与测试层级

| 项目 | 实际环境 |
| --- | --- |
| Windows | Windows 11 家庭版中文版 10.0.26200，x64 |
| CPU / 内存 | i5-12600KF，10 核 / 16 线程；68,520,194,048 字节物理内存 |
| 磁盘 | ZHITAI TiPlus5000 1TB、WD_BLACK SN7100 2TB SSD；未实测 IOPS |
| 工具链 | Node 22.2.0、pnpm 12.11.2、Rust/Cargo 1.99.0 |
| 转换 | 官方 Pandoc 3.8.3、真实 Windows WebView2 PDF |
| 组件测量 | 系统 Chrome，版本写入结果；Vite production 构建的实际编辑器/媒体组件 |
| 桌面测量 | release、真实 WebView2、实际 AppShell、CDP 附加；独立应用 ID 和用户目录 |
| Linux / macOS | 本机 Docker Engine 不可用，无可用 macOS 环境；本阶段新代码桌面测试 Not Tested |

组件宿主直接导入实际实现，媒体/工作区 IPC 使用 fixture transport。它验证真实组件与控制器，不能证明原生对话框或所有平台通过。桌面探针使用 `com.markumo.phase07-audit` 和独立 appDirectoriesOverride/WebView profile，不读取正式用户目录。测试专用 exe 与生产配置 exe 分开保存。

## 3. 七阶段成果复核

| 阶段 | 实际实现 | 本阶段证据 |
| --- | --- | --- |
| 01 | Quality Gate、限量日志与回归运行器 | 工作流及完整自动化 |
| 02 | 命令注册、菜单投影、快捷键和设置迁移 | settings-keybindings |
| 03 | DesktopStartup、监听器作用域、关闭保护 | shell-lifecycle、真实桌面启动 |
| 04 | canonical CM 状态、保存快照、分栏与媒体状态 | document-manager、file-save |
| 05 | Live Controller、源码桥、工具栏和子编辑器 | 完整 Live 回归、markdown-undo |
| 06 | 文件/工作区授权、版本、会话和更新租约 | Rust、workspace、updater |
| 06.1 | 媒体身份、ctime/边缘采样、分块读取 | 原生媒体测试、media |
| 06.2 | ConversionLease、受控 staging 与提交 | conversion、真实 Pandoc/PDF |

本表说明当前代码及复核入口，不替代历史阶段的人工结论。

## 4. 功能验收矩阵

[phase-07-feature-matrix.csv](phase-07-feature-matrix.csv) 共 **156 行**：文本 22、Markdown 19、工作区 18、媒体 14、转换 20、设置快捷键 15、语言 48。每行包含实现、用户入口、自动化依据、实际结果、手工结果、风险和发布影响，依据实际菜单/命令/设置/脚本建立。

领域套件通过不等于所有子项已独立通过桌面验收，矩阵保留部分覆盖和 Not Tested。语法回归实际报告 19 项测试、48 个注册项；full/partial/plain 不表示完整 IDE 能力。未发现独立 save-all 菜单或命令，已记为基线产品范围差异，未擅自新增功能或标成通过。

## 5. 已复现与修复

**P1：大 Markdown 撤销/重做重新分配全部块标识，替换未修改 DOM，并重复解析未改动块。** 基线 50,000 行撤销/重做中位约 2.06/1.98 秒，长任务最高约 2.58 秒。CPU profile 的主要开销包括 removeChild 和文档子节点处理。

先加入失败回归，再局部修复：保留语义相同的前后块标识、不可变节点和 DOM；顶层分词建立新引用环境后，仅从当前版本复用原文相同的普通块。引用环境变化会失效；Front Matter 等位置敏感 protected blocks 仍正常解析。

复用表仅存在于函数执行期间，没有旧版本缓存、第二份权威状态、文档上限降低或撤销历史清空。仍保留顶层分词和必要的语义验证，不承诺大文档全部操作达到 60 FPS。

试验中额外发现重复段落插入的标识碰撞，已先记录失败再修正，验证唯一性及局部编辑/撤销。最终专项还比较上下文变化后的树与实际全新 parser 的语义结果。

证据：`undo-red.log`、`undo-parse-red.log`、`duplicate-source-id-red.log` 及对应 green 日志。运行时改动为 MarkdownParser、MarkdownSourceBridge 的可选当前版本输入、MarkdownEditorController 同步调用和 `reuseSourceBlocks.ts`；没有改写 DocumentManager、保存策略、更新协议、主题或布局。

**图表安全修复：** 官方 registry 生产依赖审计发现 Mermaid 11.15.0 的 1 条 low / 4 条 moderate 公告。公开 [XY chart 公告](https://github.com/mermaid-js/mermaid/security/advisories/GHSA-2v8p-3f2j-5mp7) 的短输入在实际 Live renderer 中复现阻塞，8,000 字符上限不能防住；测试使用独立、受限内存浏览器和外部 watchdog。定向升级至 11.16.1，保留 strict、禁用 HTML labels、CSS/资源 guard；[radar 公告](https://github.com/mermaid-js/mermaid/security/advisories/GHSA-rhh3-jpg6-66xh) 的极端 ticks、Live/导出实际入口及正常图表均回归。官方 `audit --prod` 已降为 0 条，不能外推为开发依赖也通过。

锁文件只替换 Mermaid 包及其 integrity，没有其他依赖版本漂移。pnpm 首次写 manifest 遇到系统拒绝，已用文件编辑同步 manifest，再执行 frozen-lockfile 验证通过；原始失败日志保留。

## 6. 数据安全

| 场景 | 实际结果 |
| --- | --- |
| 保存后继续输入、dirty、版本回传 | 新 file-save 回归调用实际 FileController/DocumentManager，通过 |
| 快速保存、自动/手动并发、保存时关闭/切文档 | 真实控制器与可控 IPC；单笔进行中写入、关闭受阻、迟到结果不切文档，通过 |
| 自动保存再输入 | 实际 AutoSaveController 以 v1/v2 顺序提交快照，最终 v3 / clean，通过 |
| 保存失败后的正文与撤销 | 错误通知、dirty、undo depth 保留，通过 |
| write/fsync/rename、备份、部分写入/回滚失败 | 原生 atomic 测试通过；回滚失败保留可读备份并报告位置 |
| 磁盘满 | 新原生注入测试覆盖 staging 与 Windows 部分原位写入后的空间不足；错误、旧内容、清理和身份断言通过 |
| 外部修改、删除、只读、锁占用、父目录替换 | 原生 files/atomic/conversion 真实文件系统测试通过 |
| 会话损坏、过大、owner、超时与迟到结果 | 原生 session、shell-lifecycle 通过；真实桌面 10/100 标签恢复各 5 次通过 |

空间不足采用真实平台 OS 错误码进行受控注入，没有填满磁盘。Rust 新分支全在 cfg(test)，生产 Windows 原位写入、备份与身份策略不变。突发断电、硬重启、真实磁盘耗尽设备和网络文件系统仍为 Not Tested。前端替身 transport 与原生文件测试分别证明其层级，不冒充所有操作的完整 GUI 端到端测试。

## 7. 性能数据

见 [phase-07-metrics.md](phase-07-metrics.md) 及原始资料：

- `baseline/results.json`、`verified/results.json`：production 组件、固定数据集 SHA-256、每操作 25 样本、逐分钟内存。
- `baseline-check/`、`verified-check/`：其他重负载结束后的冻结构建顺序复测。
- `interaction/`：真实浏览器键盘事件到下一 rAF；undo/redo CPU profiles。
- `native-startup-baseline*/`、`native-startup-final*/`：真实 release 桌面启动与恢复。

数据集覆盖 1,000/10,000/50,000 行文本与 Markdown、超长单行、代码/表格/图片、多窗格。桌面覆盖 fresh WebView profile、warm profile、单文件、工作区、10 标签历史及 2,000 文件工作区/100 标签恢复，每场景 5 次；warm 另有未计入统计的预热。

报告 median/min/max，样本足够才报 P95。OS 文件缓存没有强制清空，fresh profile 不等于冷 OS；CDP 和探针开销包含在 process-to-ready。独立窗口可见时间、Rust/JS/Vue/CM 各子阶段、像素呈现和真实 FPS 未完整归因。

初始测量与构建/回归有部分并发，已保留并增加顺序复测。超过 15% 的普通差异结合复测分析，不凭单次抖动判回退。最大 Markdown 初始分词/布局仍有 >100ms 长任务，属于保留边界。

另以相同组件对搜索、标签切换、Live/source、viewport resize、工具栏往返各测 25 次并反转构建顺序复测，见 actions 数据。指标含自动化与条件等待成本，未覆盖完整 AppShell、首次动态语言加载、全部分栏拖动和物理 FPS，这些仍为 Not Tested。

## 8. 内存与生命周期

| 范围 | 实际执行 |
| --- | --- |
| Live、代码子编辑器、双窗格、表格工具栏 | 每轮 50 次；PM/CM 销毁与 DOM 断言，每 5 次 GC 后采样 |
| PDF / 图片 | 各 50 次；真实 Vue viewer、PDF worker、decoder；清理后 Worker/Blob URL 为 0 |
| 工作区、事件注册 | 实际控制器各 50 次；gateway 替身，监听器归零、重复 dispose 安全 |
| 10/30 标签 | canonical 文档状态和活动视图的 GC 后样本 |
| 普通/大 Markdown、代码、图片、PDF、双窗格 | 生产组件独立 heap/DOM 快照 |
| 持续编辑 | 基线与最终代码各 30 分钟；真实键盘输入/删除、逐分钟采样、最终源码一致性 |

完成状态必须核对结果中的 passed、duration；运行中的 JSON 不当作通过。内存结论采用 baseline-clean / delivery-clean，后者为包含 Mermaid 11.16.1 的最终构建。升级前 verified-clean 保留为补充证据。

初轮对象型 Playwright 等待返回 EditorView/DOM，保留了远端句柄，导致测试宿主的假增长。已改成布尔条件，旧轮内存资料隔离，不作为产品泄漏证据；修正后重新执行循环和持续编辑。

原始资料包含逐分钟 forced-GC heap/DOM、前后真实 heapsnapshot、memory-scenarios、原生 Rust/WebView 子进程内存/句柄。只清除测试宿主的 publication 追踪，不清除产品历史或缓存美化结果。WebView Working Set 求和可能重复计算共享页，另报 Private Bytes。

结论仅限已覆盖路径；长期原生 token/线程趋势与各 OS 未全面排除泄漏。测试 profiles、snapshots 与构建缓存留在忽略目录，不等同于运行中资源泄漏。

## 9. Rust / Tauri 安全

实际 generate_handler 注册 **65** 个命令，排除普通 Rust 辅助函数。capabilities 保持 main/file-*/app-*，未新增通用文件系统权限或超级接口。

四类 conversion 命令继续接受单次原生 token；owner、目的、TTL、释放、目标版本和受控提交测试通过，未恢复旧路径参数。16MiB 输入/输出及既有媒体/ZIP/并发/lease/超时上限保持，serde 超限拒绝测试通过。

Pandoc staging、真实进程 timeout kill+wait、失败 DOCX 保留、媒体逃逸与批次清理、PDF 成功/失败/取消/超时清理均有原生测试。链接/身份/媒体版本/会话 owner/更新租约仍用现有实现。外部 URL 限 HTTP(S) 且拒绝账号；CSP、HTML 清理、更新签名链与关闭握手未改动。

SDK download promise 成功后才进入可安装状态；错误路径已回归，没有实际更新安装或生产私钥使用。日志内容来自 fixture，未记录用户正文或真实授权凭据。

Phase 06.2 的最终版本复检到 OS 提交之间仍有已记录的跨进程竞态边界，不称为严格 CAS。部分 FileStore IO 仍在全局锁内，记为技术债；未把静态观察冒充跨窗口性能故障复现，也未扩大架构重写。

## 10. 自动化与远程 CI

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck、build / 正常 release bundle | PASS；保留 Node 外部化与大 chunk 提示 |
| 最终 Smoke | 连续三次，每次 **15/15 个脚本**，无 skip；不是断言总数 |
| 最终完整 Regression | **26/26 个脚本**，无 skip；包含脚本内部的多个实际用例 |
| locked cargo check / test | PASS / **97 passed** |
| Windows WebView2 PDF 专项 | **1 passed**；常规 cargo test 不包含此忽略用例 |
| 严格 Clippy all-targets -D warnings | **FAIL**，历史 11 个 lib + 1 个 test 诊断 |
| cargo fmt --all -- --check | **FAIL**，保留历史全仓差异 |
| 官方 registry 生产 / 全部依赖审计 | **PASS 0 / FAIL 17**（2 low、13 moderate、2 high；全部残留在 dev 依赖链） |

最终前端日志以 `smoke-final15-{1,2,3}.log`、`regression-final26.log` 为准，Rust 以 `*-verified.log` 为准；红测试和中间轮次不计入最终通过数。新增 markdown-undo、file-save、diagram-security 纳入 Smoke/Regression。Extended Quality 的 PR/手动入口增加 advisory audit、完整回归、50 循环及可选 30/60 分钟测试。

首次依赖升级后的 Smoke 与 release 编译并行，出现 updater 设置入口和 smooth-caret 首次导航超时，失败轮保存在 smoke-delivery-1.log。没有修改断言、超时或加 force。两项原脚本单独复测均通过；另只替换端口、确保对应 Vite cache 不存在的冷缓存实验也通过（源脚本 SHA 与唯一变更见 cold-cache-probes.json）。据此暂归为并行冷编译负载下的不稳定性，不能据单次复测证明永不发生。

原生启动/PDF、interaction、memory-scenarios 已本地独立执行，不冒充 Regression 隐含覆盖。基线 [Quality Gate 39347253799](https://github.com/yuanmahome/Markumo/actions/runs/39347253799) 的 Frontend/Rust Quality 均成功，head 为 503153b。当前未推送，**没有覆盖本阶段修改的远程 Actions 结果**，新增工作流也未远程执行。

## 11. 历史静态债

Clippy 位置为 commands/{app,settings,workspace,session}.rs、workspace/service.rs、files/{classfile,media}.rs、lib.rs 和 files/images.rs 测试。类型包括 needless_return、derivable_impls、cmp_owned、needless_borrow、too_many_arguments、manual_range_patterns、manual_is_multiple_of、chunks_exact_to_as_chunks、unnecessary_cast、cloned_ref_to_slice_refs。

本阶段新增故障测试没有新增 Clippy 诊断。rustfmt 报告18个文件；逐文件使用同一 rustfmt 对基线和当前内容核对，18个均在已验收基线存在格式差异（rustfmt-baseline-comparison.json）。未全仓格式化、降低严格性或把失败写成通过。

**P1：开发工具链依赖未整改。** 不带 `--prod` 的官方审计失败，原始 dependency-audit-all-final.json 为17条：Vite 5.2.0及其 esbuild 0.20.1、vue-tsc→vue-template-compiler 2.7.16。包含 Windows launch-editor 命令注入、Windows alternate-path fs.deny 绕过等2条 registry high。发现依据为实际锁定版本和 registry 公告匹配，未向用户正在运行的开发服务发送利用请求，未证明生产桌面应用可利用。建议单独将 Vite 迁移到覆盖公告修复的受维护版本，并升级兼容的 vue-tsc/编译器链，再重新执行构建、浏览器与桌面验证；这会改变构建工具及产物，本轮不将其混入已测量的最小运行时修复。新增 Extended Quality 中独立的全量 dependency-audit job 会按现状失败，不使用 continue-on-error；浏览器 job 无 needs 依赖，仍可运行并保留证据。新工作流尚未推送或远程执行。

这里的2 high沿用 registry 审计评级。[Windows alternate-path 上游公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff) 本身标 Moderate，影响条件包括开发服务对网络暴露；其6.x修复从6.4.3开始，已超出当前Vite5范围。本地默认开发配置没有主动开启 `--host`，但这不消除其他公告，也不将未做的利用测试写成安全证明。[launch-editor 公告](https://github.com/vitejs/launch-editor/security/advisories/GHSA-c27g-q93r-2cwf) 还要求攻击者控制文件名并触发打开编辑器方法。本轮未构造恶意文件或执行命令注入。

`dev:true` 是安装依赖分类，不自动证明构建产物不受影响。例如 [Vite DOM clobbering 公告](https://github.com/vitejs/vite/security/advisories/GHSA-64vr-g452-qvp3) 涉及 cjs/iife/umd 输出；本项目实际入口为 ESM，没有设置这些输出格式。本轮产物中搜到的 currentScript 来自 DOMPurify，不能仅凭同名字符串证明存在该 Vite gadget；其余公告仍需随工具链升级逐项复核。

针对实际危害复查：FileService 的 operate 在 spawn_blocking 中持锁执行磁盘操作，可能串行化其他窗口文件 IO，保留为需单独压测的债务；不阻塞前端普通内存编辑。FileController 中部分 token 释放的 catch 仅吞清理错误，保存主体错误会通知并保留正文；未据此推断写入成功。SessionWriter 串行 Promise、错误记录与 strict flush 有回归，失败签名会清除以允许重试。PdfWorkspace 的 unwrap 依赖私有 Some 构造且仅在 Drop 中 take，当前无外部输入触发路径。没有把 any/unwrap/大函数的文本计数直接等同于漏洞；全项目循环依赖和所有未用公开接口尚无完整静态证明。

## 12. 构建、安装、各平台

metrics 列出前端总量、初始 JS、最大 chunks 用途、生产 exe/NSIS 大小与 SHA-256。仅安全升级既有 Mermaid 并更新锁文件；未新增生产依赖类别、删除语言/PDF/字体功能，Live/媒体继续懒加载。

正常生产配置已生成 Windows x64 NSIS 1.0.4，旧目录中 1.0.0 不纳入结果。应用 ID、文件关联、图标、currentUser 模式、更新公钥及完整性标签有静态/回归检查，未执行安装器。

本地未使用生产签名私钥，package helper 按既有逻辑关闭本次 updater artifacts 生成；因此本轮没有可验收的 `.exe.sig`、Linux/macOS 更新归档或签名安装产物，不能称为已验证更新包。release.yml 声明的 `.exe.sig` / `.AppImage.sig` / `.app.tar.gz.sig` 附件模式已核对。未发现现有流程生成 SBOM，本轮未生成 SBOM。release 目录有独立 PDB，NSIS 的 File 项仅包含应用、许可证、图标和条件性 WebView 安装器，未见 PDB 被列入；dist 无 source map。

| 平台 | 实际范围 / 缺口 |
| --- | --- |
| Windows x64 | check/test、NSIS、真实 PDF、隔离 release 启动/工作区/会话/关闭、进程内存 |
| Windows IME/UNC/文件管理器关联/剪贴板全桌面集成 | 部分底层或合成回归，完整实机 Not Tested |
| 隔离安装/卸载/升级、生产签名链 | Not Tested；本地 Authenticode 状态另存，无生产私钥操作 |
| Linux | 基线 Ubuntu CI 成功；本阶段新代码本机、X11/Wayland、安装/桌面 Not Tested |
| Linux/macOS 原生 PDF | 基线仅 Windows 实现；没有擅自新增平台实现 |
| macOS Intel/ARM、WKWebView、签名/公证/安装升级 | Not Tested |

已打开并目视复核 final-delivery 的工作区与100标签会话截图：工作区树、标签、状态栏和正文显示正常；这是选定截图检查，不替代完整中文IME、剪贴板、拖放或安装实机验收。真实PDF专项测试宿主仍输出“缺少默认窗口图标”的宿主警告，但有效PDF与临时资源清理断言通过；正常生产打包使用既有应用图标。

旧 GitHub API 路径实测重定向到 yuanmahome/Markumo。产品仍有旧 URL 依赖，未悄悄更换签名信任根或更新协议。

## 13. 缺陷、阻塞与评分

| 等级 | 状态 |
| --- | --- |
| P0 验收阻塞 | 关键平台/安装升级/签名验证未完成；严格必跑检查仍失败，不能证明 RC 条件全部成立 |
| P0 产品缺陷 | 本阶段未新确认仍未解决的数据丢失/任意路径写入；既有 CAS 边界仍按原报告保留 |
| P1 已修复 | 大 Markdown 历史同步、未修改 DOM 替换、重复块 ID 边界，以及实际可触发的 Mermaid 图表 DoS，均有红/绿证据 |
| P1 未处理 | 开发工具链17条依赖公告（2 high）；历史严格检查；最大文档初始布局长任务；非 Windows 原生 PDF 与桌面覆盖缺口 |
| P2 | save-all 范围差异、旧 URL 重定向依赖、IO 锁粒度和包体拆分候选 |

以下为结合覆盖和缺陷的保守工程判分，未测扣分，不是套件通过率。

| 维度 | 权重 | 分数 | 依据 |
| --- | ---: | ---: | --- |
| 功能完整性和正确性 | 25% | 60 | 156 行清单、真实回归，逐功能手工缺口 |
| 数据安全与文件可靠性 | 25% | 85 | 快照/并发、97 原生、故障/lease；断电等未测 |
| 性能与资源管理 | 20% | 80 | 固定数据、启动重复、50 循环、30 分钟；可见/物理帧率/全部 native 趋势未全测 |
| 代码质量与可维护性 | 10% | 70 | 局部修复、单一状态；历史严格检查及开发工具链审计失败 |
| 跨平台兼容性 | 10% | 40 | Windows 实测，Linux 本阶段与 macOS 缺口 |
| 构建安装与升级 | 5% | 55 | NSIS/配置回归，安装签名升级未验证 |
| 自动化测试质量 | 5% | 90 | 15×3、26、97、真实转换；新代码未入远程 CI |

**加权分 70.5/100，结论 C — Not Ready。** 评分不能替代发布阻塞判断。后续需完成独立环境安装/升级与签名、补齐目标平台/手工矩阵、处理或人工明确接受历史严格检查和 P1 范围，让最终提交通过远程 CI，再由人工最终放行。

## 14. 复现与交付

使用任务书 pnpm 与 locked cargo 命令。专项均为真实文件：markdown-undo-regression、file-save-regression、phase07-browser-audit、test-native-pdf.ps1、phase07-native-startup、phase07-interaction-profile、phase07-memory-scenarios。`pnpm test:quality:browser` 默认 50 循环而不跑 30 分钟；完整编辑使用 `--soak-minutes=30`。

原生启动要求按脚本约束先生成隔离 release，拒绝生产 ID；interaction/memory-scenarios 需要指定冻结构建 preview server 在线。inventory/summarize 仅生成清单和统计。构建数据、heap snapshots、profiles 留在忽略目录供复核。

原生探针的准备条件：`test-results/phase07/native-config.json` 中 identifier 为 `com.markumo.phase07-audit`，app.appDirectoriesOverride 指向项目下 `test-results/phase07/native-profile` 的绝对路径，bundle.active/createUpdaterArtifacts 均 false，build.beforeBuildCommand 为 null。先用正常生产配置打包并存档，再运行 `node scripts/tauri.mjs build --no-bundle --config test-results/phase07/native-config.json`；仅将该隔离 exe 存入 `native-{baseline,final}/markumo-isolated.exe` 后运行探针。不得用正式应用 ID 或正式用户目录代替。基线 exe 必须来自已验收提交；最终标签使用 `--label=final-delivery`。

持续编辑示例：预先生成 `scripts/media-fixtures.py` 要求的本地 fixture 后，执行 `node scripts/phase07-browser-audit.mjs --label=delivery-clean --port=1494 --soak-minutes=30`。`--reuse-build --build-id=...` 只用于已冻结且明确记录来源的同一构建。memory-scenarios 在该1494 preview在线期间运行；不要把已关闭服务的连接错误计为产品失败。该脚本曾因旧媒体端口1484未同步产生一次测试准备错误，修正宿主端口后完整通过，未改产品实现。

完成后停止，等待人工最终验收，不自动发布或进入后续阶段。
