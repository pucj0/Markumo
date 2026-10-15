# 编辑体验专项记录 — 2026-10-14

用户授权的 Phase 4/5/6 增量修复。后续用户要求停止继续验证并开始目录树与 ClassFile 专项，因此不继续安装验收，不自动推进新 Phase，不提交或推送。

已实现：Mod+F 查找/Mod+R 替换和刷新阻止、旧默认快捷键迁移；顶部冗余名称移除；最近打开二级菜单；Windows/UNC 展示路径与原始 I/O 路径分离；基于 Lezer AST 的 GFM 表格模型、安全 DOM 和直接 StateField 块装饰；单元格点击进入局部源码，行列修改通过 CM Transaction；统一双 Pane 标签/工具栏、1px 可拖动分隔线；预览移除标题行并按源行块锚点同步；Source Chevron/Live 隐藏箭头；围栏代码源码排版。没有新增依赖。

主要文件：`src/features/shell/{editorSettings,pathDisplay}.ts`、`src-tauri/src/commands/settings.rs`、`src/app/useAppShell.ts`、`src/types/index.ts`、`src/App.vue`、`src/components/layout/{TopBar,AppMenu,StatusBar,TabBar,EditorContainer,EditorPane}.vue`、`src/editor/core/{DocumentManager,extensions,searchPanel}.ts`、`src/editor/markdown/{tableModel,tableWidget,tableField,livePreview}.ts`、`styles.css`、`splitPreview.vue`；新单元/模型/UI 测试和旧快捷键/路径断言同步更新。安装测试脚本的 bundle marker 比较、隔离目录和元数据恢复已修正，但用户停止后尚未执行。

真实结果：`pnpm typecheck` PASS；`pnpm test` 111/111；`pnpm build` PASS，163 modules；`node tests/ux-model-check.mjs` 20/20；Rust check PASS，test 36/36；定向 rustfmt 和安装测试 PS/JS 语法检查 PASS。浏览器专项18组、菜单4组、40次 Markdown 点击、Markdown 与双 Pane 各8组 PASS。原生编辑13组 PASS（包括实际表格点击、BOM/CRLF 保存、撤销/重做、40次点击、自动保存冲突、双 Pane），原生工作区11组 PASS。

证据：`test-results/ux-special/`、`test-results/editor-native/1791979276621/`、`test-results/phase4-native/1791979389421/`。最初权限检查失败，审批服务恢复后完整复跑通过。工作区旧绝对路径断言失败后，按用户要求更新为相对路径与完整可读悬停路径，复跑通过。截图最后仅修改等待设置关闭动画，停止后未再次生成。

安装包构建已结束：`src-tauri/target/release/bundle/nsis/LightEdit_0.1.0_x64-setup.exe`，3.26 MiB；安装/卸载与内嵌发布前端冒烟 NOT RUN，不宣称交付验收通过。lint NOT RUN，未配置。原生中文 IME 候选框、实际 Windows 高 DPI、跨平台、长时内存仍需人工验证。浏览器 device scale 和合成 composition 不等价于系统验收。

表格采用局部源码编辑；嵌套/损坏语法安全降级。超过百万 CM 字符跳过表格块，最多装饰200张表格，每张最多64列、500行间距、64KiB源码。旧混合自定义配置缺乏逐键来源，可能保守保留 Mod+H。复杂回溯正则仍有既有风险。Phase 4/5/6 保持 REVIEW；没有开始 Phase 7。
