# 未知后缀与 ClassFile 编辑修正（2026-10-15）

Phase 3/6 既有能力增量，状态 REVIEW。用户本轮要求 `.bat`、未知后缀和 `.class` 均能编辑保存，覆盖此前 ClassFile 默认只读的要求。不改变技术栈，不增加依赖、不提交/推送/发布。

## 实际行为

- 取消 `.class` 后缀对打开和保存的硬限制。可识别文本始终使用真实 CodeMirror 文档、既有编码/BOM/换行映射、撤销/重做、关闭保护及原子保存；未知后缀和无后缀使用 Plain Text。
- 真正二进制字节不强制 UTF-8 解码。CAFEBABE、NUL 或默认 UTF-8 无法解码且无 BOM 的数据默认显示为可编辑 Hex，每32字节换一行。状态栏标识 `HEX 字节`；修改后的合法 Hex 保存回字节，原始 BOM、CR/LF 等都仅为字节内容，未经修改逐字节保持一致。
- Hex 只接受 ASCII 十六进制数字和空白，缺半个字节/非 Hex 字符均拒绝写入并保留 dirty。前后端阻止把 Hex 展示文字转换成 UTF-8 直接覆盖文件。现有保存版本校验、ACL、原子写入、只读磁盘提示继续生效；自动保存沿用相同保存入口和成功基线。
- 结构化 ClassFile 只读查看保留为命令面板“查看 JVM ClassFile 结构”；“编辑文件字节”切回 Hex，存在未保存修改时拒绝重载。“以字节方式打开文件”可显式处理文本编码无法打开的文件。任何路径都不运行/加载目标字节码。
- 系统文件选择、目录树、最近文件共用 FileService，因此使用同一内容判断；不改动工作区过滤规则。

## 修改文件与用途

| 文件 | 用途 |
| --- | --- |
| `src-tauri/src/files/codec.rs` | 可逆 Hex 显示/严格解析，不做替换字符解码 |
| `src-tauri/src/files/mod.rs` | 内容优先打开；文本后缀不限；Hex 授权、容量、保存转换保护；可选结构查看 |
| `src-tauri/src/files/tests.rs` | 未知/无后缀及文本class保存、二进制完整字节、非法输入、冲突、另存为、结构/编辑切换 |
| `src/features/files/contracts.ts` | 区分可保存 Encoding 与打开视图 FileOpenEncoding |
| `src/features/files/FileController.ts` | Hex 保存转换保护、结构视图与字节编辑重开 |
| `src/editor/core/DocumentManager.ts` | Hex 复用可编辑文档，禁止意外 Markdown 格式/语言渲染 |
| `src/app/useAppShell.ts` | 实际字节打开/编辑、ClassFile结构命令及UTF-8转换禁用状态 |
| `src/components/layout/StatusBar.vue` | 明确显示 Hex 字节模式与工具提示 |
| `tests/files.test.ts` | 真正CM文档事务/历史/保存快照/双Pane单元回归；gateway为显式测试替身 |
| `tests/file-types-native.mjs` | 独立应用、临时文件、真实WebView2/Rust IPC/磁盘字节验证 |
| `docs/PHASE_PROGRESS.md` | 台账与新旧需求取舍 |
| 本文档 | 交付与验证记录 |

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，157/157 |
| `pnpm build` | PASS；只有既有Tauri静态/动态导入拆包提示 |
| `cargo check --manifest-path src-tauri/Cargo.toml --offline` | PASS，无新增Rust告警 |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline` | PASS，42/42 |
| `node tests/phase2-ui.mjs` | PASS，9组，真实Chromium编辑器DOM，控制台/页面错误0 |
| `node tests/editor-phase6.mjs` | PASS，8组，双Pane/历史/滚动/查找替换/销毁无回归 |
| `node tests/file-types-native.mjs` | PASS，7组，真实WebView2、Rust IPC及磁盘；bat/cmd/文本class/未知/无后缀BOM/CRLF修改撤销重做保存、二进制class完整字节/修改保存/双Pane/非法输入保护/最近重开 |
| `git -c core.safecrlf=false diff --check` | PASS |

原生首次因已有用户窗口在启动前退出，用户确认关闭后最终复跑通过。证据 `test-results/file-types-native/1792026785582/results.json`、`native.log`、`editable-class.png`；浏览器使用隔离localhost:1422/msedge无头实例，原生使用独立开发数据目录和临时fixture，未操作现有用户文件或系统剪贴板。测试后只销毁本测试窗口及1422服务。

## 限制与手工验收

- 普通文本仍保留16 MiB及200,001行保护；Hex展开文本也遵守该限制，因此原始字节约5.33 MiB以内。拒绝超过容量的Hex保存，以免产生本编辑器无法重新打开的字节文件。
- 未知编码不自动猜测并转换：无BOM且UTF-8失败时先可逆显示Hex，可在命令面板按GB18030/windows-1252等重开。尤其旧编码Batch请选择正确编码后编辑文字；损坏BOM文本继续报错，可显式以字节方式打开。
- Hex编辑不验证修改后的字节码仍可被JVM接受，不反编译为Java源码；可选结构查看会明确报告损坏结构。
- 安装包未更新；当前改动需重新启动开发版/Rust进程后使用。真实系统文件选择框、中文IME及跨平台仍待人工；未执行新的安装验证或发布。
- 人工：分别从系统选择框/树/最近打开bat、cmd、未知扩展名、文本class；改中文、撤销、保存、另存为并对比编码/换行。打开真正class确认HEX，可改一对字节并保存；输入G后保存应报错且原文件不变。先保存，再切结构查看及切回字节编辑。
