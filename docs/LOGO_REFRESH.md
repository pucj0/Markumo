# LightEdit Logo 重绘 — 2026-10-15

状态 REVIEW；用户追加授权的视觉素材修订，不推进新 Phase。保留图片原生验收暂停、其他并行改动和所有文件读写行为。

## 设计

以手工 SVG 路径作为唯一母版：深墨色圆角底、暖白几何 L 与低饱和鼠尾草色插入光标。无渐变、阴影、纹理和依赖字体的字形。图形直接适应小尺寸，表达通用文本编辑器，不使用 Markdown 专属符号。

## 文件用途

| 路径 | 用途 |
|---|---|
| `public/logo.svg` | 512×512 可编辑矢量母版与前端 Logo |
| `public/logo.png` | 512×512 RGBA 通用素材，兼容原路径 |
| `public/favicon.png` | 32×32 浏览器图标 |
| `src/components/layout/TopBar.vue` | 标题栏切换到 SVG，避免缩放发虚 |
| `src-tauri/icons/icon.png` | 512×512 RGBA Tauri 应用图标 |
| `src-tauri/icons/icon.ico` | Windows 图标，包含 16/24/32/48/64/256 六种尺寸，复用于程序和 NSIS |
| `src-tauri/build.rs` | 显式监听 ICO/PNG；修复只换图标时 Cargo 复用旧 Windows resource 的问题 |
| `docs/LOGO_REFRESH.md`、`docs/PHASE_PROGRESS.md` | 验证记录 |

全部 PNG/ICO 从 SVG 经现有 Tauri CLI 派生，没有新增依赖。临时生成的 iOS/Android/ICNS 素材仅在被忽略的 `test-results/logo-generated/`，未扩展生产平台配置。

## 验证

- PASS：`node scripts/tauri.mjs icon public/logo.svg --output test-results/logo-generated`，实际完成图标转换。
- PASS：检查 512×512/32×32 PNG 的 RGBA 格式、ICO 的六种尺寸；前端 PNG 与 Tauri PNG 的 SHA-256 一致。证据 `test-results/logo-generated/validation.json`。
- PASS：实际查看 512px 与 32px 渲染，形状完整，无裁切。
- PASS：`pnpm typecheck`。
- 首次更换素材后完整打包成功，但读取 EXE 图标发现仍是旧版，根因是 Cargo 未因图标文件变化重新执行 Windows resource 编译。已在 `build.rs` 增加 ICO/PNG 的 `rerun-if-changed`，最终重建及 EXE 实际图标复验见进度台账。没有执行安装/卸载、启动桌面应用或改动系统图标缓存；DPI、多平台运行尚未验收。
- PASS：最终 `node scripts/package.mjs --skip-install` 完整构建，生成安装包 **3695344 字节（3.52 MiB）**；直接解析 Windows PE 资源，确认 16/24/32/48/64/256 六个图标图像与新 ICO **逐字节一致**。证据 `test-results/logo-generated/exe-icon-validation.json`。该检查不执行应用程序。

人工验收：下次安装新版后，检查桌面/任务栏/窗口/安装器图标，以及浅色和深色标题栏 26px 的显示。若需继续调整视觉，编辑母版后重新派生图标。当前不宣称正式发布或系统图标缓存刷新已通过，不提交、推送或发布。
