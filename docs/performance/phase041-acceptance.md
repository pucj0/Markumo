# Phase 04.1 验收记录

日期：2026-10-22。全部本轮提交在 main 完成，未推送、未发布、未修改版本号。

## 结果与测量边界

已修复状态 Getter 隐式创建、初始先创建再销毁、错误 IO root、搜索高亮全量激活、冷占位首击焦点/坐标、打字机代码块回归、静态占位 DOM 膨胀、Mermaid SVG ID 冲突和 PDF 过早终止 Worker 导致的 TextLayer Canvas 残留。

Windows Release A/B 为 `00ad49a` → `0ff6ebc`，两者 Rust tree 与依赖相同；本轮验收交付提交仅更新测试、工具、CI 和文档。Windows 11 Home China `10.0.26200`、WebView2 `155.0.4283.62`、i5-12600KF、16 个逻辑 CPU、约 64GiB 内存；屏幕 2560×1440，窗口 1200×780，DPR 1。每版本三轮、独立 WebView 数据目录，固定文件 SHA256 和场景顺序。专用 Release 含相同的计数探针和生产 manager 引用，CDP 开销计入。

验收期间其他任务在 main 提交了 Callout（`2dc9a44`）和动态目录（`62c092f`），并继续修改脚注相关工作区文件。上述功能不属于本轮测量版本；本报告的 32/43 项浏览器结果限定于 `0ff6ebc` 源码快照，不能代表这些后续功能已经完成集成验收。本轮增加的快照测试入口因共享工作区已随 `2dc9a44` 一并提交；保留该提交，不重写其历史。

**结论是本机本负载下的三轮观察，不是对所有机器的保证。** OS 缓存、JIT 和后台并发测试负载未完全控制；P95 是三个样本的最近秩值，通常就是最大值。内存峰值为离散采样下界。普通开发模式应用、系统输入法候选窗以及小时级编辑仍未验证。

## Windows WebView2 原生 Release

以下均为三轮中位数，箭头表示优化前 → 优化后。稳定值在强制 GC 后采集；完整 Working Set、Rust Private、DOM、采样时间线和关闭后的回落值保存在 [统计结果](phase041-results.json)。

<!-- BEGIN NATIVE TABLE -->
| 场景 | 嵌入 CM 峰值 | GC 后 JS Heap MiB | WebView2 Private MiB 中位数 | Private P95 MiB | Private SD MiB |
|---|---:|---:|---:|---:|---:|
| blank | 0 → 0 | 5.94 → 5.94 | 183.38 → 183.55 | 186.25 → 186.55 | 1.52 → 1.80 |
| txt | 0 → 0 | 7.19 → 7.19 | 194.20 → 198.50 | 197.94 → 203.35 | 2.43 → 3.01 |
| live | 0 → 0 | 9.21 → 9.20 | 207.21 → 207.91 | 209.28 → 214.38 | 1.67 → 4.54 |
| code-10 | 10 → 10 | 10.69 → 10.66 | 213.75 → 214.34 | 222.09 → 223.13 | 3.96 → 5.94 |
| code-50 | 50 → 10 | 12.61 → 11.08 | 243.01 → 220.00 | 254.00 → 226.16 | 6.55 → 4.65 |
| code-100 | 100 → 10 | 14.20 → 11.45 | 259.11 → 223.25 | 289.25 → 231.11 | 22.63 → 3.99 |
| code-200 | 200 → 10 | 17.64 → 11.96 | 324.84 → 229.62 | 330.01 → 236.97 | 5.36 → 4.63 |
| split | 100 → 0 | 12.23 → 11.73 | 269.35 → 251.13 | 272.73 → 261.09 | 3.76 → 7.15 |
| multi-pane | 200 → 20 | 18.43 → 13.05 | 334.36 → 234.89 | 342.63 → 247.18 | 5.61 → 6.54 |
| pdf | 0 → 0 | 12.86 → 12.42 | 264.77 → 250.26 | 268.02 → 251.32 | 5.58 → 0.73 |
| image | 0 → 0 | 12.96 → 12.52 | 262.84 → 247.04 | 267.69 → 249.82 | 4.90 → 1.78 |
| open-close-50 | 100 → 10 | 13.99 → 13.65 | 334.06 → 290.79 | 338.35 → 294.24 | 3.33 → 2.23 |
<!-- END NATIVE TABLE -->

200 块场景的关键观察：

| 指标 | 优化前 | 优化后 |
|---|---:|---:|
| 首次并存嵌入 CM 峰值，精确计数 | 200 | 10 |
| 稳定 CM，实际应用 Shell | 200 | 10 |
| 采样 JS Heap 峰值 MiB，下界 | 22.21 | 14.00 |
| 采样 WebView2 Private 峰值 MiB，下界 | 410.84 | 238.62 |
| 稳定 WebView2 Working Set MiB | 483.48 | 403.96 |
| Rust Private MiB | 6.20 | 5.96 |
| DOM Nodes | 22,108 | 7,288 |
| 文件场景操作到就绪 ms | 1,224 | 74 |
| 该观测窗口长任务数 | 5 | 0 |
| 关闭该文档后最终 Heap MiB | 11.00 | 10.66 |
| 关闭该文档后最终 Private MiB | 228.18 | 223.72 |

稳定 Private 的本轮中位数差为 95.22 MiB；不能用它替换成“所有场景均下降 95.22 MiB”。空白、TXT、普通 Markdown 和 10 块场景未显示稳定改善。PDF 和图片位于固定场景序列后部，缓存及先前场景也会影响进程值，不能将全部差异归因于媒体代码。

50 次开闭场景的三轮关闭后 CM 均为 0，最终 Heap 中位数 13.99 → 13.65 MiB。回落不等于回到冷启动内存，更不等于无限运行无泄漏。PDF 的独立回归保留了“关闭后所有 Canvas 与 Worker 归零”的原断言，实际修复了隐藏测量 Canvas 的残留。

## Chromium 组件宿主

Chromium `155.0.8059.85`，1280×850 宿主，Vite 开发模块。它与 WebView2 Release 分开统计。首帧为组件文档安装后首个就绪动画帧；它不是 Tauri 冷启动时间。

<!-- BEGIN COMPONENT TABLE -->
| 代码块 | 初始累计创建 | 初始化峰值 CM | 稳定 CM | 采样 Heap 峰值 MiB | GC 后 Heap MiB | DOM Nodes | 首帧 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | 10 → 10 | 10 → 10 | 6 → 10 | 9.79 → 9.80 | 7.93 → 8.09 | 817 → 1085 | 596.4 → 224.5 |
| 50 | 50 → 11 | 50 → 11 | 6 → 11 | 13.14 → 9.34 | 8.43 → 8.44 | 1857 → 2231 | 142.0 → 37.1 |
| 100 | 100 → 11 | 100 → 11 | 6 → 11 | 12.66 → 9.39 | 8.88 → 8.79 | 3157 → 3581 | 317.6 → 28.6 |
| 200 | 200 → 11 | 200 → 11 | 6 → 11 | 10.02 → 10.86 | 9.40 → 9.20 | 5757 → 6281 | 1415.1 → 150.4 |
<!-- END COMPONENT TABLE -->

旧组件宿主没有完整 Shell 持续读取工具栏状态，稳定时能释放到 6 个 CM；真实原生应用的旧 Getter 又将它们激活到 200。因此两种宿主的稳定值不能交叉比较。新 root 使用完整的 600px 缓冲，组件宿主约多保留 5 个 CM：200 块时稳定 DOM 比旧组件宿主多 524 个，而非为每个离屏块增加完整高亮节点；稳定 Heap 略低。相较曾经为所有占位生成高亮的 17,999 节点方案，最终已压到 6,281。

200 块、1000 次状态查询每轮新增 CM：旧实现 194，新实现 0。每版本三轮、每轮 1000 次实际段落键入，内容与 canonical Undo/Redo 均校验。浏览器 `beforeinput` 到 input 微任务结束的处理时间共 3000 个样本：

| 指标 ms | 优化前 | 优化后 |
|---|---:|---:|
| 中位数 | 8.30 | 3.00 |
| P95 | 9.90 | 3.70 |
| 标准差 | 1.02 | 0.51 |

这是组件事件处理计时，不是硬件键入到屏幕呈现的完整延迟。长时间输入可能由规范历史按时间间隔分成多个 Undo 组，测试对全部实际组进行精确撤销/重做校验，不将一次长键入强行视为一个历史事件。

## 自动化与功能验收

<!-- BEGIN TEST STATUS -->
| 命令/专项 | 实际结果 |
|---|---|
| pnpm typecheck | 通过；工作区额外 Callout 的两处 DOM Node 类型引用已纠正，未提交其功能改动 |
| pnpm build | 通过；Vite 仅有已有分包/动态导入提示 |
| pnpm test:smoke | 32/32，0 failed，0 skipped，源码快照 0ff6ebc |
| pnpm test:regression | 43/43，0 failed，0 skipped，源码快照 0ff6ebc |
| cargo test --locked --manifest-path src-tauri/Cargo.toml | 159 通过、0 失败、1 个原有 ignored；系统 Temp 拒绝访问后改用仓库隔离 TEMP/TMP 重跑通过；Rust tree 未改变 |
| 连续编辑 | 120 秒、559 次浏览器插入、9503 字符、完整 Undo/Redo、CM 分配不增长、监听不增长、全部资源销毁 |
| Windows 原生 Release | 前后各三轮、12 个场景/版本，每版本 36 场景记录，无页面错误 |
| Chromium 组件 A/B | 前后各三轮、10/50/100/200 块，另有 3000 次输入/版本，无页面错误 |
<!-- END TEST STATUS -->

专项断言包括：200 块状态查询不分配；首次创建受视口约束；远距离滚动创建/释放；冷占位第一击的源码偏移精确；首次手势跨行拖选；CDP 中文 IME；跨块查找替换与 Undo；Ctrl+Home/End；真实 ClipboardEvent 多行粘贴；打字机开关后定向输入；未聚焦编辑器不抢焦点；每 Pane 独立 IO root；无 IO 安全降级；只读 CM 拒绝键入；语言/行号/换行/字号/行高变更；宽/窄占位和 CM 的高度差 ≤2px；销毁后全部视图释放。

Mermaid 使用十个相同图表执行浅/深/浅主题往返，校验所有 ID 唯一、资源引用限定于所属 SVG、真实连接与 computed marker；另对净化后的 gradient、clipPath、marker 和 CSS 选择器作结构测试。DOMPurify、严格模式、安全预算和缓存上限未移除。

持续编辑专项为有限时长 120 秒，验证实际浏览器输入、精确源码、全历史 Undo/Redo、CM 分配不增长及销毁。它不代表小时级 soak。

原 CI [Quality Gate #33](https://github.com/yuanmahome/Markumo/actions/runs/39734058054) 的浏览器作业为 advisory，整体绿色掩盖了浏览器失败。本轮在本地 Smoke 全部通过后移除 `continue-on-error`，恢复 Browser Smoke 阻塞门禁。未推送，因此没有本轮远程 Actions 运行结果。

执行中另有任务持续修改 App/Callout，曾触发 HMR 导致焦点断言失效。验收浏览器使用 `MARKUMO_TEST_REF=0ff6ebc` 的只读 Git 源码覆盖及禁用 HMR；普通 CI 直接测试检出的源码。Cold Vite 编译期间两个测试只增加导航准备超时，10 秒功能交互期限不变；用户要求保留的 brackets/typewriter 超时改动也保留，功能断言没有删除或放宽。

## 截图

- [宽窗口静态占位](phase041-evidence/wide-static.png) / [宽窗口 Live](phase041-evidence/wide.png)
- [600px 静态占位](phase041-evidence/narrow-static.png) / [600px Live](phase041-evidence/narrow.png)
- [多 Pane](phase041-evidence/multi-pane.png)
- [打字机模式](phase041-evidence/typewriter.png)
- [深色主题](phase041-evidence/dark.png)

## 本轮修改文件与提交

| 阶段 | 提交 | 主要文件与实际作用 |
|---|---|---|
| P0 无副作用查询 | `7e62f48` | `CodeBlockView.ts`、`MarkdownEditorController.ts`、新增 virtualization regression：拆开状态查询和显式分配。 |
| P0 真正懒创建 | `f8a3412` | 上述控制器、`MarkdownTheme.css`：构造轻量 DOM，真实 Pane root，焦点/选区/IME/指针保活，选区及配置恢复。 |
| P1/P2 交互和图表 | `a1d6e05` | `LiveSearchController.ts`、`renderers.ts`、代码块及 CSS；typewriter/diagram/virtualization 测试和测试清单：首击、搜索导航、SVG 资源命名空间。 |
| 完整回归发现的媒体问题 | `21b2083` | `PdfViewer.vue`、`media-regression.mjs`：先完成销毁握手再释放 Worker，保留 Canvas 零残留断言及诊断。 |
| P2 DOM 开销修正 | `0ff6ebc` | `staticCode.ts`、`CodeBlockView.ts`、`MarkdownTheme.css`：扁平文本/CSS 行号、按需分行、最多 8 个静态高亮块。 |
| 验收和证据 | 见本记录所在的交付提交 | `memory-baseline-suite.mjs`；新增 `memory-release-build.mjs`、`memory-native-ab.mjs`、`memory-chromium-ab.mjs`、`memory-ab-summary.mjs`；snapshot register/loader/Vite helper；edit soak；补强 brackets/diagram/virtualization 测试，保留用户指定的 typewriter 超时；updater/smooth-caret 导航准备；quality workflow；两篇性能报告、本记录、JSON/压缩原始数据/截图。 |

本轮未修改 `DocumentManager.ts`：它的 `isComposing` 委托控制器，控制器修复后无需重复改动。`测试.md`、Callout、目录、脚注与其他任务的功能改动均不纳入本轮交付提交；此前只在其 Callout 文件中纠正了两处 DOM Node 类型引用，以完成当时工作区类型检查。后续并发功能改动的当前工作区不是浏览器验收快照。

## 尚待验证与限制

- 本轮只有一台 Windows / 一个 Runtime；普通开发模式应用内存未测。
- JS/Private 峰值是采样下界；小样本和后台负载不支持普遍性能保证。
- 600px 预加载保留更多可交互块，有固定的额外 DOM 成本，已披露。
- 超大围栏与开启换行时仍需要按行轻量排版；64KiB 以上不主动静态高亮。
- 未进行人工肉眼快速滚动验收、真实系统输入法候选窗和数小时连续运行。
- 本轮没有远程 CI 运行，也没有 Push。已通过的本地用例不能表述为“零功能回退”或“完全没有泄漏”。
