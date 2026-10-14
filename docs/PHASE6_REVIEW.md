# Phase 6 复审与修复 — 2026-10-14

状态：**REVIEW**。原实现不满足 Phase 6 要求，修复后核心功能及 Windows 桌面重启验收通过；系统资源管理器/剪贴板等人工项尚待验收。本轮仅覆盖用户授权的 Phase 5、6，没有进入 Phase 7、提交或推送。

## 原缺陷与修复

真实组件测试首先得到 `1 !== 2`：开启分栏只挂载一个 EditorView。原单元测试从未挂载两个视图，无法证明同步正确。其余问题包括递归派发两侧修改、捕获过期文档 ID、操作始终作用于主编辑器、每文档只有一份视图缓存、关闭副窗格丢失独有标签、错误释放共享文件授权、副视图未销毁、零长度正则循环、替换组不展开、设置仅存在会话、大纲正则误识别围栏/注释及左侧未接入 manager、Reveal 忽略失败和接受任意路径等。

修复后使用一个 canonical EditorState 保存文档、换行与历史；两个 EditorView 保存各自选区/滚动，所有来源事务进入同一文档状态，另一侧通过 `view.update` 接收文档变化及明确的共享配置，避免递归 dispatch。查找面板等本地视图 effect 不广播，打开一侧查找不会弹出两份面板，字体/换行等配置仍同步两侧。撤销、重做、选区历史和 beforeinput 历史事件统一由 canonical state 执行。普通输入留在 CM 内，没有逐字 IPC；保存时才提交快照到 Rust。

## 逐项验收

| PRD / 审查项目 | 结论与证据 |
|---|---|
| 水平双窗格，同文档修改无冲突 | PASS：真实双 EditorView 双向修改、独立光标、共用撤销/重做；Windows 双侧真实键盘编辑与最终 BOM/CRLF 磁盘保存 |
| 不同文档、组间拖放和快捷切换 | PASS：副窗格标签、新建/选择/关闭；真实 DragEvent/DataTransfer 标签移动；默认 Ctrl+Alt+Right 切换活动窗格；副窗格后续编辑作用于当前文档 |
| 每窗格独立视图、文档与授权生命周期 | PASS：滚动跨标签恢复；共享 dirty 文档到最后一个引用才关闭/释放授权；关闭分栏合并副窗格独有标签，保留内容；dispose 销毁两视图和清理热更新遗留 token |
| Go-to-line、find next/previous、whole-word/regex/replace-all | PASS：真实搜索面板下一/上一、全词、正则组替换与整体撤销；零长度正则通过 CM SearchQuery 游标终止；无效正则不改文档；跳转只接受正整数行:列，超范围截断，模态框隔离快捷键 |
| 选区大小写 | PASS：CM 单次事务转换，多选区支持；真实选区大写与撤销验证 |
| 完整/相对路径复制 | PARTIAL：真实按钮调用 Clipboard API，失败提示可见，路径边界/Windows 大小写单元通过；系统剪贴板实际内容人工 NOT RUN |
| Reveal in Explorer | PARTIAL：真实 Rust 命令仅接受当前文件 token，重新验证路径；Windows 使用 Shell/COM API，错误返回；Unicode/空格/逗号/UNC 路径转换、非法及释放 token 测试通过；实际系统窗口选中目标人工 NOT RUN |
| 快捷键配置与无冲突 | PASS（已测范围）：统一注册/派发，编辑器保留按键与重复绑定拒绝；模态框、IME 和普通表单输入保护；实际将 Go-to-line 改为 Ctrl+Alt+J 并重启验证；默认 Ctrl+G 关闭原绑定，浏览器 Ctrl+S 仍显示桌面提示 |
| Zoom、wrap、字体、缩进、主题、大纲和 Markdown 默认模式重启生效 | PASS：验证 schema 的本机 `editor-settings.json` 原子保存；序列化写入队列、关闭前 flush；真实桌面退出并再次启动后 17px、Consolas、四空格、浅色、wrap、大纲、Source 默认/文件模式和自定义快捷键恢复 |
| AST 大纲、未知语言降级 | PASS：Markdown ATX/Setext，代码真实轻量 AST，排除围栏/注释/字符串；右侧与左侧接入并可跳转；未知语言明确退化，按 Text/tree 缓存，最多 1000 项，超过 1,048,576 个 CM 字符暂停 |
| UI、架构、安全、此前阶段回归 | PASS（已测范围）：固定技术栈；明暗与 680–1200px 窗口、普通编辑器、文件关闭/保存失败契约以及 Phase 4 原生工作区 9 组通过。未做跨平台、高 DPI 或长期内存验收 |

Windows Reveal 按 [Microsoft SHOpenFolderAndSelectItems 文档](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenfolderandselectitems) 初始化 COM、解析 PIDL、选择文件并释放分配内存；没有 shell 字符串拼接。CodeMirror 官网本轮请求返回 403，API 核对采用项目已安装版本的公开类型、包源码与实际运行结果，未宣称官网访问成功。

## 本轮修改文件及用途

| 路径 | 用途 |
|---|---|
| `src/editor/core/DocumentManager.ts` | canonical 文档/历史、pane-aware 操作、共享同步、视图缓存、关闭/拖放/清理；SearchQuery 替换、大小写、缩进配置 |
| `src/editor/core/extensions.ts` | 移除固定缩进值，中文搜索全词标签；CM 功能继续保留 |
| `src/components/layout/EditorPane.vue` | 每个窗格的 CM / Markdown Split 挂载卸载、滚动同步与预览文本缓存 |
| `src/components/layout/EditorContainer.vue` | markRaw manager 的显式订阅、双窗格布局、副标签/拖放与实际大纲 |
| `src/components/layout/TabBar.vue` | 带来源窗格的拖放 payload；忽略外部无效 payload |
| `src/components/layout/ActivityBar.vue`、`OutlineView.vue` | 移除大纲“占位”提示，真实条目/降级说明 |
| `src/components/layout/StatusBar.vue` | 显示实际缩进类型/宽度 |
| `src/editor/outline/outlineService.ts` | 仅 AST 提取、Setext、真实符号名称、弱缓存和数量/大小上限 |
| `src/features/files/FileController.ts` | 关闭仅释放最后一个文件引用；dispose 释放两组 token，保护 HMR 生命周期 |
| `src/features/shell/editorSettings.ts` | 设置校验/持久化网关、字体选项、快捷键注册/保留按键检查、相对路径边界 |
| `src/components/modals/SettingsModal.vue` | 字体/缩进/快捷键配置 UI、冲突反馈，统一字号范围 |
| `src/components/modals/GotoLineModal.vue` | 严格行列校验、focus trap、IME 与键盘隔离 |
| `src/app/useAppShell.ts`、`src/App.vue` | 活动窗格/标签/关闭确认、左侧大纲实际接入、统一命令派发、设置恢复/写入/关闭 flush |
| `src-tauri/src/commands/settings.rs` | 有限 schema、本机原子设置保存/载入、128KiB 限制，损坏数据报错；重启/非法值单元 |
| `src-tauri/src/commands/workspace.rs` | token 授权的原生 Reveal、系统调用错误反馈、Windows Shell 路径转换 |
| `src-tauri/src/files/mod.rs`、`files/tests.rs` | 复用原子写入/path guard，Reveal 文件授权接口及回归 |
| `src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs` | 注册首选项真实命令 |
| `src-tauri/Cargo.toml` | 为既有 windows-sys 增加 Shell / COM features，不新增 crate |
| `src-tauri/capabilities/default.json`、生成 schemas | 主窗口 close/destroy 最小权限，用于实际关闭握手与测试 |
| `tests/phase6-features.test.ts` | 8 项真实状态/AST/替换/视图生命周期/设置和路径验证；不把无 DOM 测试视为双视图证据 |
| `tests/files.test.ts` | 文件授权只在最后引用释放；两个窗格 HMR dispose 清理 |
| `tests/editor-phase6.mjs` | 生产组件双 EditorView 8 组 DOM 回归，搜索/替换/拖放/滚动/清理 |
| `tests/editor-native.mjs` | 真实双窗格磁盘、设置 UI / 冲突 / 跳转保护 / 退出重启验证 |
| `tests/phase2-ui.mjs`、`tests/phase3-ui.mjs` | 迁移过期“Live 禁用/示例树按钮/旧 recent class”断言；显式设置 IPC 契约替身；新增左侧大纲跳转 |
| `package.json`、`README.md`、`docs/PHASE_PROGRESS.md` | 可复跑命令与真实台账 |

## 实际检查结果

共用的 typecheck / build / Cargo 及 89 前端、29 Rust 测试命令详见 [Phase 5 报告](PHASE5_REVIEW.md)，均为 PASS。另有以下阶段证据：

- `pnpm test:ui:phase6`：**8/8 PASS**，`test-results/phase6-review/results.json`，page errors 空。首次运行确实 FAIL（只有一个视图），修复后通过。
- `pnpm test:native:editor`：**5/5 PASS**，最终 `test-results/editor-native/1791956357570/results.json`；其中 3 组验证 Phase 6，真实 Rust IPC，无替身。重启脚本曾因窗口销毁返回 page closed、缺 allow-close 权限失败，修复后生产 close 握手完整通过。同文档查找面板 effect 保持本侧、共享换行配置同步两侧也经过 DOM 复跑。
- `pnpm test:ui`：**9/9 PASS**，含左侧 AST 标题与点击定位；`pnpm test:ui:files`：**5/5 PASS**，文件 IPC 替身明确标识。
- `pnpm test:native:workspace`：**9/9 PASS**，真实文件重命名/移动后再保存、Unicode 搜索、删除确认、忽略/CRUD/授权、10,000 文件的虚拟树；没有因双窗格改坏已完成的工作区能力。
- 定向 Rust format 与 `git diff --check` PASS。独立前端 lint **NOT RUN**（未配置）；macOS/Linux、原生 IME / DPI、系统 Explorer/clipboard/browser 视觉验收 **NOT RUN**。

## 手工步骤与遗留风险

1. `pnpm tauri dev` 后打开两个真实文本文件；Ctrl+\\ 分栏，将标签拖到另一组，Ctrl+Alt+Right 切换，分别编辑/滚动。相同文件两侧一致；撤销、重做、保存和关闭副分栏应保留独有 dirty 标签。最后一个 dirty 标签仍应确认。
2. 搜索面板试全词/大小写/正则组、无效和零长度模式；替换后一步撤销。正则采用 CM / JavaScript 语义，复杂回溯表达式仍可能阻塞，未增加 worker 超时或宣称任意正则性能安全。
3. 复制完整/相对路径并粘贴到外部应用；从命令面板 Reveal，人工确认系统资源管理器选中含中文/空格/逗号的目标。只有 token 与 Shell 路径转换/错误路径被自动验证，未冒称系统窗口选择通过。
4. 改字体/字号/缩进/快捷键并立即关闭再启动；正常权限下已自动验证持久化。存储损坏/权限错误会提示，旧设置保存失败时不被截断；字体未安装时使用系统等宽字体 fallback。
5. 中文 IME、OS 剪贴板菜单、系统浏览器实际打开、高 DPI、网络盘、长时间内存和 macOS/Linux 需人工补验。前端 DOM 拖放属于真实组件合成事件测试，不等于不同输入设备的物理拖放验收。

结论：本次发现的 Phase 6 缺陷已修复，四项核心自动验收（同文档一致、可预期替换、快捷键与重启设置）有实际证据；完整人工门槛仍待上述系统交互验证。保持 REVIEW。没有引入 LSP、文件监控或恢复系统，也未开始 Phase 7。
