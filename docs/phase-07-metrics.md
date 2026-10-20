# Phase 07 测量与构建统计

生成：2026/10/20 10:12:56 Asia/Shanghai。基线 503153b849411a99938e0ed180804656b13f2be5，最终为该提交之上的工作树；文件摘要见 summary.json。

## 1. 顺序性能复测

同机、相同冻结 production 组件构建、相同数据 SHA-256；每项 25 次。单位 ms。输入为实际控制器 dispatch 至下一 rAF，非像素呈现。表内为中位数；全部原始值、min/max/P95 位于对应 results.json。

| 场景 | 输入 前→后 | Undo 前→后 | Redo 前→后 | 最终输入 P95 | 最终最长任务 |
| --- | ---: | ---: | ---: | ---: | ---: |
| text1000 | 5.6→5.6 | 5.5→5.4 | 5.8→5.7 | 5.8 | 0.0 |
| text10000 | 5.7→5.7 | 5.5→5.4 | 5.7→5.6 | 5.9 | 0.0 |
| text50000 | 5.6→5.7 | 5.6→5.5 | 5.7→5.6 | 5.9 | 0.0 |
| longLine | 6.0→5.9 | 5.6→5.6 | 5.5→5.5 | 6.2 | 0.0 |
| markdown1000 | 5.5→5.5 | 9.0→5.6 | 9.1→5.5 | 5.7 | 0.0 |
| markdown10000 | 5.6→5.5 | 185.9→14.5 | 198.4→15.1 | 6.2 | 59.0 |
| markdown50000 | 26.5→22.2 | 1579.9→72.1 | 1601.3→72.0 | 31.5 | 287.0 |
| code | 5.7→5.6 | 5.5→5.5 | 5.6→5.6 | 5.8 | 0.0 |
| tables | 5.9→5.9 | 8.3→6.3 | 8.3→5.7 | 13.6 | 0.0 |
| images | 5.5→5.6 | 19.5→5.6 | 10.2→5.6 | 5.8 | 0.0 |
| dualPane | 5.5→5.6 | 5.6→5.4 | 5.6→5.5 | 5.8 | 0.0 |

本表采用 baseline-delivery-check / delivery-check 顺序复测，最终包含 Mermaid 11.16.1。50k Undo 1579.9→72.1ms，改善约95.4%。初轮基线约2.06秒；中间安静轮约1577.7→74.5ms。最终构建的第一轮又与release编译并发，约143.5ms，本表在重负载结束后复核，不把负载下降全部算成优化收益。50k首次分词/布局仍有>100ms长任务，不称为所有操作无卡顿。

## 2. 真实键盘

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

每场景 20 组可信键盘输入/删除，断言 canonical source 完全恢复。CPUsampling 仅用于定位开销，采样总时间不作为无探针性能数值。

### 组件操作与顺序反转复测

同一固定文档、每操作25样本，剔除一次预热；包含自动化和条件等待成本。各格为基线→最终中位数 ms。此处核心编辑构建测量早于 Mermaid 升级；最终依赖的图表、资源循环和持续编辑另测。

| 操作 | 先基线后最终 | 先最终后基线 |
| --- | ---: | ---: |
| search-open-fill-match-close | 28.9→27.9 | 27.7→27.9 |
| mode-live-source-live | 15.4→17.4 | 17.3→16.2 |
| canonical-tab-round-trip | 12.3→13.3 | 13.4→12.8 |
| viewport-resize-round-trip | 17.5→22.1 | 22.3→17.3 |
| table-toolbar-menu-round-trip | 17.5→17.0 | 17.1→16.8 |

resize 首轮17.5→22.1ms，反转后22.3→17.3ms，方向反转；四组P95均约22–23ms，未证实稳定回退。搜索/模式/标签/工具栏同样保留原始样本，不外推为全桌面FPS。

## 3. 真实 Windows release 启动

采用包含原生进程内存样本、完整回归结束后顺序执行的 baseline-delivery/final-delivery 轮。每场景 5 次；warm 先预热一次。单位 ms，显示 median [min–max]；n=5 不报告不稳健的 P95。

| 场景 | 原生 shell-ready 基线 | 原生 shell-ready 最终 | 输入确认 基线 | 输入确认 最终 |
| --- | ---: | ---: | ---: | ---: |
| fresh-profile | 685.9 [613.3–1195.4] | 647.2 [553.5–1569.0] | 948.6 [853.6–1436.6] | 892.0 [798.8–1846.4] |
| warm-profile | 764.8 [670.6–902.6] | 797.8 [581.9–873.8] | 967.1 [865.9–1131.5] | 1014.0 [779.6–1061.2] |
| single-file | 625.8 [596.5–717.2] | 611.5 [604.3–688.1] | 814.6 [777.8–912.5] | 804.4 [793.6–894.3] |
| workspace-session | 730.4 [643.7–887.2] | 648.0 [616.8–698.9] | 967.6 [885.0–1139.8] | 900.6 [852.8–930.7] |
| history-10-tabs | 738.4 [677.8–904.5] | 716.5 [688.9–826.4] | 919.9 [852.0–1070.0] | 903.9 [852.9–1031.5] |
| large-workspace-100-tabs | 1245.1 [1181.5–1917.2] | 1263.7 [1219.2–1577.7] | 1484.6 [1420.5–2133.8] | 1544.3 [1501.5–1835.2] |

WebView2：155.0.4283.62。独立测试 ID/profile；fresh profile 不等于清空 OS 文件缓存。包含 CDP 附加/自动输入成本，窗口可见、Rust/JS/Vue/CM 各阶段不独立归因。首次空场景还包含真实新建草稿，因此不与单文件直接比较。

## 4. 持续编辑与 GC 趋势

| 构建 | 完成 | 分钟 / 输入删除组 | GC 样本 | Heap MiB min/median/max | 第5分钟后斜率 MiB/min |
| --- | --- | ---: | ---: | ---: | ---: |
| baseline | PASS | 30.0 / 1764 | 31 | 13.5/14.5/14.6 | 0.0073 |
| final | 运行中 / 未完成 | 25.0 / 1481 | 26 | 10.0/11.0/11.1 | 0.0088 |

内存结论只采用 baseline-clean / delivery-clean（最终 Mermaid 11.16.1 构建）。旧轮对象型 Playwright 等待持有远端 EditorView/DOM 句柄，造成测试宿主假增长，已隔离，不作为产品泄漏证据。斜率使用第5分钟后全部 GC 样本最小二乘拟合；保留完整 heapsnapshot。不把跨进程绝对 Heap 差额直接归因于修复。

| 50次资源循环 | GC 后 DOM 起点→终点 | 第10次后 DOM min–max | 最终 Heap MiB |
| --- | ---: | ---: | ---: |
| baseline/lifecycle | 33→34 | 34–406 | 13.4 |
| baseline/media | 43→166 | 166–166 | 5.7 |
| final/lifecycle | 33→406 | 34–406 | 10.0 |
| final/media | 43→50 | 50–166 | 5.6 |

循环按每5次 forced GC 采样，DOM 另有稳定窗口断言；峰值可含临时异步节点，不只用首尾两点判泄漏。PDF/图片最终 Blob URL 和 Worker 均须归零，具体 counters 保留在原始 JSON。

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

每个原生样本为独立进程启动，不能据此证明单个原生进程连续30分钟的句柄/token/线程趋势。组件媒体传输是替身，decoder/worker/view 为真实实现。输出字节限制不等于 IPC 序列化、位图及所有远程图片的进程峰值限制；最大负载峰值未全面验证。

## 5. 构建产物

| 项目 | 基线字节 | 最终字节 | 差额 |
| --- | ---: | ---: | ---: |
| 前端 dist | 12388221 | 12577224 | 189003 |
| 生产 exe | 24940544 | 25001984 | 61440 |
| Windows x64 NSIS | 9819366 | 9878287 | 58921 |
| 初始 JS（入口+modulepreload） | 1285273 | 1285273 | 见 inventory |

本阶段无包体专项优化；NSIS 小差异可包含链接/压缩元数据，不宣称功能删减或压缩收益。Linux/macOS 新安装包为 Not Tested。

| 最终大 chunk | 字节 | 用途 |
| --- | ---: | --- |
| dist/assets/index-CeOaR76s.js | 864190 | 应用或依赖代码（见构建日志） |
| dist/assets/cynefin-OW5HDTMX-DIjArnws.js | 689660 | Mermaid/图布局 |
| dist/assets/mermaid.core-C7cO2C1-.js | 604109 | Mermaid/图布局 |
| dist/assets/pdf-Cz89Y5nm.js | 490185 | PDF.js/图片解码 |
| dist/pdfjs/wasm/openjpeg_nowasm_fallback.js | 445781 | PDF.js/图片解码 |
| dist/assets/cytoscape.esm-C5JX3QLV.js | 443805 | Mermaid/图布局 |
| dist/assets/editor-core-BSCR9nAD.js | 421083 | CodeMirror core |
| dist/assets/MarkdownEditorController-dYRKdGY7.js | 382056 | 懒加载 Live editor |

dist source maps：0 个。Private debug symbols 未当作安装包内容；具体产物清单见 inventory。

### 生产产物 SHA-256

- test-results/phase07/native-baseline/markumo-production.exe: ccfba3ad7ea00339ea1778747463de48ddd4d9d8f9711931e51cbee5b2dde12c
- test-results/phase07/native-baseline/Markumo_1.0.4_x64-setup.exe: c03cc4d26618a54a57b3e7a911c44c337238460f7f162c26b66d828f583d1f7f
- test-results/phase07/native-final/markumo-production.exe: fc76db017ee9807dd013509119e98f1f5de47d421e0d05023e5805c4ce17b6e5
- test-results/phase07/native-final/Markumo_1.0.4_x64-setup.exe: ed0ff954fc9b03ffd5d483ff7001e2e1512141e562f43a5f8d31550b73dffc39

Authenticode 实查为 NotSigned；NSIS 的 Medium mandatory integrity 已核对。未安装、未发布、未创建签名密钥。
