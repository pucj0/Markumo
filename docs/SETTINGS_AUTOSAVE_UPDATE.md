# 设置、自动保存与编辑区精简 — 2026-10-14

## 范围与逐项结论

本轮是 Phase 6 首选项与编辑体验完善，并按用户明确指示接入真实文件自动保存单项。没有开始完整 Phase 7 的备份/异常恢复/文件监控，也没有实施 Phase 8；阶段保持 REVIEW。用户的默认自动保存要求覆盖此前保守的仅手动保存行为。无新依赖、无提交或推送，保留已有用户暂存/未暂存改动。

| 要求 | 结果 |
|---|---|
| 设置布局与图标优化 | PASS：统一标题/关闭/完成区域，独立内容滚动；外观、编辑、保存、Markdown、快捷键分类导航，统一控件、开关与间距；设置齿轮改为对称线条，增加字体/键盘图标。明暗与1200/680/460px截图验收 |
| 自动保存设置，默认开启 | PASS：新设置及缺少该字段的旧设置默认开启，停止输入1.5秒后保存；可关闭，延迟选择0.5/1.5/3/5秒，兼容既有有效自定义延迟；原生及浏览器偏好持久化/重启通过 |
| 字号可手动输入 | PASS：数值输入框，支持10–24整数；输入有效值即时应用；无效/空值不写设置，离开时恢复最近有效值；原有滚轮与Ctrl+0保留 |
| 编辑器去除无意义提示 | PASS：移除Ctrl+S/另存为说明条、内存/磁盘文件与渲染模式重复徽章、侧栏教程/连接状态、空页营销文案；保存成功不再弹Toast，底栏仍反映dirty/已保存。真正错误与必要不可写/BOM信息保留在错误反馈/底栏 |

## 自动保存的真实行为与边界

`AutoSaveController` 订阅统一DocumentManager，比较不可变 CM Text 身份并为每个dirty文件记录截止时间；输入不序列化全文、不每键IPC。所有文件共用一个计时器和后台串行保存队列，同文件在两窗格只存一份。移动光标/切换主题不重新推迟已有文件的保存。

只有已命名、已有Rust文件令牌、可写的dirty文档自动保存。未命名草稿不自动弹保存对话框；浏览器没有真实磁盘自动保存。真实中文IME组合期间、手动保存、工作区文件操作、设置或确认对话框期间延期。关闭标签/窗口以及工作区变更均检查正在保存，不能在写入中释放令牌或销毁窗口。

后台调用同一FileController与Rust `save_file`，使用snapshot原有编码、BOM/EOL和expectedDiskVersion；Rust仍执行版本检查与原子保存，不强制覆盖外部变化。保存期间继续输入仍保持dirty，新的文本按自己的延迟再次保存，使用上次返回的磁盘版本。权限/冲突等失败保留内容，只提示一次并暂停该文件的自动重试；后续输入不会反复弹错。用户可以手动保存/另存为处理，成功保存或重开清除暂停；重新启用开关可明确重试。销毁/HMR清理订阅与计时器。

## 改动文件与用途

以下路径相对 `E:\code\lightEdit`：

| 文件 | 用途 |
|---|---|
| `src/components/modals/SettingsModal.vue` | 分类导航、滚动布局、数值字号校验、自动保存开关/延迟、统一样式与键盘操作 |
| `src/components/common/Icon.vue` | 修正设置齿轮，新增轻量字体/键盘SVG |
| `src/components/layout/EditorContainer.vue`、`Sidebar.vue` | 移除说明条/教程/重复状态及对应CSS，精简空页 |
| `src/components/layout/StatusBar.vue` | BOM及不可写信息移到底栏，保留真正有用的文件元数据 |
| `src/features/shell/editorSettings.ts` | 自动保存字段、默认值、旧偏好迁移与范围检查 |
| `src-tauri/src/commands/settings.rs` | Rust偏好默认/校验/安全持久化及兼容测试 |
| `src/features/files/AutoSaveController.ts` | 基于Text身份的延迟保存、串行队列、失败暂停与生命周期清理 |
| `src/features/files/FileController.ts` | 后台保存入口、区分完成/新修改/失败/跳过，取消成功Toast，保持安全snapshot流程 |
| `src/app/useAppShell.ts`、`src/App.vue` | 设置接线、初始化与持久化、窗口关闭对后台保存的保护、卸载清理 |
| `tests/autosave.test.ts` | 默认/旧偏好、去抖/多窗格、草稿/只读、IME/文件操作/对话框延期、保存竞态、失败暂停和多文件串行，共7个单测 |
| `tests/settings-ui.mjs`、`package.json` | 设置布局、真实数值输入、偏好重载/关闭、明暗/窄窗口、快捷键/Esc与截图；新增测试入口 |
| `tests/editor-native.mjs` | 原生真实自动保存/开关/外部冲突及重启，新增启动失败截图/状态诊断 |
| `tests/phase2-ui.mjs`、`phase3-ui.mjs`、`phase4-native.mjs` | 新设置焦点顺序；保存验证从成功提示改为完成状态；原有dirty/手动保存用例显式关闭自动保存，自动保存由独立用例验收 |
| `README.md`、`docs/PHASE_PROGRESS.md`、本文 | 使用说明、真实验证记录及缺项 |

## 执行过的检查

Windows、Edge/WebView2、现有Rust/MSVC。浏览器测试使用独立Vite `http://localhost:1422`；原生脚本使用自己的1420服务及新建fixture/profile目录，未修改用户文件。原生脚本的 `--no-watch` 仅用于隔离测试；正常开发热更新保留。

| 命令 | 最终真实结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS 103/103（自动保存7） |
| `pnpm build` | PASS 159 modules，已有Tauri静态/动态import分块提示 |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline` | PASS 35/35（新增设置兼容/延迟校验） |
| `rustfmt --edition 2021 --check src-tauri/src/commands/settings.rs` | PASS |
| `pnpm test:ui:settings` | PASS 2组：数字输入/范围、默认/关闭/延迟/重载、分类布局、主题/窄窗口、快捷键/Esc |
| `pnpm test:ui:menu`、`pnpm test:ui:markdown-clicks` | PASS 4组；PASS 40次实际鼠标定位/输入撤销 |
| `pnpm test:ui:selection`、`pnpm test:ui:phase6` | PASS 5组；PASS 8组 |
| `pnpm test:ui:files`、`pnpm test:ui`、`pnpm test:ui:theme` | PASS 5组契约；PASS 9组；PASS 3组 |
| `pnpm test:native:editor` | PASS 12组：自动保存实际磁盘/BOM/CRLF/关闭/重开、外部冲突、窗口保护、Markdown选择/格式、分栏、设置退出重启等 |
| `pnpm test:native:workspace` | PASS 11组：多根恢复、万级虚拟树、搜索/CRUD/脏数据与安全授权 |
| `git diff --check` | PASS |
| 独立lint | NOT RUN，未配置 |

证据：`test-results/settings/`、`test-results/editor-native/1791965740296/`（failure:null，errors:[]）、`test-results/phase4-native/1791965888540/` 及既有menu/markdown-clicks/selection/phase6-review/phase2/phase3/theme目录。

过程问题没有跳过：新测试最初误用Vitest不支持的断言、将CM内部LF与保存CRLF混淆，以及可空新建ID类型声明错误，已更正，单测/类型/build通过。旧浏览器契约依赖现已删除的保存成功Toast、旧焦点用例假定主题是首个控件，改为检查磁盘版本完成和实际新首控件焦点循环后全量复跑通过。首次原生启动的15秒文件标签等待超时，未捕获页面错误，已加入失败截图/状态诊断；后续完整12组及工作区11组复跑通过。首次冷启动等待超时原因尚未确定，作为后续启动稳定性跟踪项，不冒称已定位修复。

## 人工步骤、风险与门槛

1. `pnpm tauri dev` 打开真实文本，修改后等待约1.5秒，确认dirty圆点消失、磁盘内容更新；在设置关闭自动保存后编辑，确认仍dirty，Ctrl+S手动保存。
2. 设置中输入字号17，再输入无效值/清空，确认最后有效值保留；切换分类、滚动和窄窗口，检查布局与焦点。
3. 外部修改同一文件后再编辑，确认自动保存错误且外部内容未覆盖；先另存为处理编辑内容。此行为已经在独立原生fixture实际执行。
4. 真实中文IME候选提交、DPI125%/150%、触控板、macOS/Linux仍 NOT RUN；组合延期用单元状态模拟验证，不冒称真实原生IME通过。

没有草稿恢复、定时备份、文件监控或断电恢复；尚未命名的草稿仍需用户选择位置保存，停止应用前依然使用dirty关闭确认。默认自动保存不会为已成功保存的编辑再提供关闭时“放弃”回滚；撤销仍属于同一CM历史，可撤销后再保存。外部版本检测、编码和原子写入均复用已经测试的安全实现。

本轮指定功能及可执行回归达到增量交付门槛，Phase 6保持REVIEW，整体PRD人工条款仍未全部验收；完整Phase 7/8未启动，无Git提交/推送。等待用户评审。
