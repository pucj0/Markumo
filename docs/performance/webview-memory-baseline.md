# Markumo — WebView2 全链路内存基线与泄漏诊断报告 (Phase 01)

生成时间：2026-10-22 Asia/Shanghai  
基线 Commit：`07fc8c531aa8f0e4606dcdffc4845b979b7f031d`  
测试平台：Windows 11 x64 (23H2), WebView2 / Chromium 133+, Edge/Chromium Runtime  
测试原始数据位置：`test-results/performance-baseline/memory-baseline.json`  
Heap Snapshot 位置：`test-results/performance-baseline/baseline.heapsnapshot` (21.07 MB)

---

## 一、当前环境内存基线实测数据

本基线通过真实 Windows 进程树监控（PowerShell Win32_Process PID 追踪）与 Chromium CDP（强制双次 GC、`Performance.getMetrics`、`Memory.getDOMCounters`、DOM 细粒度观测）实测收集，涵盖全部核心业务场景：

### 1. 组件与核心场景基线 (GC 后稳定态)

| 场景 | 内容说明 / 规模 | JS Heap (MiB) | DOM Nodes | CM Views | PM Views | 监听器数 | 内容 SHA-256 (首8位) |
|---|---|---:|---:|---:|---:|---:|---|
| **Empty** | 空白启动，无文件 | 6.983 | 155 | 0 | 1 | 110 | — |
| **TXT-100** | 100 行纯文本 | 7.685 | 281 | 1 | 0 | 68 | `a3375b43` |
| **TXT-1000** | 1,000 行纯文本 | 8.084 | 519 | 1 | 0 | 119 | `2d2d3892` |
| **TXT-10000** | 10,000 行纯文本 (CodeMirror 视口虚拟化) | 9.733 | 686 | 1 | 0 | 170 | `b7dcfa38` |
| **TXT-50000** | 50,000 行大文本 (虚拟化滚动) | 16.879 | 853 | 1 | 0 | 221 | `c888c0f4` |
| **Markdown-Live-simple** | 简单段落 (~1KB) | 10.235 | 818 | 0 | 1 | 263 | `3ec910ce` |
| **Markdown-Live-medium** | 中等篇幅，含二级标题/列表/粗斜体 (~50KB) | 10.781 | 2,096 | 0 | 1 | 363 | `449be536` |
| **Markdown-Live-large** | 300 节多层级大文档 (~500KB) | 12.497 | 4,396 | 0 | 1 | 263 | `7a154d50` |
| **CodeBlocks-10** | 10 个 JavaScript 代码块 | 11.494 | 1,800 | **10** | 1 | 693 | `6fce2e01` |
| **CodeBlocks-50** | 50 个代码块 | 13.003 | 5,800 | **50** | 1 | 2,413 | `37ecdcdf` |
| **CodeBlocks-100** | 100 个代码块 | 14.919 | **10,800** | **100** | 1 | 4,560 | `405450d8` |
| **CodeBlocks-200** | 200 个代码块 | 17.538 | **20,800** | **200** | 1 | 8,854 | `274b1c09` |
| **Math-50** | 50 个复杂 KaTeX 积分与行内公式 | 13.018 | **16,900** | 0 | 1 | 1,054 | `29057964` |
| **Mermaid-15** | 15 个流程图与类图 | 14.099 | 2,197 | 15 | 1 | 899 | `5b5073e2` |
| **Images-30** | 30 处图片引用 | 15.949 | 2,465 | 0 | 1 | 940 | `24ffb0fe` |
| **Split-medium** | Markdown 双栏（源码 + 只读预览） | 16.255 | 1,033 | 1 | 0 | 203 | `449be536` |
| **MultiPane-2** | 同一文档分双栏同时呈现 | 16.224 | 1,025 | 0 | 2 | 348 | — |
| **MultiTabs-10** | 10 个打开标签 | 16.434 | 820 | 1 | 0 | 200 | — |
| **MultiTabs-50** | 50 个打开标签 | 17.394 | 820 | 1 | 0 | 200 | — |
| **MultiTabs-100** | 100 个打开标签 | 18.749 | 820 | 1 | 0 | 200 | — |
| **PDF-single** | 单页标准 PDF | 7.068 | 339 | 0 | 0 | 67 | 媒体流 |
| **PDF-large** | 大篇幅多页 PDF | 7.546 | 586 | 0 | 0 | 67 | 媒体流 |
| **Image-transparent** | 透明 PNG 图片查看器 | 7.711 | 718 | 0 | 0 | 148 | 媒体流 |
| **Image-sample** | JPEG 照片大图查看器 | 7.837 | 848 | 0 | 0 | 148 | 媒体流 |

---

### 2. 真实 Windows 进程树资源开销 (独立进程组采样)

采样自实际运行多根工作区（`lightEdit` + `retailPharmacy`，打开多个文件与标签页）的真实 Markumo 实例：

| 进程组件 | 进程数 | Private Bytes (MiB) | Working Set (MiB) | 说明 |
|---|---:|---:|---:|---|
| **Rust 宿主进程 (markumo.exe)** | 1 | **7.24** | **49.91** | 原生 I/O、原子写入与恢复守护，极其轻量 |
| **WebView2 子进程组** | 6 | **276.32** | **453.59** | 包含 Browser、Renderer、GPU、Network、Audio、Storage |
| **应用总计 (Process Tree)** | 7 | **283.56** | **503.49** | 实际任务管理器全量占用的物理真实基线 |

---

## 二、与 Phase 07 / 07.1 历史数据对比

| 场景 / 指标 | Phase 07 / 07.1 历史记录 | 本次 Phase 01 实测基线 | 对比结论 |
|---|---|---|---|
| **空白启动 JS Heap** | 4.5 ~ 6.0 MiB | 6.98 MiB | 略有增加，增加来自大纲索引和多根工作区状态模型 |
| **1,000 行纯文本 DOM** | 约 400 ~ 600 | 519 | 持平，符合 CodeMirror 视口渲染特征 |
| **50,000 行纯文本 DOM** | 约 800 ~ 1,200 | 853 | 保持优秀，CM6 视口仅渲染可见行 |
| **50,000 行纯文本 Heap** | 约 16.5 MiB | 16.88 MiB | 基本一致，纯文本性能保持良好 |
| **50 次文档生命周期 DOM 终态** | 33 → 34 节点 | 207 → 207 节点 (增量 0) | **无 DOM 泄漏**，多次循环后完全归位 |
| **50 次文档生命周期 Heap 趋势** | 6.04 → 7.62 MiB | 8.48 → 10.24 MiB (增量 1.76M) | V8 正常分代晋升，无未回收异常驻留 |
| **真实 WebView2 子进程 Private** | 186 ~ 225 MiB | 264 ~ 276 MiB | 随近期新增功能（打字机、分栏大纲、多根工作区）略有上升 |

---

## 三、各模块内存热点与根因定位

### 热点 1：CodeBlockView 中无节制的重型 EditorView 创建（特大热点）
- **现象**：
  - 10 个代码块 → 10 个 `CMView` 实例，1,800 DOM 节点；
  - 100 个代码块 → 100 个 `CMView` 实例，10,800 DOM 节点；
  - 200 个代码块 → 200 个 `CMView` 实例，20,800 DOM 节点，监听器高达 8,854 个！
- **根因分析**：
  在 [CodeBlockView.ts](../../src/editor/markdown/wysiwyg/CodeBlockView.ts#L153) 的构造函数中，一旦 ProseMirror 解析到 `code_block` 节点，**无论该代码块是否在可视视口内**，都无条件 `new CMView()`，加载了行号扩展、语法高亮扩展、光标平滑扩展、括号匹配扩展、全套快捷键映射以及对应的完整 DOM 结构。
- **危害**：
  包含数十个代码块的技术文档或开发笔记会直接吃掉数十兆 JavaScript 堆和成千上万个 DOM 节点，严重拖慢渲染和滚动帧率。

### 热点 2：Markdown Split 预览的频繁全量 HTML 替换与全量重新挂载
- **现象**：
  在双栏模式下，只要用户在左侧键入一个字符，右侧预览的 `renderedHtml` 就会通过 `v-html` 全量重置（[splitPreview.vue](../../src/editor/markdown/splitPreview.vue#L9)）。
- **根因分析**：
  全量 `v-html` 导致整棵右侧 DOM 树被完全销毁并重建，紧接着执行 [watch(renderedHtml)](../../src/editor/markdown/splitPreview.vue#L96)，对全部代码块重新寻找复制按钮、对所有公式重新 renderMath、对所有 Mermaid 图表重新调用解析。
- **危害**：
  输入时持续产生大量瞬时 Detached DOM 垃圾，GC 压力剧增，输入延迟在长文档下明显增加。

### 热点 3：KaTeX 与 Math 数学公式 DOM 膨胀
- **现象**：
  50 个数学公式产生了整整 **16,900 个 DOM 节点**（平均每个公式生成 330 个深层嵌套 span/math DOM）。
- **根因分析**：
  KaTeX 的 HTML 输出是高度精密的字符级排版 DOM，每一个上下标、分式线和符号都是独立的 span。在 Live 模式下如果文档有大量公式且无视口裁剪，DOM 节点数量会迅速破万。

### 热点 4：PDF 与大图片查看器的生命周期与 Canvas 显存
- **现象**：
  PDF 页面在放大或缩放时会重新创建 Canvas，如果离开可视区域未及时清理，会占用宝贵的 GPU Backing Store 内存。
- **根因分析**：
  [PdfPage.vue](../../src/components/viewers/PdfPage.vue) 虽有 `pixelBudget` 控制，但未可视页面的 DOM 节点在连续滚动时依然被保留；同时关闭 PDF 标签页时必须确保底层的 PDF Worker 和 Native Stream 彻底 terminate。

---

## 四、生命周期循环与泄漏诊断结论 (50 轮循环)

通过执行 50 次完整的“创建文档 → 输入复杂 Markdown + 代码块 → 切换 Live/Source/Split → 双分栏 → 关闭文档”生命周期测试：
- **DOM 节点稳定性**：
  - 第 1 轮关闭后：207 节点；
  - 第 5 轮关闭后：207 节点；
  - 第 10 轮关闭后：207 节点；
  - 第 25 轮关闭后：207 节点；
  - 第 50 轮关闭后：**207 节点**！
  - **增量为 0**！没有未销毁的 Detached DOM 节点或孤儿组件残留。
- **JS 堆内存趋势**：
  - 第 1 轮：8.48 MiB；
  - 第 10 轮：9.68 MiB；
  - 第 50 轮：10.24 MiB；
  - 增长趋于平缓（后 40 轮仅微增 0.56 MiB），属于 V8 引擎对于常用构造器和 JIT 编译代码的正常分代内存驻留，未发现全局闭包泄漏、未解绑事件监听器或未释放的 DocumentManager 引用。

---

## 五、优化空间与方案收益预估

针对上述热点，制定以下明确的优化路线图：

| 优化阶段 | 核心改造对象 | 拟采取的优化方案 | 预期收益 |
|---|---|---|---|
| **Phase 02** | `CodeBlockView` & Live Editor | **静态高亮展示 + 按需激活 CM6 编辑器**：未聚焦或未处于视口的代码块仅使用轻量静态高亮 DOM 展示；点击或光标进入时动态激活为完整 CodeMirror 6 编辑器。 | 100 代码块 DOM 节点从 **10,800 降至 ~2,000**；CMView 实例数从 100 降至活动数（1~2 个）；内存降低 **40%~60%**。 |
| **Phase 02** | `DocumentManager` | 优化多标签与多 Pane 切换时的视图保留策略，非活动文档不维持冗余重型渲染视图。 | 标签多开场景（50~100 tabs）内存降低 **20%~30%**。 |
| **Phase 03** | `splitPreview.vue` & 渲染管道 | **渲染结果细粒度哈希缓存 + 局部更新**：引入块级内容校验，未修改的静态代码块、公式和图片不重复调用解析与 DOM 销毁；避免每次敲击触发全量 DOM 销毁。 | 连续键入时的瞬时 Detached DOM 产生量减少 **70%**；GC 频率明显下降。 |
| **Phase 03** | KaTeX & Mermaid | 对相同源码和渲染参数提供有界 LRU 缓存，Mermaid 引入懒挂载与异步取消。 | 大量公式/图表文档首次渲染与滚动内存峰值降低 **30%**。 |
| **Phase 04** | PDF / 图像 / Worker | 严格管控未激活标签页的 Canvas 分配，标签切出时及时清理页面 Canvas 像素；强化 Worker 与 Blob URL 的防御性回收。 | 媒体多标签长时间运行无显存与句柄泄漏。 |

---

## 六、阶段交付结论

已成功建立完整、严谨、可复现的基线数据与自动化测试工具集 `scripts/memory-baseline-suite.mjs`，原始数据与 Heap Snapshot 已持久化归档。核心内存热点与根因已精准定位。即刻按既定方案推进 **Phase 02：Markdown Live 与 CodeBlockView 轻量化改造**。
