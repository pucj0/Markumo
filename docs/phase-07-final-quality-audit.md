# Markumo Phase 07.1 — 最终发布质量收尾与 Release Candidate 复核

日期：2026-10-20，Asia/Shanghai。仓库：https://github.com/yuanmahome/Markumo。

**结论：B — Conditional RC。** Phase 07 的工程阻塞项已经闭环：开发依赖公告 17→0、严格 Rust 检查真正通过、DOCX 远程图片 SSRF 修复并有红/绿证据、50,000 行 Live 键入复测未确认回退、30 分钟持续编辑原始结果完整、50 次生命周期 DOM 差异已用真实对象生命周期和堆快照解释。公开发布仍被三项发布条件阻塞：没有受信任代码签名证书、没有可用的隔离安装/升级环境、Linux/macOS 未测试；远程 Extended Quality 也因本轮不推送代码而尚未执行。不得把本结论理解为 A 或已可公开发布。

三档口径：**A** = 可公开发布（未授予）；**B** = 工程 RC 可提交人工评审、但发布条件未满足（本结论）；**C** = 仍有未解决的工程阻塞（Phase 07 的原因已清除，本阶段不再成立）。

## 1. 基线、工作树与范围

- 基线 Commit / 当前 `HEAD`：`1eb5337d692ea8b657e60868588a3d146a178b5b`（Phase 07 的性能修复提交）。
- 本阶段修改仍在工作树，**未创建新 Commit、未修改版本号（1.0.4）、未创建 Tag、未发布 Release、未推送远程**，按任务要求在本地测试后停止等待人工审查。
- 三处既有用户修改保留且未覆盖：`src/editor/languages/index.ts`、`src/features/document-conversion/ExportAppearance.ts`、`src/features/document-conversion/ExportStyles.ts`。其 LF 规范化内容仍等同于基线。
- 保留的工程约束：Markdown 源块复用与撤销优化、DocumentManager 单一权威状态、MarkdownSourceBridge 源码保真、文件保存/冲突检查、Windows 文件身份保护、ConversionLease、媒体预算、更新签名及安装保护。本阶段没有回滚这些实现，也没有降低 50,000 行文档上限或撤销历史。
- 本地与远程证据目录：`test-results/phase07.1/`（本轮）与 `test-results/phase07/`（Phase 07 冻结原始资料）。大型构建、堆快照和日志留在忽略目录，不加入 Git。

## 2. 环境与测试层级

| 项目 | 实际环境 |
| --- | --- |
| Windows | Windows 11 家庭版中文版 10.0.26200，x64 |
| CPU / 内存 | i5-12600KF，10 核 / 16 线程；68,520,194,048 字节物理内存 |
| Node / pnpm | Node v22.2.0；pnpm 12.11.2 |
| Rust | cargo / rustc 1.99.0 |
| 浏览器 | 系统 Chrome 155.0.8059.80（冻结构建组件测试）；真实桌面 WebView2 155.0.4283.62 |
| 构建 | Vite 6.4.4 production build；Vitest 不适用，回归为真实 Chromium 组件宿主 |
| 转换 | Pandoc 3.8.3；真实 Windows WebView2 PDF 测试 |
| 桌面 | 隔离应用 ID `com.markumo.phase07-audit`、独立 profile、release 构建、CDP 附加 |
| Linux / macOS | 本机无可用 Docker Engine、无 macOS；本阶段新代码 Not Tested |

组件宿主直接导入实际实现；媒体/工作区 IPC 使用 fixture transport，因此它证明真实组件和控制器，不等同于原生安装后的完整 GUI 验收。

### 2.1 Phase 07 保留能力复核

| 保留项 | 本阶段复核 |
| --- | --- |
| Markdown 源块复用、撤销/重做优化 | 50k 按键 9/9 轮源码恢复；insert+undo/redo 0.153–0.156s，未回滚 |
| DocumentManager 单一权威状态 | 完整 Regression 的 document-manager/file-save 通过；无第二权威状态 |
| MarkdownSourceBridge 源码保真 | 9/9 轮、180 组真实按键后 canonical source 完全一致 |
| 文件保存与冲突检查 | file-save 回归与原生 atomic 测试通过 |
| Windows 现有文件身份保护 | 原生 files/media 测试通过；未改 cfg 语义 |
| ConversionLease 授权 | conversion 回归、原生 lease/超时/取消测试通过 |
| 媒体资源预算 | media 回归、50 次 PDF/图片循环、Blob/Worker 归零 |
| Mermaid 11.16.1 图表安全 | diagram-security 回归通过；未降级 |
| 更新签名及安装保护 | 配置/静态检查通过；真实签名/安装验收仍为发布阻塞，见第 8 节 |

这些是“没有回滚”的复核，不替代 Phase 07 已记录的完整历史证据；原始资料仍在 `test-results/phase07/`。

## 3. P1：开发依赖安全公告

### 3.1 升级前后完整审计

使用官方 npm registry，命令：

```bash
pnpm audit --json --registry=https://registry.npmjs.org
pnpm audit --prod --json --registry=https://registry.npmjs.org
```

| 时点 | 全部依赖 | 生产依赖 |
| --- | --- | --- |
| 升级前 | **17** 条：2 low、13 moderate、2 high | **0** |
| 升级后 | **0** | **0** |

升级前锁定版本与直接修复路径：

| 包 | 升级前 | 升级后 |
| --- | --- | --- |
| `vite` | 5.2.0 | 6.4.4 |
| `esbuild` | 0.20.1（Vite 传递依赖） | 0.25.12（Vite 6.4.4 传递依赖） |
| `@vitejs/plugin-vue` | 5.0.4 | 5.2.4 |
| `vue-tsc` | 2.0.7 | 3.3.13 |
| `typescript` | 5.4.3 | 5.9.3 |
| `vue-template-compiler` | 2.7.16（`vue-tsc` 2.x 链） | 已从依赖树移除 |

升级前 17 条公告（severity / 包 / 公告 / 影响范围 / 修复范围）：

| 级别 | 包 | 公告 | 影响锁定版本 | 修复版本 |
| --- | --- | --- | --- | --- |
| high | `vite` | [1120061](https://github.com/advisories/GHSA-c27g-q93r-2cwf) launch-editor command injection on Windows | `<=5.4.8` | `>=5.4.9` |
| high | `vite` | [1123525](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) `server.fs.deny` bypass on Windows alternate paths | `<=6.4.2` | `>=6.4.3` |
| low | `vite` | [1107323](https://github.com/advisories/GHSA-g4jq-h2w9-997c) middleware/public-directory name overlap | `<=5.4.19` | `>=5.4.20` |
| low | `vite` | [1107327](https://github.com/advisories/GHSA-jqfw-vq24-v9c3) `server.fs` not applied to HTML files | `<=5.4.19` | `>=5.4.20` |
| moderate | `esbuild` | [1102341](https://github.com/advisories/GHSA-67mh-4wv8-2f99) dev server request/read from any website | `<=0.24.2` | `>=0.25.0` |
| moderate | `vite` | [1096892](https://github.com/advisories/GHSA-8jhw-289h-jh2g) `server.fs.deny` directory patterns | `>=5.2.0 <=5.2.5` | `>=5.2.6` |
| moderate | `vite` | [1099688](https://github.com/advisories/GHSA-9cwx-2883-4wfx) `?import&raw` fs.deny bypass | `>=5.2.0 <5.2.14` | `>=5.2.14` |
| moderate | `vite` | [1099691](https://github.com/advisories/GHSA-64vr-g452-qvp3) DOM clobbering gadget / XSS | `>=5.2.0 <5.2.14` | `>=5.2.14` |
| moderate | `vite` | [1102437](https://github.com/advisories/GHSA-vg6x-rcgg-rjx6) dev server request/read from any website | `>=5.0.0 <=5.4.11` | `>=5.4.12` |
| moderate | `vite` | [1103517](https://github.com/advisories/GHSA-x574-m823-4x7w) `?raw??` fs.deny bypass | `>=5.0.0 <5.4.15` | `>=5.4.15` |
| moderate | `vite` | [1103884](https://github.com/advisories/GHSA-356w-63v5-8wf4) invalid request-target fs.deny bypass | `>=5.0.0 <5.4.18` | `>=5.4.18` |
| moderate | `vite` | [1104173](https://github.com/advisories/GHSA-859w-5945-r5v3) `/.` fs.deny bypass | `>=5.0.0 <=5.4.18` | `>=5.4.19` |
| moderate | `vite` | [1104202](https://github.com/advisories/GHSA-xcj6-pq6g-qj4x) `.svg`/relative-path fs.deny bypass | `>=5.0.0 <5.4.17` | `>=5.4.17` |
| moderate | `vite` | [1112511](https://github.com/advisories/GHSA-4r4m-qw57-chr8) inline/raw `?import` fs.deny bypass | `>=5.0.0 <5.4.16` | `>=5.4.16` |
| moderate | `vite` | [1116229](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) path traversal in optimized deps `.map` | `<=6.4.1` | `>=6.4.2` |
| moderate | `vite` | [1120784](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) launch-editor NTLMv2 hash disclosure via UNC | `<=6.4.2` | `>=6.4.3` |
| moderate | `vue-template-compiler` | [1111772](https://github.com/advisories/GHSA-g3ch-rx76-35fx) client-side XSS | `>=2.0.0 <3.0.0` | 无 2.x 修复；随 `vue-tsc` 3 移除 |

原始文件：`test-results/phase07.1/audit-all-before.json`、`audit-prod-before.json`、`audit-all-after.json`、`audit-prod-after.json`。

### 3.2 选择 Vite 6 而不是 Vite 7/8 的理由

本机 Node v22.2.0 满足 Vite 6.4.4 的 `^18 || ^20 || >=22`，但不满足 Vite 7/8 的 `^20.19 || >=22.12`。Vite 6.4.4 发布于 2026-10-06，是 6.x 的最新安全版本，覆盖本次全部 Vite 公告；`@vitejs/plugin-vue` 5.2.4 是与 Vite 6 兼容的最新 5.x。这样在**不更换当前 Node**的前提下完成受维护版本升级，符合任务第 6 条。CI 仍使用 Node 24，同样兼容。

未使用 `--force`、未添加 audit 忽略规则、未通过 `overrides` 隐藏公告。升级命令与差异见 `test-results/phase07.1/pnpm-upgrade.log`。

### 3.3 升级后验证

- `pnpm typecheck`：PASS。
- `pnpm build`：PASS；Vite 6.4.4 production build 完成。
- Smoke：**15/15 脚本**（最终干净轮，135.30s）。
- 完整 Regression：**26/26 脚本**（286.41s）。
- 真实桌面 release 启动、会话恢复、PDF：见第 7 节。
- CodeMirror、ProseMirror、PDF.js 的现有回归均通过；没有修改编辑内核版本。
- 构建产物与启动性能对比见第 6、7 节。

首次升级后 Smoke 曾出现 `conversion-regression.mjs` 冷缓存超时（14/15，`smoke-after-upgrade.log`）。原因是 lockfile 变化触发 Vite 依赖重优化，页面 `goto` 在 30s 内未完成；删除该端口缓存后单测冷启动 22.8s 通过，随后完整 Smoke 15/15。该失败已保留，不隐藏。

## 4. P1：原生 HTTP(S) 图片访问安全复核

### 4.1 攻击前提与基线复现

DOCX 导出会把 Markdown 中 `http(s)://` 图片交给原生 `reqwest` 下载，再以内嵌 data URI 写入 Word。攻击者只需让用户导出一份包含恶意图片地址的 Markdown/DOCX，即可让桌面进程向任意主机发起 GET；响应字节会进入导出文件，形成 SSRF/内网资源读取或端口探测面。该路径不是打开文档时自动触发，需要用户显式执行导出，这是攻击前提也是限制。

基线代码仅限制 URL 以 `http://`/`https://` 开头，使用 `reqwest` 默认重定向（限 4 次），没有校验解析后的 IP，也没有禁止代理或每次重定向重新校验。真实本地复现测试 `remote_images_never_contact_loopback` 在基线失败：导出成功，证明 `http://127.0.0.1:<port>/pixel.png` 被真实请求并读入；日志 `test-results/phase07.1/ssrf-loopback-red.log`。

### 4.2 修复后的策略

实现位于 `src-tauri/src/conversion/remote.rs`，由 `engine.rs` 的 DOCX 导出调用：

1. 只允许 `http`/`https`，拒绝 URL 内账号/密码、缺失主机。
2. 每个 hop 只解析一次域名，解析结果**全部**必须是允许的地址；任一私有/环回/链路本地/元数据/ULA 等结果即拒绝。
3. 校验通过后把 `SocketAddr` 列表**固定**到该 hop 的 HTTP client（`resolve_to_addrs`），实际 TCP 连接只能到已校验地址；DNS 在请求期间变化不能改写已建立的目标。
4. 禁用自动重定向和系统/环境代理（`Policy::none()` + `no_proxy()`）；代理会自行解析并连接，必须排除。
5. 手工跟随最多 4 次重定向；每次 `Location` 重新解析、重新校验、重新固定；拒绝 `file:`、凭证、私网/元数据/环回目标。
6. 每次请求最长 10s、整体受 ConversionLease 90s deadline 约束；最终响应体最多 4 MiB，总图片预算仍为 64 MiB / 256 张；仅接受 2xx。
7. 显式安装 rustls `ring` provider。基线使用 `rustls-no-provider`，在无先前更新检查的进程里首次 HTTPS 图片会 panic；新增直接 `rustls` 依赖并只安装一次 provider，消除该不确定性。

被拒绝的地址包括：IPv4 `0.0.0.0/8`、`127/8`、RFC1918、`100.64/10`、`169.254/16`（含 `169.254.169.254`）、`192.0.0.0/24`、`192.0.2.0/24`、`192.88.99.0/24`、`198.51.100.0/24`、`203.0.113.0/24`、组播与 `240/4`；IPv6 `::`、`::1`、`fe80::/10`、`fc00::/7`、`fec0::/10`、组播、IPv4-mapped、`2001::/23`、`2001:db8::/32`、`2002::/16`、`3fff::/20`。公网 `2000::/3` 的普通地址保留。

**198.18.0.0/15 例外**：该段是基准测试保留段，但本机及常见桌面 fake-IP DNS/VPN 会把它分配给所有公网域名；如果拒绝，合法公网 HTTPS 图片全部不可用。它不是内网/链路本地段，因此本策略允许它，并在残余风险中说明 fake-IP 代理会代替应用做最终解析。该决定不是用字符串 `localhost` 判断，也不削弱第 2–5 条的实际连接目标校验。

### 4.3 测试证据

- `remote_images_never_contact_loopback`：本地可控 HTTP 服务 + 真实 `export_docx`；红色证据为基线导出成功；绿色证据为修复后导出失败、服务命中数为 0、目标文件未创建。
- `remote::tests` 共 12 个测试（11 个常规 + 1 个需公网忽略）：
  - IPv4/IPv6 私有与特殊段分类；
  - URL scheme/凭证/内部域名；
  - 环回/元数据 IP 字面量不进入 transport；
  - DNS 返回私网、混合公网+私网全部拒绝；
  - 重定向到环回/元数据/`file:`/带凭证 URL 每 hop 拒绝；
  - 相对重定向保持固定地址；
  - 跨主机重定向重新解析并重新固定；
  - 重定向次数与 4 MiB 上限；
  - hop 之间 DNS 变化在连接前被发现；
  - 多地址 DNS 全部校验并固定。
- `public_https_image_remains_compatible`（`--ignored`，本机联网单独执行）：真实 `https://httpbin.org/image/png` 经新策略成功下载并校验 PNG magic；日志 `ssrf-public-https.log`。
- 完整 `cargo test --locked`：109 passed、1 ignored；该 ignored 即上面的公网测试，已在本地单独运行通过。

### 4.4 剩余风险与限制

- 没有访问任何真实内网系统；本地服务仅绑定 `127.0.0.1`，响应由测试线程返回，不能外推到所有网络栈。
- fake-IP DNS/VPN 会把连接交给本地代理，应用校验的是代理地址（198.18/15），代理可自行决定最终出口；应用无法看到代理内部解析，故该环境下的“目标一致”只到代理层。代理自身必须执行内网访问策略。
- 明文 HTTP 仍允许（为兼容现有公开图片），路径上的中间人可篡改图片字节；导出会做图片 magic 校验，但不提供机密性/完整性。
- 未做内容类型白名单（只做 PNG/JPEG/GIF/WebP/BMP/TIFF/SVG magic），SVG 内容仍按现有 `<img>` blob 路径处理，不在本阶段改变渲染沙箱。
- 公网 IP 上的任意端口仍可被请求（非内网 SSRF），未限制端口白名单；这是功能兼容与攻击面的折中。
- 未对 DNS 解析器本身做可信性校验；固定地址保证“解析结果即连接目标”，但不保证解析器返回的是用户期望的公网地址。

## 5. P1：50,000 行 Live 输入性能复核

### 5.1 方法

- 冻结基线：`test-results/phase07/browser-dist`（503153b，Vite 5 构建）。
- Phase 07 最终：`browser-dist-delivery-clean`（Phase 07 工作树 + Mermaid 11.16.1，Vite 5）。
- Phase 07.1 最终：`browser-dist-final-071`（当前工作树，Vite 6.4.4）。
- Chrome 155.0.8059.80；headless；1280×850；禁用后台节流；真实 `keyboard.press`，捕获 phase keydown 到下一 rAF；每轮每构建 20 组 q/Backspace，按 `baseline→vite5→vite6`、`vite6→vite5→baseline`、`baseline→vite5→vite6` 反转三轮；每组后断言 canonical source 恢复。
- 脚本：`scripts/phase07.1-live-typing-exact.mjs`；原始：`test-results/phase07.1/live-typing-exact/results.json`。

### 5.2 结果

50,000 行 Live（25,000 段）keydown→rAF，单位 ms：

| 构建 | 第 1 轮 中位 / P95 | 第 2 轮 中位 / P95 | 第 3 轮 中位 / P95 | 三轮中位 |
| --- | ---: | ---: | ---: | ---: |
| baseline（Vite 5） | 26.0 / 27.7 | 25.7 / 27.1 | 25.8 / 33.5 | 25.8 |
| final-vite5（Phase 07） | 26.0 / 29.0 | 26.1 / 30.7 | 25.9 / 28.2 | 26.0 |
| final-vite6（本阶段） | 25.9 / 27.1 | 26.3 / 27.7 | 26.6 / 27.9 | 25.9 |

结论：**没有可复现的键入回退**。三轮中 final-vite6 与基线相同（25.9 vs 25.8ms），P95 不超过 33.5ms；9/9 轮（每轮 20 组，共 180 组按键）后源码完全恢复。Phase 07 记录的 26.7→33.9ms 在本轮未复现，不能据此判定最终构建存在回退。没有回滚撤销优化、没有减少历史、没有重建整篇 EditorState、没有降低文档上限。

补充的“光标位于首段文本内”压力测试（`scripts/phase07.1-live-typing.mjs`，30 组、三轮）三个构建均为 44–47ms 中位；baseline 44.3/45.2/44.6，final-vite6 44.5/44.9/46.8，仍无构建间稳定差异。该场景绝对延迟高于 Phase 07 的原循环，说明位置/选区会影响 Live 局部更新成本，但不是本阶段引入的回退。

真实 `insert + undo/redo` 50k 压力（不是 Phase 07 的简单 undo 表）：

| 构建 | undo 中位 | redo 中位 |
| --- | ---: | ---: |
| baseline | 8255 / 8291 / 8271ms | 8583 / 8586 / 8725ms |
| final-vite5 | 155 / 155 / 164ms | 151 / 151 / 156ms |
| final-vite6 | 156 / 153 / 156ms | 153 / 153 / 153ms |

该路径比 Phase 07 的 1579.9→72.1ms 更重（含真实插入与 rAF），但相对关系保持：基线约 8 秒，最终约 0.15 秒。撤销性能优化没有被键入路径回滚。

长任务：浏览器审计在 50k 场景记录的 `longtask` 最大值为 baseline 2579ms、Phase 07 最终 469ms、本阶段最终 611ms；均为初始建立和撤销/重做期间，不是键入稳态。50k 首次建立/布局在组件宿主包含等待 ready 时约 9 秒，并出现约 2.1 秒长任务；这是既有的极端大文档边界，本阶段未把它伪装成已解决。键入本身 P95 27–34ms，未观察到逐键长任务。

## 6. P1：内存、30 分钟持续编辑与 50 次生命周期

### 6.1 30 分钟持续编辑：已有完整原始结果

`test-results/phase07/delivery-clean/results.json` 存在完整 30 分钟结果，直接读取而非按 `summary.json` 的中间值推断：

| 字段 | 实际值 |
| --- | --- |
| `passed` | true |
| `completedAt` | 2026-10-20T02:17:52.290Z（10:17:52 Asia/Shanghai） |
| `durationMinutes` | 30.0122 |
| `edits` | 1775 组输入/删除 |
| GC 样本 | 31（含最终样本） |
| Heap MiB min / median / max | 9.983 / 11.022 / 11.105 |
| 第 5 分钟后斜率 | 0.00755 MiB/min |
| 源码恢复 | 结束断言 `source() === cycleText`，PASS |
| 错误 | 0 |

旧的 25 分钟中间结果保留但不作为最终测试：`summary.json` 的 `final.passed=false`、25.0109 分钟、1481 组、26 个样本、9.983/11.009/11.085 MiB、斜率 0.00884。本次只把完整 30 分钟结果写入指标表。

测试结束时通过真实 DOM 断言确认 PM/CM 已销毁、根节点移除；媒体循环的 Blob URL 与 Worker 计数器在每轮关闭后为 0，最终也为 0。没有用放宽后的阈值替代这些检查。

### 6.2 50 次生命周期 DOM 终点差异

指标表原先的 baseline 33→34 与 final 33→406 不是产品差异，而是**采样时机**差异。`test-results/phase07/delivery-clean` 中 baseline 也在第 20/25 次出现 406；final 在第 5/25/40/45/50 次出现 406，其他样本为 34。406 样本的 `window.f.snapshot()` 均为 `pm=0, cm=0, toolbars=0`，说明 ProseMirror/CodeMirror/工具栏没有存活。

本阶段新增 `scripts/phase07.1-lifecycle-diagnostic.mjs`，在真实组件宿主上对第 1–50 次循环分别采样：

- 第 1 次 immediate=406，下一帧/50ms/500ms 均为 34；其余 49 次 immediate 即为 34。
- `attached`（`document.querySelectorAll('*').length`）始终为 22；`settledOver100=[]`。
- 结束后 heap snapshot 中只剩 12 个常量 detached wrapper（初始文档壳），不随循环增长；没有新增 EditorView/ProseMirror/工具栏对象。
- 早期诊断版本曾出现每循环 +362 节点的“泄漏”。定位为 **Playwright `waitForFunction` 返回了 EditorView 对象而不是布尔值**，Playwright 保留远端句柄；把谓词改为 `!!(...)` 后增长消失。这独立复现了 Phase 07 已记录的测试宿主假增长，并证明产品 `dispose()` 的对象生命周期正确。
- 堆快照：`detached-cycle-1.heapsnapshot`（406 时）与 `after-50-cycles.heapsnapshot`；`results.json` 记录四次采样和 attached 值。

媒体 50 次循环的 166 节点是**一次性的 viewer 壳层**（PDF 页面容器等），不是每循环增长；Blob/Worker 均为 0。baseline 最终 166、final 最终 50 是最后一次采样时 viewer 处于不同关闭阶段，不能解释为 final 泄漏更多。

结论：baseline/final 终点差异由异步清理/采样时机和测试宿主句柄造成，不是未释放的工具栏、ProseMirror 节点或监听器。50 次循环 DOM 稳定在 34，堆快照没有每循环增长的对象图。

## 7. P1：严格 Rust 检查

基线确认（同一 Commit，未改动前）：

- `cargo fmt --all -- --check`：失败，222 个 diff hunk，涉及 18 个文件。
- `cargo clippy --locked --all-targets -- -D warnings`：失败，11 个 lib + 1 个 test 诊断。

逐项修复：

| 位置 | 诊断 | 处理 |
| --- | --- | --- |
| `commands/app.rs` | `needless_return` | 改为块尾表达式 |
| `commands/settings.rs` | `derivable_impls` | `MarkdownClipboard` 改 `derive(Default)` |
| `commands/workspace.rs` | `cmp_owned`、`needless_borrow` | `Path::new` 比较；去掉多余借用 |
| `commands/session.rs` | `too_many_arguments` | 局部 `#[allow(clippy::too_many_arguments)]`，注释说明 Tauri 每个 `State` 独立注入，合并会改变前端命令契约；未使用全局 allow |
| `files/classfile.rs` | `manual_range_patterns`、`manual_is_multiple_of` | 改区间模式与 `is_multiple_of` |
| `files/media.rs` | `chunks_exact_to_as_chunks` | 改 `as_chunks::<4>()` |
| `workspace/service.rs` | `derivable_impls` | 改 `derive(Default)` |
| `lib.rs` | `unnecessary_cast` | 去掉 `position.x/y as f64` |
| `files/images.rs` | `cloned_ref_to_slice_refs` | 改 `std::slice::from_ref` |
| 18 个文件 | rustfmt | 执行 `cargo fmt --all`，共约 2,749 insertions / 829 deletions；没有模块拆分、没有改变 cfg 语义 |

最终命令：

```bash
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check   # exit 0
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings  # exit 0
cargo test --locked --manifest-path src-tauri/Cargo.toml          # 109 passed, 1 ignored
```

日志：`test-results/phase07.1/rustfmt-before.log`、`rustfmt-final.log`、`clippy-before.log`、`clippy-final-clean.log`、`cargo-test-final.log`。没有新增任何全局 `allow(clippy::...)`；唯一的局部 allow 已在上表说明，不涉及 Windows 保存、授权、租约或跨平台行为。

## 8. 平台范围与 Windows 真实验收

### 8.1 实际支持/发布范围

- **Windows x64**：本次实际构建、启动、会话恢复、PDF 和组件回归的目标平台。
- **Linux**：基线 Ubuntu CI 曾通过；本阶段新代码、X11/Wayland、安装包和桌面体验 **Not Tested**。
- **macOS Intel/ARM**：没有环境，**Not Tested**。
- **原生 PDF 导出**：现有实现依赖 Windows WebView2；不得宣称 Linux/macOS 支持原生 PDF 导出。Linux/macOS 只能在没有实测的情况下标 Not Tested。

### 8.2 Windows x64 已完成

- 生产配置 NSIS 1.0.4：`test-results/phase07.1/native-final/Markumo_1.0.4_x64-setup.exe`，9,875,111 字节，SHA-256 `d2bde7232b904f969d3984733a62b707a80a9cd5a6f42551672f79d6e16018b3`。构建目录另残留旧 1.0.0 安装包，未纳入本阶段结果。
- 生产 exe：24,976,384 字节，SHA-256 `de8734e0a107ae0b0a2a249b1c2fdd9139bb81753614c9470d3cda16023e0c26`；版本资源 1.0.4。
- 版本资源、文件关联/NSIS hooks、currentUser 安装模式、更新公钥和完整性标签通过 `windows-artifacts-regression` / `release-regression` 与静态检查。
- **真实隔离 release 启动/会话恢复**：`native-startup-final-071`，30/30 样本通过（6 场景 ×5），使用 `com.markumo.phase07-audit` 和独立 profile，未读写正式用户目录。fresh profile shell-ready 中位 693.6ms、warm 628.7ms、single-file 639.7ms、workspace 633.1ms、10-tab 783.4ms、2,000 文件/100 标签 1188.5ms；关闭握手和恢复断言通过。与 Phase 07 的 647–1264ms 区间一致，未发现启动回退。此前两次探针在残留 debug `markumo.exe` 进程存在时分别出现输入等待和关闭握手超时；清理该测试进程后完整 30/30 通过，失败日志保留（`native-startup-final-071.log`、`-retry.log`）。
- **真实 WebView2 PDF**：`real_webview2_prints_and_releases_hidden_window` 1 passed（7.86s），临时资源释放断言通过；宿主仍输出“缺少默认窗口图标”的测试资源警告，不是产品 PDF 失败。
- 真实桌面启动/关闭/会话恢复已测；文件保存/撤销/Live/图片/PDF/HTML/PDF/DOCX/PNG 的组件级回归通过，但不是安装后的完整 GUI 手工验收。

### 8.3 Windows x64 未完成 / 发布阻塞

- **隔离安装、卸载、从旧版本升级、文件关联实机、中文 IME、安装后启动和完整导出**：Not Tested。
  - 本机已安装 Markumo 1.0.4 于 `D:\tools\Markumo`；没有管理员权限、Windows Sandbox、Windows 容器或可用 VM，无法在不覆盖现有安装/关联的情况下做隔离安装。
  - 没有把“构建了 NSIS”写成“已安装通过”，也没有用 `/D` 覆盖现有用户安装来制造隔离假象。
- **受信任代码签名**：生产 exe 与 NSIS 均为 `NotSigned`；本机现有 `D:\tools\Markumo\markumo.exe` / `uninstall.exe` 也是 `NotSigned`。没有证书、没有私钥、没有自签名冒充正式签名，也没有生成可验收的 `.exe.sig` 更新附件。**这是发布条件未满足，不是“签名通过”。**
- **更新签名及安装信任状态**：未执行真实更新安装；`createUpdaterArtifacts` 在无签名私钥时按既有逻辑关闭，不能称为已验证更新包。

### 8.4 功能矩阵

[phase-07-feature-matrix.csv](phase-07-feature-matrix.csv) 现为 **160 行数据**（原 156 行 + 4 行）：新增“远程 HTTP(S) 图片访问策略”“Windows x64 安装/卸载/升级与文件关联”“代码签名与更新签名信任”“Linux/macOS 平台验收”。原有行保留；涉及 50k 键入、撤销和 DOCX 图片的行已按本阶段真实结果更新。未把安装、签名、Linux/macOS 的 Not Tested 改成 PASS。

## 9. 自动化、Extended Quality 与远程状态

| 检查 | 本阶段结果 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS；Vite 6.4.4；12.72–13.15s，产物 377 文件 |
| Smoke | **15/15**，0 skipped，135.30s |
| 完整 Regression | **26/26**，0 skipped，286.41s |
| `cargo test --locked` | **109 passed / 1 ignored**（公网 HTTPS 测试单独运行通过） |
| `cargo fmt --check` | PASS |
| `cargo clippy -D warnings` | PASS |
| 生产 / 全部依赖审计 | **0 / 0** |

**Extended Quality 工作流**：已更新 `.github/workflows/quality-extended.yml`，包含独立的 prod/all audit、Windows strict rust（fmt/clippy/test）、完整 Regression、50 次资源循环和可选 `soak_minutes=30`，并使用 `if: always()` 保存原始证据；没有 `continue-on-error`。**未在远程仓库执行**：本轮按要求不推送代码，也没有可用于触发 workflow 的远程写权限；因此不能声称 Extended Quality 通过，普通 Smoke 成功也不等同等价。人工推送/批准后应以实际 run URL 和 artifact 为准。

Phase 07 的普通 CI（[run 39358412024](https://github.com/yuanmahome/Markumo/actions/runs/39358412024)）只证明基线提交，不覆盖本阶段工作树。本阶段没有新的远程 CI 结果；Extended Quality 的远程 run URL 和 artifact 仍待人工触发。

## 10. 构建产物与启动性能对比

| 项目 | Phase 07 最终 | Phase 07.1 | 差额 |
| --- | ---: | ---: | ---: |
| 前端 dist 字节 | 12,577,224 | 12,571,319 | -5,905 |
| 初始 JS（入口 + modulepreload） | 1,285,273 | 1,283,141 | -2,132 |
| 生产 exe 字节 | 25,001,984 | 24,976,384 | -25,600 |
| NSIS 字节 | 9,878,287 | 9,875,111 | -3,176 |
| production build 时间 | 15.36s | 12.72–13.15s | 观测值，非受控基准 |

最大 JS chunk（本阶段）：`index-CfalAMoY.js` 867,211、`cynefin` 690,855、`mermaid.core` 605,949、`pdf` 483,739、`cytoscape` 443,834、`editor-core` 415,930、`MarkdownEditorController` 382,011、`katex` 261,901。dist 无 source map；NSIS 未包含 PDB。

启动：真实隔离 release（WebView2 155.0.4283.62）fresh 693.6ms、warm 628.7ms、single 639.7ms、workspace 633.1ms、10-tab 783.4ms、大工作区 1188.5ms（中位）；与 Phase 07 的 647.2/797.8/611.5/648.0/716.5/1263.7ms 处于同一量级，未发现可复现回退。绝对启动受 OS 缓存、CDP 附加和测试准备影响。

## 11. 剩余风险、发布条件与评分

### 11.1 已解决

- 开发工具链 17 条公告（含 2 high）→ 0；生产 0 保持。
- DOCX 远程图片 SSRF：实际连接目标校验、DNS pinning、每次重定向复核、禁用代理；本地红/绿与 fake DNS/transport 测试。
- 严格 Rust：fmt / clippy / 109 测试通过。
- 50k Live 键入：三轮反转复测无可复现回退。
- 30 分钟持续编辑：完整 30.012 分钟、1775 组、源码恢复、heap/GC/Worker/Blob 证据。
- 50 次生命周期 DOM：稳定 34、attached 22、PM/CM/toolbar 为 0、堆快照无每循环增长对象。

### 11.2 仍未解决 / 发布阻塞

1. **受信任代码签名证书缺失**：exe/安装包 NotSigned；更新签名链未验收。P0 发布条件。
2. **隔离安装/卸载/升级/文件关联/IME 未实测**：本机已有安装且无隔离环境；P0 发布条件。
3. **Linux/macOS 未测试**：不得宣称跨平台发布；原生 PDF 仅 Windows 实现。
4. **远程 Extended Quality 未执行**：工作流已准备，需人工推送/批准。
5. **50k 首次建立边界**：约 9 秒建立和约 2.1 秒长任务（含测试宿主的等待），未在本阶段优化；不是键入回退，但仍是极端文档的体验边界。
6. **fake-IP DNS 代理残余**：198.18/15 被允许以兼容公网图片；代理会代替应用做最终解析，应用无法看到代理内部目标。
7. Phase 07 已记录的 CAS 边界、FileStore 全局锁粒度、非 Windows 桌面覆盖缺口仍在，不因本阶段通过而消失。

### 11.3 保守评分（不是发布投票）

| 维度 | 权重 | 分数 | 依据 |
| --- | ---: | ---: | --- |
| 功能完整性和正确性 | 25% | 65 | 160 行矩阵（原 156 + 4 行发布/SSRF）、15/15 Smoke、26/26 Regression；手工安装/IME 缺口 |
| 数据安全与文件可靠性 | 25% | 88 | SSRF 修复、租约/原子测试；断电/真实磁盘耗尽未测 |
| 性能与资源管理 | 20% | 85 | 50k 反转复测、30 分钟、堆快照；首次 50k 建立边界 |
| 代码质量与可维护性 | 10% | 85 | fmt/clippy/audit 全绿 |
| 跨平台兼容性 | 10% | 40 | Windows 实测，Linux/macOS 未测 |
| 构建安装与升级 | 5% | 50 | NSIS 构建/静态检查；安装升级签名未测 |
| 自动化测试质量 | 5% | 90 | 15/15、26/26、109；远程 Extended 未运行 |

加权约 **74.8/100，结论 B — Conditional RC**。分数不能替代发布条件；A 不放行。

## 12. 复现入口与证据

- 依赖：`pnpm audit --json --registry=https://registry.npmjs.org`；`test-results/phase07.1/audit-*.json`。
- SSRF：`cargo test remote_images_never_contact_loopback`；`cargo test remote::tests`；`cargo test public_https_image_remains_compatible -- --ignored`。红/绿：`ssrf-loopback-red.log` / `ssrf-loopback-green.log`、`ssrf-remote-unit.log`、`ssrf-public-https.log`。
- 50k 键入：`node scripts/phase07.1-live-typing-exact.mjs`（需要 1477/1480/1483 三个冻结 preview）；`live-typing-exact/results.json`。压力场景：`scripts/phase07.1-live-typing.mjs`。
- 持续编辑：`test-results/phase07/delivery-clean/results.json`；旧 25 分钟：`test-results/phase07/summary.json` 的 `memory.final`。
- 生命周期：`node scripts/phase07.1-lifecycle-diagnostic.mjs --base=http://127.0.0.1:1483`；`lifecycle-diagnostic/results.json`、两个 heapsnapshot。
- Rust：`rustfmt-before.log`、`clippy-before.log`、`rustfmt-final.log`、`clippy-final-clean.log`、`cargo-test-final.log`。
- 桌面：`node scripts/tauri.mjs build --no-bundle --config test-results/phase07/native-config.json`；`node scripts/phase07-native-startup.mjs --label=final-071`；`powershell -File scripts/test-native-pdf.ps1`。
- 安装包/签名：`node scripts/package.mjs --skip-install`；`Get-AuthenticodeSignature`；`package-windows-071.log`。
- Extended：`.github/workflows/quality-extended.yml`；远程状态 **Not Run**。
