# 目录树与 ClassFile 专项 — 2026-10-14

## 范围和状态

用户授权的既有文件打开/工作区能力增量修复，固定 Rust/Tauri2/Vue3/CodeMirror6 技术栈。`.class` 只读查看扩展 PRD 原先拒绝二进制的范围，按用户当前明确指示执行；其他二进制继续安全拒绝。没有新增依赖、运行目标字节码、提交、推送或发布，没有开始完整的新 Phase。

最后用户明确要求“不用验证，修改完即可”。本轮完成代码后停止测试和构建；状态保持 REVIEW，不能宣称已通过全部验收。

## 实现

- 移除资源树380px固定限高。工具栏固定，树占满剩余空间；多根共用唯一垂直滚动容器，外层不重复滚动。
- 以 ResizeObserver 获取容器实际高度，计算26px行的可见数和 overscan，保持顶部/底部占位之和准确。窗口变化和侧栏宽度变化触发重新测量，不通过换行改变行高。
- 根目录操作按钮默认隐藏，悬停/键盘聚焦时显示，不永久挤占名称；普通节点操作保持同样行为。长名省略、完整名称及可读路径悬停，文件/文件夹使用统一 SVG 图标，深层缩进限制避免名称完全挤出。
- 活动文件按展示路径键匹配，仅 Windows 路径不区分大小写；展开其目录链并滚到可视范围。原始目录读写路径不转换。
- Rust 检查 `.class` 后缀及 CAFEBABE 内容魔数，在严格文本解码前分流。工作区、系统选择器、启动参数和最近打开继续共用 FileService，不仅添加语言后缀映射。
- ClassFile 结构解析使用边界检查和大端字段读取；提供类名、父类、版本、标志、接口、字段、方法描述符和常量池。处理 Modified UTF-8、NUL、代理对、Long/Double双位置、常量引用和结构长度；截断、未知标签、错误索引、剩余数据等返回明确错误。
- 这是结构查看，不是反编译或 JVM 指令验证。不会调用 JDK/javap、加载或执行目标类；无需安装JDK。格式依据 [JVM ClassFile 规范](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html)。
- Text/JavaClass 开结果按 kind 区分，共用原有标签组；JavaClass 的 CodeMirror 展示的是明确标识的派生只读结构文本，没有把字节码转换成Java源码。只读State/Transaction过滤、管理器、文件控制器与Rust授权均阻止编辑和文本保存/另存为。
- 十六进制每页最多4096字节，显示真实偏移、字节值和ASCII可打印字符，支持上一页/下一页/指定偏移。后台仅接受有效文件token并检查打开版本，外部变更后提示重新打开；不持久化全文件字节到全局响应式状态。异步迟到响应与已销毁组件不会写回，EditorView销毁清理。
- Rust保存服务同时阻止非可写二进制授权、`.class`目标和带魔数的现有目标，避免文本另存为绕过。编码重开和自动保存也不能处理ClassFile。
- 保留既有忽略规则和showIgnored。目录列表本来不按二进制过滤，因此无需移除规则；编译输出目录在显示忽略文件后按需展开，目录树仍虚拟化。文本、Markdown和Java源码保持原有编辑模型。

## 文件用途

以下相对 `E:\code\lightEdit`。

| 文件 | 用途 |
|---|---|
| src/components/layout/Sidebar.vue、TreeNodeItem.vue、src/components/common/Icon.vue | 唯一滚动区、容器测量、全宽名称、工具隐藏、统一图标 |
| src/features/workspace/virtualTree.ts、WorkspaceController.ts | 动态虚拟窗口、按需定位活动文件 |
| src/features/shell/pathDisplay.ts | 仅用于 UI 选择匹配的路径键 |
| src-tauri/src/files/classfile.rs | 有界ClassFile结构解析与十六进制格式化 |
| src-tauri/src/files/mod.rs、codec.rs | 内容类型分流、二进制只读授权、保存和编码保护 |
| src-tauri/src/commands/files.rs、src-tauri/src/lib.rs | 授权/版本检查的分页十六进制命令 |
| src/features/files/contracts.ts、tauriFiles.ts、FileController.ts、classSummary.ts | 类型契约、服务接入、保存拦截、明确标识的结构展示文本 |
| src/types/index.ts、src/editor/core/DocumentManager.ts | 标签共享元数据、只读EditorState和程序化变更保护 |
| src/components/layout/ClassHexPanel.vue、EditorPane.vue、EditorContainer.vue | 只读字节视图、分页与组件生命周期 |
| src/App.vue、src/app/useAppShell.ts、Breadcrumb.vue、StatusBar.vue | 控制器传递、禁用保存/替换、正确显示二进制模式与字节数 |
| tests/files.test.ts、tests/phase4-native.mjs | 文本fixture类型修正、旧固定30行断言更新为实际窗口预算；未执行 |

## 验证实况和遗留项

- 用户要求停止验证之前，曾运行 Rust cargo check：PASS。这是当时中间版本结果，不等价于最终代码验收。
- 当时TypeScript检查FAIL：旧文本测试fixture的Partial联合类型不兼容。已将文本fixture明确为TextOpenFile；按用户要求未复跑。
- 最终typecheck、unit tests、build、cargo check/test、UI/原生测试：NOT RUN，用户明确要求不验证。未把此前编辑体验专项的通过结果用于本任务。
- 本轮不重建软件安装包，上一任务的安装包不含这些新修改。

待验收：双根各大量节点、>100个展开节点与末尾滚动、窗口高于30行的渲染、缩小窗口和调宽、长名/焦点工具、合法和损坏ClassFile、最近/系统选择器/目录树打开、只读编辑/保存拦截、十六进制末页及外部变更、showIgnored下编译输出、普通文本/Markdown回归。

限制：ClassFile上限沿用16MiB；常量展示最多1000个位置、字段和方法各1000项、接口256项，长成员与常量文本截断并明确提示；十六进制可分页查看全部文件字节。未实现完整字节码验证/反编译。每页读取会重新检查文件版本，读取工作在Rust后台线程，但大型文件连续翻页的性能尚未测量。实际系统文件选择框、IME、高DPI和跨平台未验收。
