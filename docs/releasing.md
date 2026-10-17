# 发布与自动更新

`.github/workflows/release.yml` 在推送 `vX.Y.Z` 标签时构建 Windows x64、Linux x64、macOS Apple Silicon 和 Intel。也可在 Actions 手动填写已有标签重试。版本必须与 package.json、Cargo.toml、tauri.conf.json 一致。

工作流使用 Node 24、固定 pnpm 12.11.2、锁文件和 Rust stable。每个系统运行类型检查、Rust 检查及测试后生成安装包。四个构建全部通过，发布脚本确认所有安装包和签名存在后，才上传并公开 Release。失败时不会将不完整版本设为 latest；可从 Actions 下载成功任务的构建产物。

## 更新签名

以下仓库 Actions Secrets 必须长期保留：

- `TAURI_SIGNING_PRIVATE_KEY`：Tauri updater 私钥内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码。

公钥写在 `src-tauri/tauri.conf.json`。同一产品后续版本必须沿用同一密钥，不能每次 CI 临时生成；私钥及密码不得提交到仓库或放进构建产物。初次配置已在本机用户目录 `.tauri/markumo/` 保存恢复副本，请单独安全备份。

Release 包含安装包、`.sig`、`SHA256SUMS` 和合并后的 `latest.json`。更新地址固定为 `https://github.com/pucj0/Markumo/releases/latest/download/latest.json`，使用 HTTPS 和 Tauri 原生签名验证。Windows 使用 NSIS；Linux 的应用内更新适用于 AppImage，deb 用户安装新版 deb；macOS 使用 `.app.tar.gz` 更新，`.dmg` 用于首次安装。

应用启动后延迟 10 秒检查版本，此后每 4 小时再检查。发现更新显示标记，点击才下载。安装前重新检查当前窗口无未保存修改、输入法组合或文件操作，并要求其他 Markumo 窗口关闭；安装期间阻止编辑，先持久化会话，再安装和重启。开发模式不执行安装。网络失败可重试或通过 GitHub 发布页手动下载。

当前 Windows 包没有商业代码签名证书，Mac 使用 ad-hoc 签名且未公证。它们与 updater 的必需签名是独立机制：Windows 可能出现 SmartScreen，macOS 首次运行可能需要在“隐私与安全性”中允许。未来正式分发证书可另行配置，不要移除更新签名。

## 发布下一版

1. 同步更新三个版本字段、Cargo.lock，以及 `docs/releases/vX.Y.Z.md`。
2. 运行 `pnpm typecheck`、`pnpm build`、Rust 检查 / 测试和相关浏览器回归。
3. 提交后推送代码与标签：`git tag vX.Y.Z`，`git push origin main vX.Y.Z`。
4. 等待四个构建及最终发布任务成功，检查 Release 的 4 个 updater 平台、安装包和 SHA256SUMS。

`scripts/release.mjs` 拒绝覆盖已经公开的版本；修改安装包应发布新版本。草稿发布失败可重试同一个标签。不要移动已公开的标签。

本地打包需要设置相同的 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量。只校验编译、不生成签名安装包时可使用 `pnpm build` 或 `cargo check`。

Windows 所有 `pnpm tauri build` / `build.bat` / CI 入口都会把生成的安装包、NSIS 输出目录及主程序设为 Medium 完整性，防止从受限工作目录继承 Low 标签，导致安装器无法写入普通安装目录。仅修改生成产物的安全元数据，不改变签名字节或用户安装目录的权限。回归命令：`node scripts/windows-artifacts-regression.mjs`。

验证：`node scripts/release-regression.mjs`；浏览器环境变量同 `scripts/media-regression.mjs`。

PDF 导出行号回归：`node scripts/export-code-regression.mjs`，并渲染检查生成的测试 PDF。左右大纲回归：`node scripts/outline-regression.mjs`。PDF 默认连续滚动、适应页面由媒体回归脚本覆盖。

实现参考：[Tauri updater](https://v2.tauri.app/plugin/updater/)、[GitHub Actions 官方工作流文档](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)。
