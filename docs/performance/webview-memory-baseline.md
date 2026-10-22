# WebView2 内存基线：测量边界与复现

更新：2026-10-22，Phase 04.1。历史 Phase 07 JSON 不能证明本轮 Release 优化收益；旧报告中的原生下降值和绝对无泄漏结论已撤回。

## 三种宿主必须分别解释

| 类型 | 入口 | 能证明的范围 |
|---|---|---|
| Chromium 组件宿主 / Vite 开发模块 | `scripts/memory-baseline-suite.mjs`、`scripts/memory-chromium-ab.mjs` | 实际 Vue/DocumentManager/PM/CM 组件的创建数量、交互、JS Heap、DOM。包含开发模块开销，不能当成 Tauri 启动或 WebView2 原生进程内存。 |
| Windows WebView2 原生 Release | `scripts/memory-release-build.mjs`、`scripts/memory-native-ab.mjs` | 实际 Rust 应用和 WebView2 子进程组的 Private Bytes / Working Set；真实文件 IPC、PDF Worker 和图片查看器。专用标识、应用数据和 WebView 数据目录。 |
| 普通开发模式应用 | `pnpm tauri dev` | 本轮未测量；不得从前两类推算。 |

组件基线脚本现在自行生成宿主，先销毁编辑器并断言零编辑器，再采集 `Empty-component-host`。它并非空白原生应用。原生脚本启动无标签、无文档的实际欢迎页，断言没有 `.cm-editor`、`.markdown-live` 和文档标签，才采集 `blank`。

## 本轮 A/B 约定

- 前端基线：`00ad49a44b0bfef21017863a98bb02ef6b273aad`；本轮量测版本：`0ff6ebc36ddf476ca0eddc8dd3fa7d09e6c6e84e`，包含代码块懒创建、紧凑占位和 PDF 销毁握手修复。
- main 随后包含其他任务的 Callout / 动态目录提交和脚注工作区改动；这些不在上述 A/B 或 32/43 项浏览器源码快照验收范围内。
- 保持 main 分支；历史前端通过 Vite 只读源码覆盖构建，不切分支、不创建工作树。构建器要求 Rust 目录、依赖锁及 Vite 配置与目标提交一致。
- 两个专用 Release 均只增加相同的嵌入 CM 分配计数器和生产 DocumentManager 引用，未添加测试编辑器或 IPC Mock。普通产品构建不包含这些探针。
- 每个版本三轮；每轮独立 WebView 数据目录；重置专用应用配置与最近文件授权表；固定数据及场景顺序。
- 每场景采样约 3 秒：JS 约 250ms 间隔、原生每次 CIM 采集后间隔 250ms；CIM 自身耗时也在采样窗口内。随后强制 GC 两次，再采稳定值；关闭文档后再采三点回落趋势。
- 场景覆盖空白、TXT 1000 行、Markdown Live、10/50/100/200 代码块、Split、两个 Pane、PDF、图片、50 次原生打开/关闭。
- `sceneReadyMs` 是场景操作到就绪的时长，不是应用冷启动时间。首次累计 CM 创建数、初始化最大并存数与稳定并存数分别记录。
- CM 峰值由分配/销毁探针精确计数。JS Heap 和原生内存峰值是离散采样的下界，不得宣称捕捉到所有瞬时分配峰值。
- 分配探针只统计嵌入代码块 CM；TXT / Split 的源码 CM 用 DOM 挂载数另外记录。原生表的“嵌入 CM 峰值”为 0 不表示 TXT 没有源码编辑器。
- 三轮数据报告中位数、最近秩 P95、总体标准差与每轮原值。三轮不足以给出有统计置信度的总体 P95 或确定收益；并发测试负载、OS 文件缓存及 JIT/引擎缓存并未完全控制。

## 复现

```powershell
node scripts/memory-release-build.mjs --ref=00ad49a --label=before
node scripts/memory-release-build.mjs --ref=0ff6ebc --label=after
node scripts/memory-native-ab.mjs --label=before
node scripts/memory-native-ab.mjs --label=after
$env:MARKUMO_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/memory-chromium-ab.mjs --ref=00ad49a --label=before
node scripts/memory-chromium-ab.mjs --ref=0ff6ebc --label=after
node scripts/memory-ab-summary.mjs
node scripts/memory-baseline-suite.mjs
```

构建前检查 main。若以后原生源码或依赖已变化，构建器会拒绝用当前 Rust 搭配历史前端，以免错误标注提交来源；需要使用匹配的原生源码重新建立实验。

原生报告包含二进制 SHA256、提交、Rust tree、Windows 版本、WebView2 Runtime、显示尺寸、数据 SHA256、每次采样、关闭后的趋势和错误。组件报告单独记录 Chromium 版本。生成结果位于 `test-results/phase041/`；归档结果与本轮结论见 [优化验收](webview-memory-optimization.md) 和 [机器可读汇总](phase041-results.json)。

## 结论边界

稳定 DOM 计数不等于没有 Detached DOM；GC 后 Heap 平稳也不等于完全没有泄漏。有限轮次测试只能证明该负载和窗口内的观察结果。PDF 场景包含本轮销毁握手修复；图片实现本轮没有修改，图片场景的差异可能来自先前场景及引擎缓存，不能归因于图片实现优化。

并行任务会持续改动工作区时，可设置 `$env:MARKUMO_TEST_REF='0ff6ebc'` 后运行 `pnpm test:smoke` / `pnpm test:regression`。测试工具从 Git 对象读取该提交的源文件，在内存中交给真实 Vite 编译器，并禁用测试宿主 HMR；提前准备字面量依赖，避免 Live 懒导入期间 Vite 重新优化依赖并刷新页面。测试脚本和全部功能断言保留。该机制不修改源码、不创建工作树；普通 CI 不设置此变量，直接测试检出的源码。
