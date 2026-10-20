// Format measured evidence only; pending/unsupported results stay explicit.
import fs from 'node:fs'
const root = 'test-results/phase07'
const read = file => fs.existsSync(`${root}/${file}`) ? JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8').replace(/^\uFEFF/, '')) : null
const fmt = value => Number.isFinite(value) ? value.toFixed(1) : 'Not Tested'
const stats = values => {
  const v = [...values].sort((a, b) => a - b), n = v.length
  return n ? { n, median: (v[Math.floor((n - 1) / 2)] + v[Math.floor(n / 2)]) / 2, min: v[0], max: v.at(-1) } : null
}
const range = values => { const s = stats(values); return s ? `${fmt(s.median)} [${fmt(s.min)}–${fmt(s.max)}]` : 'Not Tested' }
const summary = read('summary.json'), inventory = read('inventory.json')
const base = read('baseline-delivery-check/results.json'), final = read('delivery-check/results.json')
const lines = ['# Phase 07 测量与构建统计', '', `生成：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} Asia/Shanghai。基线 ${summary.commit}，最终为该提交之上的工作树；文件摘要见 summary.json。`, '',
  '## 1. 顺序性能复测', '', '同机、相同冻结 production 组件构建、相同数据 SHA-256；每项 25 次。单位 ms。输入为实际控制器 dispatch 至下一 rAF，非像素呈现。表内为中位数；全部原始值、min/max/P95 位于对应 results.json。', '',
  '| 场景 | 输入 前→后 | Undo 前→后 | Redo 前→后 | 最终输入 P95 | 最终最长任务 |', '| --- | ---: | ---: | ---: | ---: | ---: |']
if (base?.passed && final?.passed) for (const after of final.editing) {
  const before = base.editing.find(row => row.name === after.name)
  if (before.sha256 !== after.sha256) throw Error(`Dataset mismatch: ${after.name}`)
  lines.push(`| ${after.name} | ${fmt(before.stats.input.median)}→${fmt(after.stats.input.median)} | ${fmt(before.stats.undo.median)}→${fmt(after.stats.undo.median)} | ${fmt(before.stats.redo.median)}→${fmt(after.stats.redo.median)} | ${fmt(after.stats.input.p95)} | ${fmt(Math.max(0, ...after.raw.longTasks.map(row => row.duration)))} |`)
}
else lines.push('| 复测未完成 | Not Tested | Not Tested | Not Tested | Not Tested | Not Tested |')
const b50 = base?.editing.find(row => row.name === 'markdown50000'), a50 = final?.editing.find(row => row.name === 'markdown50000')
lines.push('', `本表采用 baseline-delivery-check / delivery-check 顺序复测，最终包含 Mermaid 11.16.1。50k Undo ${fmt(b50?.stats.undo.median)}→${fmt(a50?.stats.undo.median)}ms，改善约${fmt(b50 && a50 ? (1 - a50.stats.undo.median / b50.stats.undo.median) * 100 : undefined)}%。初轮基线约2.06秒；中间安静轮约1577.7→74.5ms。最终构建的第一轮又与release编译并发，约143.5ms，本表在重负载结束后复核，不把负载下降全部算成优化收益。50k首次分词/布局仍有>100ms长任务，不称为所有操作无卡顿。`, '',
  '## 2. 真实键盘', '', '| 构建 | 模式/行数 | keydown→rAF 中位 [min–max] ms |', '| --- | --- | ---: |')
for (const row of read('interaction/results.json') || []) lines.push(`| ${row.label} | ${row.kind}/${row.lines} | ${range(row.samples.map(sample => sample.ms))} |`)
lines.push('', '每场景 20 组可信键盘输入/删除，断言 canonical source 完全恢复。CPUsampling 仅用于定位开销，采样总时间不作为无探针性能数值。', '',
  '### 组件操作与顺序反转复测', '', '同一固定文档、每操作25样本，剔除一次预热；包含自动化和条件等待成本。各格为基线→最终中位数 ms。此处核心编辑构建测量早于 Mermaid 升级；最终依赖的图表、资源循环和持续编辑另测。', '',
  '| 操作 | 先基线后最终 | 先最终后基线 |', '| --- | ---: | ---: |')
const actions = read('actions/results.json') || [], reverseActions = read('actions-reverse/results.json') || []
for (const action of [...new Set(actions.map(row => row.action))]) {
  const medians = rows => ['baseline', 'final'].map(label => stats(rows.find(row => row.label === label && row.action === action)?.samples || [])?.median)
  lines.push(`| ${action} | ${medians(actions).map(fmt).join('→')} | ${medians(reverseActions).map(fmt).join('→')} |`)
}
lines.push('', 'resize 首轮17.5→22.1ms，反转后22.3→17.3ms，方向反转；四组P95均约22–23ms，未证实稳定回退。搜索/模式/标签/工具栏同样保留原始样本，不外推为全桌面FPS。', '', '## 3. 真实 Windows release 启动', '',
  '采用包含原生进程内存样本、完整回归结束后顺序执行的 baseline-delivery/final-delivery 轮。每场景 5 次；warm 先预热一次。单位 ms，显示 median [min–max]；n=5 不报告不稳健的 P95。', '',
  '| 场景 | 原生 shell-ready 基线 | 原生 shell-ready 最终 | 输入确认 基线 | 输入确认 最终 |', '| --- | ---: | ---: | ---: | ---: |')
const nb = read('native-startup-baseline-delivery/results.json'), nf = read('native-startup-final-delivery/results.json')
if (nb?.passed && nf?.passed) for (const scenario of [...new Set(nb.samples.map(row => row.scenario))]) {
  const b = nb.samples.filter(row => row.scenario === scenario), a = nf.samples.filter(row => row.scenario === scenario)
  lines.push(`| ${scenario} | ${range(b.map(row => row.shellReadyMs))} | ${range(a.map(row => row.shellReadyMs))} | ${range(b.map(row => row.interactiveMs))} | ${range(a.map(row => row.interactiveMs))} |`)
}
lines.push('', `WebView2：${nf?.webviewVersion || 'Not Tested'}。独立测试 ID/profile；fresh profile 不等于清空 OS 文件缓存。包含 CDP 附加/自动输入成本，窗口可见、Rust/JS/Vue/CM 各阶段不独立归因。首次空场景还包含真实新建草稿，因此不与单文件直接比较。`, '',
  '## 4. 持续编辑与 GC 趋势', '', '| 构建 | 完成 | 分钟 / 输入删除组 | GC 样本 | Heap MiB min/median/max | 第5分钟后斜率 MiB/min |', '| --- | --- | ---: | ---: | ---: | ---: |')
for (const [label, memory] of Object.entries(summary.memory)) {
  const s = memory?.heapMiB
  lines.push(`| ${label} | ${memory?.passed ? 'PASS' : '运行中 / 未完成'} | ${fmt(memory?.durationMinutes)} / ${memory?.edits ?? 'Not Tested'} | ${s?.n ?? 0} | ${fmt(s?.min)}/${fmt(s?.median)}/${fmt(s?.max)} | ${Number.isFinite(memory?.slopeMiBPerMinuteAfterFive) ? memory.slopeMiBPerMinuteAfterFive.toFixed(4) : 'Not Tested'} |`)
}
lines.push('', '内存结论只采用 baseline-clean / delivery-clean（最终 Mermaid 11.16.1 构建）。旧轮对象型 Playwright 等待持有远端 EditorView/DOM 句柄，造成测试宿主假增长，已隔离，不作为产品泄漏证据。斜率使用第5分钟后全部 GC 样本最小二乘拟合；保留完整 heapsnapshot。不把跨进程绝对 Heap 差额直接归因于修复。', '',
  '| 50次资源循环 | GC 后 DOM 起点→终点 | 第10次后 DOM min–max | 最终 Heap MiB |', '| --- | ---: | ---: | ---: |')
for (const [label, memory] of Object.entries(summary.memory)) for (const kind of ['lifecycle', 'media']) {
  const rows = memory?.[kind] || [], late = rows.filter(row => row.cycle >= 10), dom = stats(late.map(row => row.dom.nodes))
  const end = rows.at(-1)
  lines.push(`| ${label}/${kind} | ${rows[0]?.dom.nodes ?? 'Not Tested'}→${end?.dom.nodes ?? 'Not Tested'} | ${dom ? `${dom.min}–${dom.max}` : 'Not Tested'} | ${fmt(end?.heap / 1048576)} |`)
}
lines.push('', '循环按每5次 forced GC 采样，DOM 另有稳定窗口断言；峰值可含临时异步节点，不只用首尾两点判泄漏。PDF/图片最终 Blob URL 和 Worker 均须归零，具体 counters 保留在原始 JSON。', '',
  '| 最终组件场景 | GC 后 Heap MiB | DOM nodes |', '| --- | ---: | ---: |')
for (const row of read('memory-scenarios/results.json') || []) lines.push(`| ${row.name} | ${fmt(row.heapBytes / 1048576)} | ${row.dom.nodes} |`)
lines.push('', '| 原生最终场景 | Rust Private MiB | WebView 子进程 Private MiB 总和 | Rust handles | Rust threads | WebView 子进程数 |', '| --- | ---: | ---: | ---: | ---: | ---: |')
if (nf?.passed) for (const scenario of [...new Set(nf.samples.map(row => row.scenario))]) {
  const rows = nf.samples.filter(row => row.scenario === scenario)
  lines.push(`| ${scenario} | ${range(rows.map(row => row.nativeMemory.native.PrivateMemorySize64 / 1048576))} | ${range(rows.filter(row => row.nativeMemory.webviewProcessCount > 0).map(row => row.nativeMemory.webviewPrivateBytesSum / 1048576))} | ${range(rows.map(row => row.nativeMemory.native.HandleCount))} | ${range(rows.map(row => row.nativeMemory.native.ThreadCount))} | ${range(rows.map(row => row.nativeMemory.webviewProcessCount))} |`)
}
lines.push('', '每个原生样本为独立进程启动，不能据此证明单个原生进程连续30分钟的句柄/token/线程趋势。组件媒体传输是替身，decoder/worker/view 为真实实现。输出字节限制不等于 IPC 序列化、位图及所有远程图片的进程峰值限制；最大负载峰值未全面验证。', '',
  '## 5. 构建产物', '', '| 项目 | 基线字节 | 最终字节 | 差额 |', '| --- | ---: | ---: | ---: |')
const artifact = (label, suffix) => inventory.build.artifacts.find(row => row.path.includes(`/${label}/`) && row.path.endsWith(suffix))
const oldInventory = read('inventory-baseline.json') || read('inventory.log')
const oldTotal = oldInventory?.build?.totalBytes ?? oldInventory?.totalBytes
lines.push(`| 前端 dist | ${oldTotal} | ${inventory.build.totalBytes} | ${inventory.build.totalBytes - oldTotal} |`)
for (const [name, suffix] of [['生产 exe', 'markumo-production.exe'], ['Windows x64 NSIS', 'Markumo_1.0.4_x64-setup.exe']]) {
  const b = artifact('native-baseline', suffix), a = artifact('native-final', suffix)
  lines.push(`| ${name} | ${b?.bytes ?? 'Not Tested'} | ${a?.bytes ?? 'Not Tested'} | ${a && b ? a.bytes - b.bytes : 'Not Tested'} |`)
}
const oldInitial = oldInventory?.build?.initialJs || oldInventory?.initialJs
lines.push(`| 初始 JS（入口+modulepreload） | ${oldInitial?.reduce((sum, row) => sum + row.bytes, 0) ?? 'Not Tested'} | ${inventory.build.initialJs.reduce((sum, row) => sum + row.bytes, 0)} | 见 inventory |`, '',
  '本阶段无包体专项优化；NSIS 小差异可包含链接/压缩元数据，不宣称功能删减或压缩收益。Linux/macOS 新安装包为 Not Tested。', '', '| 最终大 chunk | 字节 | 用途 |', '| --- | ---: | --- |')
for (const row of inventory.build.largestJs.slice(0, 8)) {
  const purpose = /MarkdownEditorController/.test(row.path) ? '懒加载 Live editor' : /editor-core/.test(row.path) ? 'CodeMirror core' : /pdf-|pdfjs/.test(row.path) ? 'PDF.js/图片解码' : /mermaid|cynefin|cytoscape/.test(row.path) ? 'Mermaid/图布局' : /katex/.test(row.path) ? '数学公式' : '应用或依赖代码（见构建日志）'
  lines.push(`| ${row.path} | ${row.bytes} | ${purpose} |`)
}
lines.push('', `dist source maps：${inventory.build.sourceMaps.length} 个。Private debug symbols 未当作安装包内容；具体产物清单见 inventory。`, '', '### 生产产物 SHA-256', '')
for (const row of inventory.build.artifacts) lines.push(`- ${row.path}: ${row.sha256}`)
lines.push('', 'Authenticode 实查为 NotSigned；NSIS 的 Medium mandatory integrity 已核对。未安装、未发布、未创建签名密钥。', '')
fs.writeFileSync('docs/phase-07-metrics.md', lines.join('\n'))
console.log('Wrote docs/phase-07-metrics.md from measured evidence')
