# LightEdit Windows 文件关联与右键菜单集成实施报告

## 1. 问题根因分析

1. **配置缺失**：
   原有 `src-tauri/tauri.conf.json` 中没有配置 `bundle.fileAssociations`，生成 NSIS 安装包时 Tauri 默认不生成任何文件类型关联。
2. **Tauri 默认 NSIS 关联存在抢占风险**：
   Tauri 内置的 `FileAssociation.nsh` 的 `APP_ASSOCIATE` 宏在注册文件类型时，直接将 `Software\Classes\.${EXT}` 的 `(Default)` 键值覆写为应用程序的 ProgID。这会强制抢占用户已有的默认程序（例如将 `.txt` 强行从 Notepad++ 或系统记事本改成 LightEdit），违反了“不抢占默认应用”、“不篡改 UserChoice”的原则。
3. **缺少 Windows 10/11 标准注册项**：
   Windows 11 的“打开方式”、“选择其他应用”与“设置 → 默认应用”依赖：
   - `HKCU\Software\Classes\Applications\lightedit.exe\SupportedTypes`
   - `HKCU\Software\Classes\<ext>\OpenWithProgids`
   - `HKCU\Software\LightEdit\Capabilities\FileAssociations`
   - `HKCU\Software\RegisteredApplications`
   单纯在扩展名上写默认值不仅无法被 Windows 11 “默认应用”设置识别，还极易触发系统重置文件关联提示。
4. **右键菜单缺失**：
   此前未在 `SystemFileAssociations` 下注册 `shell\LightEdit\command`，因此在文件右键菜单（Win10 原生菜单 / Win11 “显示更多选项”）中找不到“使用 LightEdit 打开”。

---

## 2. 解决方案与注册架构设计

### A. 安全文件关联宏重定义（无感提供候选，绝不抢占）
在 [src-tauri/windows/installerHooks.nsh](../src-tauri/windows/installerHooks.nsh) 中，重定义 Tauri 的 `APP_ASSOCIATE` 与 `APP_UNASSOCIATE`：
- 不向 `Software\Classes\.${EXT}` 默认值写入任何内容。
- 仅向 `Software\Classes\.${EXT}\OpenWithProgids` 写入独立 ProgID。
- 注册 `Software\Classes\${FILECLASS}`（包含名称、图标、打开命令）。
- 卸载时仅清理 `OpenWithProgids` 中 LightEdit 自身的键和 ProgID 节点。

### B. Windows 11 打开方式与应用能力注册
- **`Software\Classes\Applications\lightedit.exe`**：
  - `FriendlyAppName` = `"LightEdit"`
  - `DefaultIcon` = `"$INSTDIR\lightedit.exe,0"`
  - `shell\open` = `"使用 LightEdit 打开"`
  - `shell\open\command` = `'"$INSTDIR\lightedit.exe" "%1"'`
  - `SupportedTypes`：注册所有 29 种文件扩展名（`.txt`、`.md`、`.json` 等空字符串键）。
- **`Software\LightEdit\Capabilities`**：
  - `ApplicationName` = `"LightEdit"`
  - `ApplicationDescription` = `"LightEdit 轻量文本与 Markdown 编辑器"`
  - `ApplicationIcon` = `"$INSTDIR\lightedit.exe,0"`
  - `FileAssociations`：映射 29 种扩展名到 `LightEdit.Document`。
- **`Software\RegisteredApplications`**：
  - `"LightEdit"` = `"Software\LightEdit\Capabilities"`

### C. 右键菜单（“使用 LightEdit 打开”）
- 在 `Software\Classes\SystemFileAssociations\<ext>\shell\LightEdit` 下注册：
  - `(Default)` = `"使用 LightEdit 打开"`
  - `Icon` = `'"$INSTDIR\lightedit.exe",0'`
  - `command\(Default)` = `'"$INSTDIR\lightedit.exe" "%1"'`
- 在 `Software\Classes\SystemFileAssociations\text\shell\LightEdit` 下同样注册。
- 支持 Windows 10 标准右键菜单以及 Windows 11 的“显示更多选项”（Shift+F10）与“打开方式”子菜单。
- **关于 Windows 11 新版顶层右键菜单说明**：
  Windows 11 全新 XAML 顶层右键菜单不接受普通注册表 Shell Verb，必须实现微软 COM `IExplorerCommand` 接口、生成独立 InProcServer32 DLL 并声明包含包标识的 Sparse Package (MSIX Identity)。依据规范，本次先完整交付标准的经典右键菜单与打开方式，不引入重量级运行时，将新版顶层菜单留作后续专项。

### D. 卸载安全清理机制
- 在 `NSIS_HOOK_PREUNINSTALL` 中：
  - 仅删除 LightEdit 拥有的 `RegisteredApplications\LightEdit`。
  - 仅删除 `Software\LightEdit` 与 `Software\Classes\Applications\lightedit.exe`。
  - 仅删除 `SystemFileAssociations\<ext>\shell\LightEdit`。
  - 父级目录使用 `DeleteRegKey /ifempty`，仅在目录为空时移除，绝不误删其他软件在同一扩展名下的设置。
  - 调用 `SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)` 刷新 Windows 缓存。

---

## 3. 支持的文件扩展名（共 29 种）

| 分类 | 扩展名列表 | MIME / 说明 |
|---|---|---|
| **文本文档与日志** | `.txt`, `.log`, `.ini`, `.cfg`, `.conf`, `.properties` | `text/plain` |
| **Markdown 文档** | `.md`, `.markdown` | `text/markdown` |
| **JSON 数据格式** | `.json`, `.jsonc` | `application/json` |
| **配置与标记文件** | `.xml`, `.yaml`, `.yml` | `text/plain` |
| **Web 前端源码** | `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.html`, `.css`, `.scss` | `text/plain` |
| **编程语言与脚本** | `.java`, `.py`, `.go`, `.rs`, `.sql`, `.sh`, `.bat`, `.cmd` | `text/plain` |

---

## 4. 修改文件列表

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) | 修改 | 添加 29 种文件扩展名 `fileAssociations` 与 NSIS `installerHooks` 配置 |
| [src-tauri/windows/installerHooks.nsh](../src-tauri/windows/installerHooks.nsh) | 新增 | NSIS 关联脚本：防抢占 APP_ASSOCIATE 宏、POSTINSTALL 注册与 PREUNINSTALL 清理 |
| [tests/windows-associations.test.ts](../tests/windows-associations.test.ts) | 新增 | 自动化单元测试：校验 29 种扩展名声明、注册宏定义、双引号与安全清理规则 |
| [tests/installer-smoke.ps1](../tests/installer-smoke.ps1) | 修改 | 安装器 Smoke 测试增加安装后注册表验证与卸载后彻底清理验证 |
| [tests/installer-app-smoke.mjs](../tests/installer-app-smoke.mjs) | 修改 | 增加 Playwright 缺失时的优雅回退（直接校验二进制命令行启动与参数传递） |
| [docs/阶段进度与验收台账.md](阶段进度与验收台账.md) | 修改 | 记录本次 Windows 文件关联台账 |
| [Windows文件关联与右键菜单集成.md](Windows文件关联与右键菜单集成.md) | 新增 | 本交付实施说明文档 |

---

## 5. 实际测试与验证结果

1. **TypeScript 类型检查 (`pnpm typecheck`)**：
   - 结果：**PASS**（0 错误）
2. **Vitest 单元/集成全套测试 (`pnpm test`)**：
   - 结果：**22 passed (22 test files, 231 passed / 231 total tests)**
   - 包含新增 `tests/windows-associations.test.ts` 7/7 项测试通过。
3. **前端生产打包构建 (`pnpm build`)**：
   - 结果：**PASS**（207 个模块转化，生成生产 `dist/`）
4. **Rust 编译与测试 (`cargo check`, `cargo test`)**：
   - `cargo check --manifest-path src-tauri/Cargo.toml`：**PASS**
   - `cargo test --manifest-path src-tauri/Cargo.toml`：**58 passed / 58 tests** 全部通过。
5. **本地打包脚本检查 (`build.bat --check`)**：
   - 结果：**PASS**（基础工具链与平台检查正常）。

---

## 6. Windows 11 手工验收步骤

1. **打包与安装**：
   - 运行 `build.bat` 生成 NSIS 安装包。
   - 运行生成的安装程序（currentUser 模式安装）。
2. **“打开方式”候选项验证**：
   - 在任意文件夹准备一个 `test.txt` 或 `readme.md` 文件。
   - 右键文件 → 选择“打开方式” → 确认列表中显示 **LightEdit**。
   - 点击“选择其他应用” → 列表中显示 **LightEdit**。
3. **“默认应用”设置验证**：
   - 打开 Windows 11 “设置” → “应用” → “默认应用”。
   - 在“为文件类型或链接类型设置默认值”搜索框中输入 `.md` 或 `.txt`。
   - 确认 LightEdit 出现在可选列表中。
   - 在已安装应用列表中搜索“LightEdit”，确认列出了支持的 29 种文件扩展名。
4. **右键菜单“使用 LightEdit 打开”验证**：
   - 准备包含中文或空格路径的文件（如 `D:\测试 目录\示例文档.md`）。
   - 在 Windows 10：右键文件，直接看到菜单项「使用 LightEdit 打开」。
   - 在 Windows 11：右键文件 → 点击「显示更多选项」（或按 Shift+F10），看到「使用 LightEdit 打开」。
   - 点击该选项，确认 LightEdit 正常启动，并以单文件模式直接展示该文件内容，无多余标签页，不破坏旧工作区。
5. **防抢占验证**：
   - 在安装 LightEdit 前，将 `.txt` 默认打开方式设为系统记事本。
   - 安装 LightEdit 后，双击 `.txt` 文件，确认仍然由系统记事本打开，用户选择权未被抢占。
6. **卸载清理验证**：
   - 运行卸载程序完成卸载。
   - 检查注册表 `HKCU\Software\Classes\Applications\lightedit.exe` 与 `HKCU\Software\LightEdit`，确认已被清理无残留。
   - 再次右键 `.txt` 文件，确认无悬空或损坏的无效关联。
