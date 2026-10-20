# Phase 07 / 07.1 测量与构建统计

生成：2026-10-20 11:20 Asia/Shanghai。基线 Commit `503153b849411a99938e0ed180804656b13f2be5`；Phase 07 性能修复 `1eb5337d692ea8b657e60868588a3d146a178b5b`（当前 HEAD）；Phase 07.1 修改仍在工作树，未提交。Phase 07 的原始数据保存在 `test-results/phase07/`，本阶段新增数据在 `test-results/phase07.1/`。

## 0. 摘要

| 项目 | Phase 07 | Phase 07.1 |
| --- | --- | --- |
| 依赖审计（全部 / 生产） | 17 / 0 | **0 / 0** |
| 严格 rustfmt / clippy | FAIL / FAIL | **PASS / PASS** |
| 50k Live 键入中位（冻结构建） | 26.7→33.9ms（未复现） | **25.8（baseline）/25.9（final）ms** |
| 30 分钟持续编辑 | 仅有 25 分钟中间轮 | **30.012 分钟完成，1775 组** |
| 50 次生命周期 DOM | 33→34 / 33→406 | **稳定 34；attached 22；PM/CM/toolbar 0** |
| Windows 安装/升级/签名 | Not Tested | **Not Tested / NotSigned（发布阻塞）** |

## 1. 50,000 行 Live 键入复核

使用冻结的 production 组件构建：baseline `browser-dist`（503153b，Vite 5）、Phase 07 最终 `browser-dist-delivery-clean`（Vite 5）、Phase 07.1 最终 `browser-dist-final-071`（Vite 6.4.4）。Chrome 155.0.8059.80，headless，1280×850，真实 `keyboard.press`，keydown→下一 rAF，每轮每构建 20 组 q/Backspace；三轮反转构建顺序。单位 ms。

| 构建 | 轮 1 中位 / P95 | 轮 2 中位 / P95 | 轮 3 中位 / P95 | 三轮中位 |
| --- | ---: | ---: | ---: | ---: |
| baseline | 26.0 / 27.7 | 25.7 / 27.1 | 25.8 / 33.5 | 25.8 |
| final-vite5 | 26.0 / 29.0 | 26.1 / 30.7 | 25.9 / 28.2 | 26.0 |
| final-vite6 | 25.9 / 27.1 | 26.3 / 27.7 | 26.6 / 27.9 | 25.9 |

9/9 轮（每轮 20 组，共 180 组按键）后 canonical source 完全恢复。**没有可复现的键入回退**；Phase 07 的 33.9ms 未在本轮复现。补充的“首段文本内光标”压力测试（30 组，`live-typing/results.json`）三构建均约 44–47ms，仍无构建间稳定差异。

真实 `insert + undo/redo` 50k 压力：baseline 约 8.26–8.73s/8.58–8.73s，final-vite5 约 155/151ms，final-vite6 约 153–156/153ms。该操作比 Phase 07 的简单 undo 表更重，但撤销优化关系保持。50k 首次建立（含等待 ready）约 9 秒，约 2.1 秒长任务，是既有极端边界，不是键入回退。

## 2. 真实键盘（Phase 07 冻结值，保留）

| 构建 | 模式/行数 | keydown→rAF 中位 [min–max] ms |
| --- | --- | ---: |
| baseline | text/1000 | 3.8 [2.2–6.3] |
| baseline | text/10000 | 4.1 [1.8–4.6] |
| baseline | text/50000 | 4.3 [1.8–4.7] |
| baseline | live/1000 | 4.6 [2.3–6.6] |
| baseline | live/10000 | 5.8 [5.4–10.2] |
| baseline | live/50000 | 26.7 [24.3–32.9] |
| final | text/1000 | 3.2 [1.9–8.3] |
| final | text/10000 | 3.4 [1.5–5.0] |
| final | text/50000 | 2.4 [1.4–5.3] |
| final | live/1000 | 3.4 [2.0–10.6] |
| final | live/10000 | 7.8 [5.8–12.4] |
| final | live/50000 | 33.9 [27.1–47.3] |

上表是 Phase 07 的冻结原始记录。Phase 07.1 用相同循环重测 50k live，baseline/final 均为约 26ms（见第 1 节），因此不把 33.9 当作最终结论。

### 组件操作与顺序反转复测（Phase 07）

| 操作 | 先基线后最终 | 先最终后基线 |
| --- | ---: | ---: |
| search-open-fill-match-close | 28.9→27.9 | 27.7→27.9 |
| mode-live-source-live | 15.4→17.4 | 17.3→16.2 |
| canonical-tab-round-trip | 12.3→13.3 | 13.4→12.8 |
| viewport-resize-round-trip | 17.5→22.1 | 22.3→17.3 |
| table-toolbar-menu-round-trip | 17.5→17.0 | 17.1→16.8 |

## 3. 真实 Windows release 启动

Phase 07 冻结值（baseline-delivery / final-delivery，每场景 5 次）：

| 场景 | shell-ready 基线 | shell-ready 最终 | 输入确认 基线 | 输入确认 最终 |
| --- | ---: | ---: | ---: | ---: |
| fresh-profile | 685.9 [613.3–1195.4] | 647.2 [553.5–1569.0] | 948.6 [853.6–1436.6] | 892.0 [798.8–1846.4] |
| warm-profile | 764.8 [670.6–902.6] | 797.8 [581.9–873.8] | 967.1 [865.9–1131.5] | 1014.0 [779.6–1061.2] |
| single-file | 625.8 [596.5–717.2] | 611.5 [604.3–688.1] | 814.6 [777.8–912.5] | 804.4 [793.6–894.3] |
| workspace-session | 730.4 [643.7–887.2] | 648.0 [616.8–698.9] | 967.6 [885.0–1139.8] | 900.6 [852.8–930.7] |
| history-10-tabs | 738.4 [677.8–904.5] | 716.5 [688.9–826.4] | 919.9 [852.0–1070.0] | 903.9 [852.9–1031.5] |
| large-workspace-100-tabs | 1245.1 [1181.5–1917.2] | 1263.7 [1219.2–1577.7] | 1484.6 [1420.5–2133.8] | 1544.3 [1501.5–1835.2] |

Phase 07.1 隔离 release（`native-startup-final-071`，WebView2 155.0.4283.62，30/30 通过）：

| 场景 | shell-ready 中位 [min–max] | 输入确认 中位 [min–max] |
| --- | ---: | ---: |
| fresh-profile | 693.6 [610.3–2251.2] | 958.2 [924.8–2535.9] |
| warm-profile | 628.7 [530.1–656.8] | 859.8 [727.6–875.5] |
| single-file | 639.7 [612.5–729.4] | 839.7 [789.8–926.0] |
| workspace-session | 633.1 [621.2–643.1] | 873.8 [860.0–889.8] |
| history-10-tabs | 783.4 [656.0–968.7] | 976.4 [840.5–1351.2] |
| large-workspace-100-tabs | 1188.5 [1153.6–1726.0] | 1430.6 [1389.0–1969.8] |

独立测试 ID/profile；fresh profile 不等于清空 OS 文件缓存；包含 CDP 附加、自动输入和关闭握手成本。未发现相对 Phase 07 的稳定启动回退。

## 4. 持续编辑与 GC 趋势

`test-results/phase07/delivery-clean/results.json` 是完整 30 分钟结果：

| 构建 | 完成 | 分钟 / 输入删除组 | GC 样本 | Heap MiB min/median/max | 第 5 分钟后斜率 MiB/min |
| --- | --- | ---: | ---: | ---: | ---: |
| baseline | PASS | 30.0098 / 1764 | 31 | 13.517/14.540/14.645 | 0.00727 |
| final（Phase 07.1 采用；Phase 07 最终工作树构建） | PASS | **30.0122 / 1775** | 31 | 9.983/11.022/11.105 | 0.00755 |
| final 旧 25 分钟中间轮（保留，不作最终） | 未完成 | 25.0109 / 1481 | 26 | 9.983/11.009/11.085 | 0.00884 |

30 分钟结束断言 canonical source 完全恢复，`passed=true`，`completedAt=2026-10-20T02:17:52.290Z`，错误数 0。`summary.json` 的 `memory.final` 仍是旧的 25 分钟中间轮；它没有被覆盖，也不再作为最终测试。内存结论只采用 baseline-clean / delivery-clean。

## 5. 50 次资源循环与 DOM/Heap 复核

| 50 次资源循环 | GC 后 DOM 起点→终点 | 第 10 次后 DOM min–max | 最终 Heap MiB |
| --- | ---: | ---: | ---: |
| baseline/lifecycle | 33→34 | 34–406 | 13.4 |
| baseline/media | 43→166 | 166–166 | 5.7 |
| final/lifecycle | **33→34（settled）** | **34** | 10.0 |
| final/media | 43→50 | 50–166 | 5.6 |

Phase 07.1 诊断（`lifecycle-diagnostic/results.json`，50 次）：

- 第 1 次 immediate=406，下一帧/50ms/500ms 均为 34；其余 49 次 immediate 即为 34。
- `attached` 始终 22；`settledOver100=[]`；`pm=0, cm=0, toolbars=0`。
- heap 约 6.04→7.62 MiB，前 10 次后趋于平稳；结束时 heapsnapshot 仅保留 12 个常量 detached wrapper，无每循环增长。
- 早期诊断版本每循环 +362 节点，定位为 Playwright `waitForFunction` 返回 EditorView 对象导致远端句柄保留；改成 `!!` 布尔谓词后增长消失。这不是产品泄漏，独立复现了 Phase 07 已记录的宿主假增长。
- 406 的时间点差异（baseline 也有）是异步清理/采样时机；不是未释放的工具栏、ProseMirror 或监听器。

循环按每 5 次 forced GC 采样；峰值可含临时异步节点。PDF/图片最终 Blob URL 和 Worker 均须归零，具体 counters 保留在原始 JSON。

| 最终组件场景 | GC 后 Heap MiB | DOM nodes |
| --- | ---: | ---: |
| ordinary-markdown | 4.7 | 352 |
| large-markdown-50000-lines | 25.2 | 50150 |
| code-blocks | 7.4 | 1993 |
| image-references | 6.7 | 593 |
| two-live-panes | 6.7 | 282 |
| disposed-editors | 6.6 | 34 |
| single.pdf | 4.5 | 276 |
| transparent.png | 4.4 | 158 |

| 原生最终场景 | Rust Private MiB | WebView 子进程 Private MiB 总和 | Rust handles | Rust threads | WebView 子进程数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fresh-profile | 5.9 [5.6–6.0] | 187.2 [186.5–188.0] | 365.0 [365.0–367.0] | 28.0 [28.0–28.0] | 6.0 [6.0–6.0] |
| warm-profile | 5.9 [5.6–5.9] | 186.8 [184.5–188.3] | 365.0 [365.0–365.0] | 28.0 [28.0–28.0] | 6.0 [6.0–6.0] |
| single-file | 5.7 [5.6–5.9] | 193.1 [192.1–195.5] | 365.0 [365.0–367.0] | 28.0 [28.0–28.0] | 6.0 [6.0–6.0] |
| workspace-session | 6.1 [5.7–6.8] | 202.7 [201.2–203.1] | 365.0 [365.0–365.0] | 28.0 [28.0–28.0] | 6.0 [6.0–6.0] |
| history-10-tabs | 6.0 [5.8–6.2] | 195.7 [194.5–199.9] | 365.0 [365.0–365.0] | 28.0 [28.0–28.0] | 6.0 [6.0–6.0] |
| large-workspace-100-tabs | 6.4 [6.3–6.5] | 225.4 [218.9–225.9] | 365.0 [365.0–365.0] | 28.0 [28.0–28.0] | 6.0 [6.0–6.0] |

每个原生样本为独立进程启动，不能据此证明单个原生进程连续 30 分钟的句柄/token/线程趋势。组件媒体传输是替身，decoder/worker/view 为真实实现。

## 6. 构建产物

| 项目 | Phase 07 最终字节 | Phase 07.1 字节 | 差额 |
| --- | ---: | ---: | ---: |
| 前端 dist | 12,577,224 | 12,571,319 | -5,905 |
| 初始 JS（入口+modulepreload） | 1,285,273 | 1,283,141 | -2,132 |
| 生产 exe | 25,001,984 | 24,976,384 | -25,600 |
| Windows x64 NSIS | 9,878,287 | 9,875,111 | -3,176 |

production build 观测 15.36s（Phase 07）→12.72–13.15s（本阶段）；不是受控基准。dist source maps：0。

| 本阶段大 chunk | 字节 | 用途 |
| --- | ---: | --- |
| dist/assets/index-CfalAMoY.js | 867,211 | 应用或依赖代码 |
| dist/assets/cynefin-OW5HDTMX-CdyKL1m9.js | 690,855 | Mermaid/图布局 |
| dist/assets/mermaid.core-DCikRDRV.js | 605,949 | Mermaid/图布局 |
| dist/assets/pdf-BtCWNl9F.js | 483,739 | PDF.js/图片解码 |
| dist/assets/cytoscape.esm-Ix0LnXOy.js | 443,834 | Mermaid/图布局 |
| dist/assets/editor-core-DYQglWsG.js | 415,930 | CodeMirror core |
| dist/assets/MarkdownEditorController-B8kHV6DO.js | 382,011 | 懒加载 Live editor |
| dist/assets/katex-Cp5iPVkt.js | 261,901 | 数学公式 |

### 生产产物 SHA-256（Phase 07.1）

- `test-results/phase07.1/native-final/markumo-production.exe`: `de8734e0a107ae0b0a2a249b1c2fdd9139bb81753614c9470d3cda16023e0c26`
- `test-results/phase07.1/native-final/Markumo_1.0.4_x64-setup.exe`: `d2bde7232b904f969d3984733a62b707a80a9cd5a6f42551672f79d6e16018b3`

Authenticode 实查：两者均 **NotSigned**；本机现有 `D:\tools\Markumo` 的 exe/uninstaller 也均 NotSigned。未安装、未发布、未创建签名密钥，未生成可验收的 `.exe.sig`。

## 7. 平台范围

| 平台 | 本阶段实际状态 |
| --- | --- |
| Windows x64 | 真实隔离 release 启动/关闭/会话恢复/PDF；NSIS 构建；安装/升级/关联/IME **Not Tested**；签名 **NotSigned** |
| Linux | 本阶段新代码、安装/桌面 **Not Tested**；基线 Ubuntu CI 不能外推 |
| macOS Intel/ARM | **Not Tested** |
| 原生 PDF 导出 | 仅 Windows WebView2 实现；不得宣称全平台 |

Phase 07.1 完整回归 26/26、Smoke 15/15、Rust 109 passed / 1 ignored；Extended Quality 工作流已准备但远程 **Not Run**。
