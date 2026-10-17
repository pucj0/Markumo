# 内置图片 / PDF 查看器交付记录

验证日期：2026-10-17。此次修改复用原有文档、标签、分栏、工作区及启动路由，没有替换 CodeMirror / ProseMirror。

## 文档与授权设计

原有 DocumentManager 的 `CachedDocument` 包含 EditorState、文本基线、选区和语言 Compartment。媒体文档存放在独立的 `mediaRecords` 中，仅保存 EditorDocument 元数据和每个窗格的页码、缩放、旋转、滚动等数值状态。媒体文档不会创建空 EditorState / EditorView，不加入文本保存、自动保存、编码转换或 Markdown 导出。

`metadata()` 和原有 TabGroup 对两类记录提供同一入口。文件通过规范化路径去重，预览替换及关闭最后一个引用时触发统一 Token 释放回调；关闭分栏也会释放最后一个文件引用。打开同一媒体的新磁盘版本会替换只读记录。最近文件、工作区和系统启动仍进入 `open_selected`，会话用 `Media` 标记恢复，无须为每种格式另建打开流程。

Rust 在原有 `checked_path` / 窗口 owner / Token 验证之后识别文件内容。元数据仅读取有界头部；JPEG 用 seek 跳过段，ICO / CUR 检查目录和内嵌 PNG / DIB 尺寸。扩展名不决定内容类型，图片内容即使名为 `.txt` 也能预览。文本原有 16 MiB 上限不变。

新增命令均只接受已经授权的 Token：

| 命令 | 用途 |
| --- | --- |
| `media_metadata(token)` | 格式、MIME、字节数、可获得的尺寸、磁盘版本 |
| `read_media_chunk(token, expectedVersion, offset, length)` | 原始二进制 IPC 响应，单块 1–256 KiB |
| `open_media_default(token)` | 校验后交给系统默认程序 |

每次读块重新验证授权、路径、实际格式、版本和边界；读完再次检查。全局最多 4 个排队 / 执行中的媒体读取，服务自身 Mutex 串行执行文件操作。单文件预览预算为 2 GiB。文件重命名沿用原有 grant 更新，外部修改、删除、失效 Token 会返回明确错误。未增加任意路径读取命令或全磁盘 capability。

## 图片

`ImageViewer.vue` 使用原生 `<img decoding="async">` 和 Blob URL，无图片处理依赖、Base64 缓存或额外图片窗口。支持 PNG / APNG、JPEG（含 JFIF 等别名）、GIF、WebP、BMP、SVG、ICO、CUR、AVIF。SVG 始终在图片上下文中解码，不插入文档 DOM。

按用户反馈调整为 IDEA 风格的紧凑图标工具栏：缩放比例、1:1、适应窗口 / 宽度、旋转、重置、刷新、系统打开。中性底色承托居中图片；按最新要求，透明区域使用纯色背景，不显示棋盘格或像素网格。小图默认不放大。支持拖动平移、以鼠标位置为中心的 Ctrl + 滚轮缩放和局部快捷键。窄窗格中的工具栏可横向滚动。

编码大小限制 128 MiB、总像素限制 64M、单边限制 32768。能从头部取得的尺寸在浏览器解码前检查，解码后再次检查实际尺寸；SVG 或缺失空间属性的 AVIF 由原生解码器给出尺寸。这里没有实现降采样。切走标签 / 关闭时取消等待、移除监听器与 ResizeObserver、撤销 URL，管理器只保留轻量查看状态。

## PDF

`EditorPane` 动态导入 PdfViewer；PdfViewer 再执行 `await import('pdfjs-dist')`。使用 pdfjs-dist 6.4.299。普通文本启动不会请求图片组件、PDF.js 或 Worker，回归脚本对此有断言。

Vite 将预构建 Worker、CMaps、标准字体、WASM 和许可证作为独立本地资源放进 `dist/pdfjs/`。开发服务器也直接提供这些原始资源，避免 Vite 5 为 Worker 的动态导入注入依赖 DOM 的辅助脚本。不使用 CDN，不打包 PDF.js 完整查看器 UI、示例或 Node 原生 canvas。

PDF.js 的 `PDFDataRangeTransport` 将范围请求转为 Token IPC。关闭自动预取和流式全量获取；每个查看器依次读取 256 KiB 块。PDF.js 需要整段交付的单次 Range 设 32 MiB 临时预算，超出时给出系统程序入口。PDF.js 自身仍可能为了交叉引用、字体或页面内容请求更多数据，因此不保证任意 PDF 的总解析内存恒定。

页面 DOM 虚拟化：正常比例约 3 页，只为可视范围及邻近页创建 Canvas / 文本层；缩得很小时包含屏内更多页，按窗口页数分配同一 64 MiB Canvas 像素目标预算，并限制 DPR 和 Canvas 单边。离开范围的页面取消 RenderTask、清空 Canvas backing store、移除文本层并调用页面 cleanup。此预算不包含 PDF.js 解析数据、字体、GPU 缓存或短暂取消中的任务。

按用户选择采用浏览器 / Edge 阅读习惯：默认连续滚动、适应宽度。紧凑图标工具栏提供页码输入、缩放选择和查找；窄分栏把旋转、抓手及单页模式收进更多菜单。默认保留文字选择，中键或抓手工具拖动平移；更多菜单提供刷新和系统打开。

缩放以阅读位置为锚点，Ctrl + 滚轮以鼠标位置为锚点（比窗口窄的页面继续居中）；旋转、分栏尺寸变化和搜索栏开关同步调整几何。切换标签仅保留每个窗格的轻量页内位置、比例及查找状态，回来后重新加载文档并恢复位置。此状态不跨应用重启保存。页码在 Enter / 失焦后提交，无效输入和 Esc 恢复当前页。支持 Ctrl+F、F3 / Shift+F3、Ctrl+G、PageUp / PageDown、空格和 Ctrl+加减 / 0。

缩放时保留旧位图的缩放预览，在 80ms 防抖后完成替换 Canvas 和文本层，避免每次按缩放都卸载整页。每代画布使用一半像素预算，稳态目标 32 MiB，两代重绘重叠目标 64 MiB；该目标不包含 PDF.js / GPU 和尚未完成取消的任务。

搜索从当前页开始，找到首个结果立即定位，后台继续逐页扫描并显示进度，完成后按页码排序。Esc 收起查找且保留查询；再次打开时可继续使用结果，未完成的扫描会重新开始。搜索只保留最多 10000 个匹配位置，不保存所有页面文本。仍支持连续 / 单页、首末页、前后页、文本选择复制、密码输入、失败状态和系统打开。

切走或关闭时销毁 loading task / 文档、取消 Range 队列、清理搜索和观察器、销毁 PDFWorker 并终止原生 Worker。异常清理设 2 秒强制终止兜底。PDF.js 已导入的模块代码无法主动卸载；这里释放的是文档、渲染和 Worker 资源。

## 验证结果

以下命令通过：

```text
pnpm typecheck
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

Rust 7 项测试全部通过，包括 >16 MiB 媒体、内容与扩展名不符、范围限制、目录 / 无效 Token / 跨窗口访问、只读保存拒绝、修改 / 重命名 / 删除、ICO 内嵌尺寸及 AVIF 识别。系统 TEMP 首次运行出现权限错误，后续以仓库内 `.markumo-media-test` 作为 TEMP / TMP 成功执行。

`scripts/media-regression.mjs` 在无界面 Chromium 中使用真实生成的图片 / PDF，IPC 由仅限测试样本目录的适配层提供。通过的场景：

- PNG、JPEG、BMP、WebP、GIF、SVG、ICO、CUR、AVIF、JFIF、APNG 与错误扩展名；SVG 不产生脚本对话框。
- 深浅主题、图片居中、纯色透明背景、旋转及重置。
- 单页、550 页、20 MiB PDF；密码错误后重试；搜索高亮及结果跳转。
- PDF 默认连续 / 适应宽度、居中缩放与鼠标锚点、切回标签恢复页内位置、缩放期间保留旧位图、关闭查找保持阅读位置。
- 长文档首个搜索结果在扫描完成前显示；混合横竖尺寸 PDF 旋转后适应宽度、单页模式 PageDown、无效页码 Esc、Ctrl+G 和窄分栏更多菜单。
- 快速跳页 / 缩放、加载中关闭；图片与 PDF 各 20 次打开关闭。
- 每轮最终无活跃测试 Worker、Canvas 和 Blob URL；单次 IPC 最大 262144 字节。
- 同路径不同 Token 去重、多余授权释放、预览替换、固定标签、分栏引用寿命、文本 Undo。
- 真实 SplitLayoutNode 中 Markdown 源码 / Live 与 PDF / ICO 左右显示，媒体不创建文本状态和 Markdown 切换器。

WebView2 桌面曾实际验证透明 PNG 和 Markdown 显示以及启动参数打开。随后用户按 Esc 停止了电脑操作，未再进行桌面自动化。因此**修复后的 PDF 在 WebView2 中的最终显示、NSIS 安装 / 卸载及所有系统“打开方式”操作仍未完成实机验收**。安装包本身已成功生成。Hex / ClassFile 的主处理路径保留，但没有完成其完整桌面操作回归。

### 体积实测

下表为实际文件字节数。dist 基线为修改前保存的工作区构建文件清单；NSIS 基线为工作区原有安装包，未在独立干净检出中重建，因此安装包对比不是严格受控实验。

| 项目 | 修改前 | 修改后 | 增量 |
| --- | ---: | ---: | ---: |
| dist 总计 | 6,883,779 B（6.56 MiB） | 12,213,482 B（11.65 MiB） | 5.08 MiB |
| 主 JS 磁盘文件 | 763,169 B（745.28 KiB） | 771,021 B（752.95 KiB） | 7.67 KiB |
| NSIS 安装包 | 6,011,210 B（5.73 MiB） | 8,519,916 B（8.13 MiB） | 2.39 MiB |

PDF 独立本地资源为 4,783,798 B，另有约 490 kB 的动态 PDF.js 主模块。增加的体积主要来自离线 Worker、字体、CMaps 和解码资源，没有进入首屏主 JS。

本次 PDF 阅读体验优化相对此前媒体版本增加 dist 16,306 B，主 JS 18 B，安装包 1,910 B；没有新增生产依赖。

### 内存与速度实测范围

最后一次无界面 Chromium 回归，强制 GC 后的**测试页主线程 JS Heap**：预热后 9,864,884 B；第 10 轮 10,184,180 B；第 20 轮 10,237,756 B。后 10 轮增加约 52 KiB。550 页样本默认适应宽度时，末页附近的 Canvas backing stores 共 22,458,240 B（约 21.42 MiB）；此前适应页面模式的 4.62 MiB 与此不是相同比例。20 轮结束后无测试 Worker / Canvas / Blob URL 残留。这些有限样本不能证明任意文件无泄漏，也不是 Markumo 总内存。

**未测量**：完整应用启动前后耗时、Rust 主进程 + WebView2 子进程总 Working Set / Private Bytes、GPU 内存和安装前后相同机器的稳定内存差。因此不宣称启动额外内存已达到 5 MiB 目标，也不把构建耗时作为启动耗时。

## 复现与产物

```text
python scripts/media-fixtures.py .markumo-media-test/fixtures
node scripts/media-regression.mjs
node scripts/media-size-report.mjs <before-assets.json> <before-installer.json>
```

样本生成需要 Pillow、reportlab、pypdf。回归需要 Playwright / Chromium；可用 `MARKUMO_PLAYWRIGHT_MODULE` 指定已有 Playwright 的 index.mjs，用 `MARKUMO_CHROME` 指定浏览器可执行文件。无需把这些工具加入应用生产依赖。

本地截图、日志、JSON 性能结果位于被忽略的 `.markumo-media-test/`。安装包：`src-tauri/target/release/bundle/nsis/Markumo_0.1.0_x64-setup.exe`。

## 格式及功能边界

- 暂不解码 TIFF、HEIC / HEIF、PSD、TGA、RAW、JPEG XL、压缩 SVGZ；现有 WebView 无法解码的受支持格式会给出明确错误。没有引入大型转码库。
- ICO / CUR 使用浏览器选择的图像，未提供内部多尺寸列表；GIF / APNG 正常播放，未增加逐帧编辑。
- PDF 不提供 OCR、编辑、签名、表单填写或注释 / 链接交互层；扫描 PDF 没有可搜索文字。搜索为不区分大小写的字面匹配，复杂跨行布局可能无法匹配整句。
- 查看器通过刷新或再次打开读取外部最新版本，没有新增文件系统后台监视服务。
- 原有会话持久化范围保持不变，未另行实现跨进程保存每个媒体的缩放状态。

设计参考：[IDEA 图片查看文档](https://www.jetbrains.com/help/idea/view-images-in-ide.html)。浏览器格式能力参考：[MDN 图片格式](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)；具体交付能力以上述真实样本测试为准。

## 修改文件清单

- 文档与命令：`src/editor/core/DocumentManager.ts`、`src/types/index.ts`、`src/features/files/contracts.ts`、`src/features/files/FileController.ts`、`src/features/files/media.ts`、`src/app/useAppShell.ts`、`src/App.vue`。
- 查看器：`src/components/viewers/ImageViewer.vue`、`PdfViewer.vue`、`PdfPage.vue`、`MediaEmpty.vue`、`ViewerIcon.vue`、`viewer.css`。
- 视图接入：`src/components/layout/EditorPane.vue`、`EditorContainer.vue`、`Sidebar.vue`、`StatusBar.vue`；`src/features/shell/fileIcons.ts`、`launchSession.ts`；`src/features/document-conversion/ExportController.ts`。
- Rust / 安装：`src-tauri/src/files/media.rs`、`files/mod.rs`、`commands/files.rs`、`lib.rs`、`session.rs`、`src-tauri/tauri.conf.json`、`src-tauri/windows/installerHooks.nsh`。
- 打包：`package.json`、`pnpm-lock.yaml`、`vite.config.ts`、`src/vite-env.d.ts`、`.gitignore`。
- 验证：`scripts/media-fixtures.py`、`media-harness.html`、`media-regression.mjs`、`media-size-report.mjs`；本说明文档。

工作区中原有 / 并行产生的 `build.bat` 和 `SplitLayoutNode.vue` 修改保留，不纳入此次代码提交。
