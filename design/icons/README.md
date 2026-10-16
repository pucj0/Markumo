# LightEdit 轻量图标 — 2026-10-16

## Markumo 更名更新

当前应用名为 **Markumo**。`markumo-app.png` 是由内置 `image_gen` 根据旧版浅色 L 图标编辑得到的 M 图标，仍采用白色圆角纸面、石墨色细字和鼠尾草绿光标。`public/logo.png`、`public/favicon.png` 及 Tauri 的 `icon.png`/`icon.ico` 已改用新图。下文 LightEdit 素材与提示词保留为历史设计记录，文件图标仍是没有字母的通用白纸。

本次编辑提示词：将深色 L 改为细石墨色大写 M，保留浅白圆角底、留白、淡灰边缘、右上方绿色光标与透明背景；32px 可辨认；不添加文字、阴影、徽标或装饰。使用项目 Tauri icon CLI 缩放和转换格式，命令为 `node scripts/tauri.mjs icon design/icons/markumo-app.png --output test-results/markumo-rename/icons`。

使用内置 `image_gen` 分别生成应用与文档图标，透明背景；没有使用 API/CLI 生图。原始生成图保存在此目录，不依赖外部用户目录。

## 设计与用途

- `lightedit-app.png`：浅白圆角纸面、细石墨色 L、小块鼠尾草绿光标。替换旧版深色大底和粗 L。
- `lightedit-document.png` / `lightedit-document.ico`：白色折角纸张、淡灰文字线，独立于应用标志。当前仅交付素材，未接入 Windows 文件关联；安装器目前仍使用程序图标。
- 应用派生资源已更新到 `public/logo.png`、`public/favicon.png`、`src-tauri/icons/icon.png` 和 `src-tauri/icons/icon.ico`。标题栏改用 PNG；删除已停用的旧 `public/logo.svg`，避免继续引用旧样式。

## 生成提示词

### 应用图标

Create ONE finished application icon for LightEdit, a lightweight Windows text editor. Minimal, airy, quiet, crisp flat graphic. Centered near-white softly rounded square paper tile occupying 82% of a square canvas, thin light neutral gray outline, VERY subtle edge definition, no heavy shadow. On the tile: a single elegant slender dark graphite capital L, upright with a short horizontal foot, medium-light typographic stroke, no serifs; a tiny muted sage-green vertical insertion cursor to its upper right, much smaller than L. Balanced generous white space, readable at 32px. Restrained two-tone graphite and sage on white. This is the application icon, not a file-sheet icon: NO folded corner, no text lines. No letters other than L, no brand name, no badges, no shortcut arrow, no enclosing dark tile, no gradients, no 3D, no mockup, no presentation sheet. Outside the rounded paper tile must be genuinely transparent alpha. Render a single icon with clean sharp edges at high resolution, square composition.

### 文档图标

Generate ONE minimal Windows document-file icon to accompany LightEdit text editor. A single clean white upright sheet of paper, slightly taller than wide, very small fold at top right, thin pale gray edge, five short fine pale gray horizontal text lines in the upper middle. Plain text-file appearance, very understated, instantly recognizable at 32 pixels. No logo, no L, no T, no words, no file extension label, no app badge, no shortcut arrow. Straight front view, no perspective. Flat vector-like shapes, no texture, no grain, no gradient, no thick shadow, no dark tile. Transparent alpha outside the paper silhouette. Place one centered sheet in a square canvas, using 82% of height and about 64% of width, generous transparent margins. Finished simple production asset, not a mockup or contact sheet.

## 派生与检查

```powershell
node scripts/tauri.mjs icon design/icons/lightedit-app.png --output test-results/logo-light-app
node scripts/tauri.mjs icon design/icons/lightedit-document.png --output test-results/logo-light-document
```

由项目管理的 Tauri CLI 机械缩放、编码为 PNG/ICO。已查看实际 32/64/128px 图标，缩小后 L 与纸面可辨认；预览在 `test-results/logo-light-app/size-preview.png`。未安装新版、未刷新桌面图标缓存、未打包或发布。

`pnpm typecheck` 本轮执行失败：已有未跟踪测试文件 `tests/markdown-fence-codeblock.test.ts` 的 `resolveLanguage`、`s` 未使用（TS6133）。全工作区 `git diff --check` 发现已有 `LanguageSelector.ts:121` 行尾空白；本次图标文件与标题栏改动的定向检查通过。保留其他任务的现有修改。
