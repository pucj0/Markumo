# 常驻菜单栏修正 — 2026-10-14

用户最新图片指示覆盖此前“Logo点击后展开分类菜单”的解释。本轮仅修正既有Phase 6界面/效率入口，保留已完成的设置、自动保存和编辑区精简；不进入下一阶段。阶段继续REVIEW，无新增依赖，无提交/推送或Git索引操作。

## 实现与验收

- PASS：文件、编辑、格式、视图、工作区、帮助六个文字入口从启动起常驻于同一自定义标题栏；Logo仅显示品牌。菜单采用轻量矩形列表，直接悬停或点击展开，取消弹出层内的分类按钮与云朵箭头。
- PASS：既有文件/保存/最近/已打开、Markdown源码格式、分栏/主题/模式、真实多根工作区命令保持原服务；帮助接真实“快捷键设置”，直接打开并展开快捷键分组，没有占位操作。
- PASS：左右切换菜单、上下/Home/End选择、Escape回到分类、Tab及外部点击关闭；悬停不抢编辑焦点。编辑器仍可使用Ctrl+N等快捷键，开始键盘输入时关闭悬停菜单；菜单自身聚焦时处理同一命令绑定。
- PASS：明暗与680px浏览器布局；原生780px标题栏不溢出、六个入口全可见。窄窗收起重复的保存/专注/主题工具按钮，640px以下收起顶部模式开关，模式命令保留在视图菜单。下拉菜单按视口宽度校准落点。
- PASS：底栏未命名文档仅显示“未保存”，取消“内存文档·无修改”实现用语；编辑器说明条保持移除。

## 文件及用途

相对仓库 `E:\code\lightEdit`：

| 文件 | 用途 |
|---|---|
| `src/components/layout/AppMenu.vue` | 常驻menubar、独立下拉项、悬停/点击、键盘与视口落点、监听清理 |
| `src/components/layout/TopBar.vue` | 分离品牌与菜单、单条标题栏网格、窄窗工具收起 |
| `src/app/useAppShell.ts` | 帮助/模式入口，避免悬停菜单阻断编辑器全局快捷键 |
| `src/components/modals/SettingsModal.vue` | 暴露打开指定设置分组的方法，供帮助菜单使用 |
| `src/components/layout/StatusBar.vue` | 精简未命名文档状态用语 |
| `tests/menu-ui.mjs` | 启动时六入口可见、悬停不抢快捷键、帮助真实打开、旧菜单功能与明暗窄窗检查 |
| `tests/editor-native.mjs`、`phase3-ui.mjs`、`phase4-native.mjs` | 操作常驻分类入口，原生菜单/退出/格式/工作区及保存保护回归；原生窄窗六菜单与溢出断言 |
| 本文、`docs/PHASE_PROGRESS.md` | 用户纠正、实现、验证与遗留人工项 |

## 实际执行结果

| 检查 | 结果 |
|---|---|
| `pnpm typecheck`、`pnpm build` | PASS；159 modules，已有Tauri静态/动态import分块提示 |
| `pnpm test` | PASS 103/103，包括自动保存7项 |
| `pnpm test:ui:menu` | PASS 4组，包含常驻六入口、悬停/编辑快捷键、真实格式、帮助、搜索、缩放、明暗/680px |
| `pnpm test:ui:settings`、`pnpm test:ui:files`、`pnpm test:ui` | PASS 2组、5组IPC契约、9组 |
| `pnpm test:native:editor` | PASS 12组，自动保存/外部冲突、常驻菜单退出保护与格式、Markdown40次鼠标定位、分栏、设置退出重启 |
| `pnpm test:native:workspace` | PASS 11组，真实菜单、多根搜索/快速打开/CRUD/dirty保护与原生窄窗 |
| `git diff --check` | PASS |
| Rust check/test | 本轮设置/自动保存部分已实际PASS check、35/35，见下方设置报告；此次菜单追加没有修改Rust源码 |
| 独立lint | NOT RUN，未配置 |

新菜单最终原生证据：`test-results/editor-native/1791966740563/`、`test-results/phase4-native/1791966850561/`；浏览器`test-results/menu/menubar.png`、明暗/窄窗截图与results.json。完整设置与自动保存实现、真实磁盘/外部冲突证据、第一次启动等待超时及后续跟踪风险见 [SETTINGS_AUTOSAVE_UPDATE.md](SETTINGS_AUTOSAVE_UPDATE.md)。

## 手工项与门槛

运行`pnpm tauri dev`，确认菜单一直可见，悬停/点击打开并使用文件/编辑/格式/视图/工作区/帮助，检查不同DPI下的窗口拖拽和菜单定位。真实中文IME、125%/150%DPI、触控板、macOS/Linux仍待人工；不冒称这些已通过。

指定菜单样式及可执行回归已完成；Phase 6整体保持REVIEW，等待用户评审，不启动完整Phase 7/8。没有改变自动保存的安全边界或正常开发热更新。
