# 设置中心与快捷键配置

本次修改保留原有弹窗尺寸、设置默认值、更新和平滑光标配置，无新增依赖，不涉及应用版本或发布。

## 设置导航与控件

- 分类顺序与右侧 DOM 一致（外观、编辑、更新、保存、Markdown、导入与导出、快捷键）。
- 只监听 `.settings-content` 的被动 scroll 事件，通过合并到单次 rAF 的标题坐标计算当前分类，顶部和底部单独处理。ResizeObserver 观察容器和各分类，内容过滤、图片设置展开、字体或窗口变化后重新计算。静止时无循环。
- 点击导航使用容器的 scrollTo，原生 smooth 滚动可以被滚轮中断；减少动画偏好下直接定位。关闭/卸载时清理监听、Observer 和待执行帧。aria-current="location" 标识当前分类。
- SegmentedControl 使用 radiogroup/radio、aria-checked 和单个 Tab 入口；方向键循环选择，Home/End 定位，Space/Enter 使用原生按钮激活。
- 主题、Markdown 默认模式、文件夹展开方式、PDF 方向平铺；缩进提供 2/4/8 快选和 1–8 的数字输入。复杂字体/纸张/页边距保留原控件。
- 快捷键工具栏粘性定位限制在分类内部；列表只有外层设置内容一个滚动容器。搜索支持名称、ID、存储按键、平台显示按键和默认兼容键。

## 原因与统一关系

原设置页读取完整 definitions.ts，但 editorSettings.ts 只有 26 个旧快捷键。旧校验不接受空值、PageUp/PageDown 和多种 Alt 组合，迁移时只保留小集合，而且一次无效绑定会丢弃整套自定义配置。执行端又先调用 PM 的硬编码快捷键，再处理配置。冲突确认仅清除旧命令，未写入目标命令。

现在 57 个可配置命令来自同一份目录：ID、中文名、描述、分类、描述性 scope、实际 contexts、默认键、兼容键、executeId、supported、userOverridable 和 repeatable。默认配置、设置行、预设、冲突判断、匹配和菜单提示使用这些关系。浏览器测试逐项检查每个目录命令在真实 shell CommandRegistry 中有执行入口；当前没有仅供展示的未实现命令。临时条件不满足（例如普通文本中插入 Markdown）由执行入口的 enabled 和焦点规则处理。

| 命令族 | 实际入口与适用路径 |
| --- | --- |
| 新建、打开、保存、关闭、快速打开、命令面板 | shell 文件操作、FileController、palette，桌面能力和忙碌状态保持原限制 |
| 撤销、重做 | DocumentManager 的统一源文档历史；内嵌 CM 不建立第二套历史 |
| 删除/复制/移动行、注释、折叠、大小写 | 当前获得焦点的 CodeMirror；适用于普通文本、Markdown 源码、围栏代码及 HTML 源码 CM |
| 查找、替换、上下匹配 | 普通/源码 CM 搜索；富文本及其内嵌代码块共用 LiveSearchController，搜索输入内也响应已配置键 |
| Markdown 格式、标题/普通段落 | 源码使用 markdownFormatTransaction；实时排版使用 PM 格式命令；内嵌 CM 不触发正文格式 |
| Markdown 三种模式、大纲 | shell/DocumentManager 的当前窗格模式与大纲操作 |
| 标签、分栏、字号、侧栏、专注 | 现有 shell/layout 操作；非重复操作忽略按键长按的 repeat |

旧的 close-pane → close-current-pane、merge-splits → merge-panes 映射显式记录。format-*、outline、focus、md-* 菜单入口共享规范命令的配置与提示。普通段落补齐真正的源码和 PM 执行，移除原先的 any 类型伪装。

## 配置与优先级

shortcutVersion 提升为 4（应用版本、settingsVersion 未变，Rust 同步允许保存）。缺少的 ID 才使用所选预设的默认值；空字符串表示用户主动解除绑定。customShortcuts 记录与当前预设不同的命令。旧 map 逐项规范化，损坏单项不会抹除其他自定义值；有证据的旧默认迁移到现有默认，模糊的已有自定义值保留。新命令的默认若占用旧配置，留空，绝不发明替代快捷键。旧配置已有重叠会在设置行提示，用户可以明确重新分配。

预设切换/整套恢复都先显示确认及已修改数量，再一次提交 preset+bindings。Fleet 的 Mod+B 保留侧栏用途，继承的加粗留空；Typora 的 Mod+Shift+F 保留侧栏、Mod+Shift+K 保留围栏，继承的工作区搜索/删除行留空。旧用户已经保存的这些值仍按旧值载入，只有明确确认应用新预设才替换。

冲突检测比较实际焦点上下文集合，而非简单判断 scope 名称不同。录制器提示所有重叠的原命令，确认时纯函数生成一次完整的新 map：解除所有重叠原绑定并为目标赋值，取消没有写入。单项恢复也进行冲突检测。

- 唯一有意保留的默认共享键为 Mod+0：Markdown 正文（源码/实时排版）普通段落优先，其他可用位置恢复字号；正文外的内嵌代码编辑器保留字号恢复。
- Mod+Shift+I 是应用的插图键，不再与“开发工具保留键”自相矛盾。剪贴板/全选和刷新保留键仍不允许录制覆盖。
- Mod+Shift+Z 是默认重做的兼容键；Mod+Shift+= 是默认放大的兼容键。兼容键参与真实冲突检测，重绑或清除主绑定后停用。显式绑定先于兼容键；实际 Markdown 正文命令先于范围更广的全局命令。
- shell 捕获阶段只处理当前上下文的已配置命令及属于可配置命令的旧内核键；清除或重绑后旧键不会从 CM/PM 再次漏出。CM/PM 的其余原生键位仍保留，Tab、方向键、Enter、剪贴板、输入法不被整体禁用。
- 对话框与录制器不执行编辑命令。普通输入/搜索输入保留原生剪贴板与撤销。composition/isComposing、AltGraph、macOS 的额外 Control、Windows 的额外 Meta 不转成可配置 Mod。
- 应用内连续轻按两次 Shift（400ms 内，左右 Shift 均可）打开全局文件搜索并聚焦输入框，复用“快速打开文件”的多根工作区索引、路径模糊匹配与打开逻辑。原有快速打开快捷键和各预设继续可用；双击 Shift 是独立手势。只有两次独立的纯 Shift 按下／松开才触发，长按、自动重复、两侧 Shift 同时按住、Shift 配合打字或方向键、点击、窗口失焦和输入法组合会取消识别。弹窗、快捷键录制、更新安装和启动加载期间不触发，卸载时清理监听。标题栏快速打开按钮及快捷键说明提示该入口。
- Mod 按平台解析 Ctrl/Command；Option 产生特殊字符时通过物理字母/数字/标点代码识别已有 Alt 组合。

## 修改文件

| 文件 | 用途 |
| --- | --- |
| src/components/modals/SettingsModal.vue | 滚动联动、平铺控件、响应式行布局、搜索筛选、预设确认和原子更新 |
| src/components/common/SegmentedControl.vue | 可复用无障碍分段控件 |
| src/components/common/ShortcutRecorder.vue | 录制/清除/恢复、重分配目标、焦点及 IME 处理 |
| src/features/shell/keybindings/{contracts,definitions,normalizer,presets,conflict,resolver,index}.ts | 唯一目录、默认/兼容键、平台转换、上下文匹配、冲突和原子重分配 |
| src/features/shell/editorSettings.ts | 从目录派生默认、逐项迁移、明确清除、配置持久化 |
| src/app/useAppShell.ts、src/App.vue | 配置与捕获执行统一、实际命令别名、菜单提示、原子预设提交 |
| src/editor/core/DocumentManager.ts | 焦点内嵌 CM 的行命令/大小写、共享搜索与历史、动态 PM 菜单提示 |
| src/editor/markdown/{formatCommands.ts,wysiwyg/MarkdownEditorController.ts,wysiwyg/contracts.ts} | 普通段落的完整执行与可配置提示 |
| src-tauri/src/commands/settings.rs | shortcutVersion 4 支持和真实磁盘回归 |
| scripts/settings-keybindings-regression.mjs | 真正挂载 App、录制与按键执行的浏览器回归 |

已检查 menuModel.ts、mainMenu.ts、core/extensions.ts 和 CodeBlockView.ts；现有菜单/内核本身仍保留，通过公共目录的映射和捕获优先级接入。

## 验证与边界

自动测试输出位于 test-results/settings-keybindings，包含截图与逐项 results.json。覆盖普通/源码/即时排版/内嵌 CM/分栏真实按键、预设、配置重载、旧版迁移、录制清除、原子重分配、单项/整套恢复、搜索输入、纯修饰键、IME 事件、平台按键转换、滚动/动态高度/窄窗大字号/减少动画。Rust 测试执行真实设置磁盘往返，保留完整命令、清空值、预设和之前新增的偏好。

浏览器自动化不等同于实际屏幕阅读器和 macOS 系统热键验证。仍需在原生桌面上人工检查 VoiceOver/NVDA、macOS 系统占用键和真实 IME 候选窗；重启 Tauri 开发进程才能载入 Rust 的 shortcutVersion 支持。触控板惯性/操作系统滚动条的手感也应以实际桌面体验复核。

最终执行结果（2026-10-17）：

| 命令 | 结果 |
| --- | --- |
| pnpm typecheck | 通过 |
| pnpm build | 通过；保留已有的大分块与 Node 模块外部化提示 |
| node scripts/settings-keybindings-regression.mjs | 25 项通过，浏览器错误为空 |
| node scripts/rich-clipboard-regression.mjs | 14 项通过 |
| node scripts/smooth-caret-regression.mjs | 23 项通过 |
| node scripts/updater-regression.mjs | 32 项通过（安装器为 mock）；并行高负载时一次虚拟时钟断言波动，单独完整复跑通过 |
| node scripts/heading-outline-regression.mjs | 3 项通过 |
| node scripts/markdown-empty-regression.mjs | 空文档输入、撤销、清空、段落和模式切换通过 |
| cargo test --manifest-path src-tauri/Cargo.toml | 19 项通过，包含完整快捷键的真实磁盘往返 |
| git diff --check | 通过 |

截图：test-results/settings-keybindings/settings-light.png、settings-dark.png、narrow-large-font.png。
