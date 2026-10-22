# Phase 05 + Phase 06 最终验收补丁

日期：2026-10-22。开始时工作区干净，`main` 与刚获取的 `origin/main`（`f9e1f66`）一致。执行期间保留了另一任务在本地 `main` 上提交的 `729e729` 大纲更新及其后续改动。本任务未创建分支、工作树，未推送、发布或修改版本号。

## 补丁范围

- 专注模式只有 `exitFocus()` 执行退出和恢复。F8、Esc、悬浮退出按钮、命令面板切换都经过该函数；分别恢复进入前的侧边栏、大纲开关。资源管理器命令先完整退出，再按命令本身的语义打开文件侧边栏。
- 保留各 Pane 的编辑器实例、布局、选区及源码、Live、Markdown 双栏预览的滚动坐标。弹窗恢复焦点使用 `preventScroll`；恢复 Live 焦点时通过 ProseMirror 自身方法同步 DOM 选区，避免延迟的 `scrollToSelection` 改变位置。
- FitR 用旋转后的目标矩形宽高计算缩放，FitV 用页面高度适配，并显示实际缩放值。先获取目标页真实尺寸，再修改缩放和坐标；等待 DOM 更新，并在滚动条尺寸变化期间保留目标锚点。缩放范围仍为 5%–500%。
- 普通跳页和旋转递增导航序号；关闭、重载沿用 teardown 的失效逻辑。目标解析、取页和实际滚动都检查请求有效性，旧请求不能迟到覆盖位置或缩放。
- 打字机模式保持独立。IME 开始时取消动画；滚轮、滚动条暂停跟随，真实键盘输入恢复跟随。非活动源码 Pane 保留底部留白，避免切换焦点时被浏览器强制上滚；Live 原生输入的光标显示不会误取消跟随。关闭时移除专用监听器、断开观察器并取消动画和排队帧。
- 前端 CI 恢复安装锁文件、类型检查、构建三个阻塞步骤。Browser Smoke 为独立非阻塞 job，使用 pipefail 保留失败状态，始终上传日志。原 Rust Quality job 内容及独立执行关系保持不变。

## 测试方法

`scripts/focus-mode-regression.mjs` 挂载真实桌面 App，仅模拟 IPC。源码、Live 和 Markdown 双栏三个 Pane 同时存在；活动 Pane 在源码和 Live 间切换。覆盖五条退出路径 × 四种侧边栏/大纲开关组合，并断言进入和退出前后的布局、选区、实际 scrollTop/scrollLeft、编辑器实例相同，另检查 F9 独立性。

`scripts/pdf-destination-regression.mjs` 使用真实 PDF.js、PDF 页面和渲染的 FitR 注释链接。18 组检查覆盖连续/单页、0°/90°旋转、FitR/FitV 比例和实际双向滚动坐标、同页缩放、CropBox、页面固有旋转及缩放上下限。分别延迟目标解析和取页，验证跳页、旋转、重载、关闭共八种取消组合，比较取消前后的实际位置和缩放。

`scripts/typewriter-focus-regression.mjs` 的 14 组检查包含 Chromium CDP `Input.imeSetComposition`/`Input.insertText` 产生的中文合成输入、Playwright 真实键盘、鼠标滚轮和原生滚动条拖动。显式关闭 Chromium 隐藏滚动条参数。断言合成期间和拖动期间位置不变、输入后的真实光标偏差不超过死区容差、Live 内嵌 CodeMirror 光标居中、非活动 Pane 坐标不变，以及关闭后实际监听器数量回到基线且动画停止。100 行事务插入另标为程序化检查，不冒充真实键盘输入。

这属于浏览器自动化交互验证，未进行操作系统中文输入法候选窗的人工测试。

## 实际执行结果

环境：Windows x64，Node v22.2.0，pnpm 12.11.2，Chrome 155.0.8059.85。

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，锁文件无需更新 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过，存在现有的大 chunk 和 Node 模块浏览器外部化提示 |
| 新增/修改的测试脚本 `node --check` | 通过 |
| `pnpm test:regression` 完整重跑 | 39/39 脚本通过，0 失败、0 跳过，342.07 秒 |
| 末轮打字机定向复核 | 14 组通过；内嵌光标断言直接读取 CodeMirror 坐标，不调用生产定位函数 |
| 末轮 PDF 目标定向复核 | 18 组通过，另断言 FitV 缩放控件显示实际比例 |
| 末轮媒体查看器复核 | 通过，13.58 秒 |
| Rust Quality 与基线对比 | 通过；忽略换行符差异后 job 内容完全一致 |

末轮媒体复核首次因另一个本地测试占用 1421 端口而失败，未标记为通过；确认端口释放后单独重跑通过。完整回归期间发现的设置热更新干扰和 Live 命令面板滚动问题已分别重跑确认、修复，并完成上表中的全量重跑。

本地证据保存在 `test-results/phase05-06-{install,typecheck,build,regression,targeted,media-rerun}.log`、`test-results/phase05-06-targeted-port-conflict.log`、`test-results/regression-logs/`、`test-results/focus-mode/results.json`、`test-results/pdf-destination/results.json` 和打字机测试滚动条截图中。

未执行 Rust cargo 命令、GitHub 托管 CI、打包发布或远程推送；这些项目不标记为通过。
