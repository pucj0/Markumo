# LightEdit Windows BAT/CMD 中文编码识别及语法高亮实施报告

## 1. 编码检测原有问题及修复方式

### 1.1 原有缺陷
原有的编码解码逻辑（`src-tauri/src/files/codec.rs`）流程如下：
- 检查 BOM；
- 若无 BOM，直接默认按 `UTF-8` 严格解码（无替换字符）；
- 若 UTF-8 解码失败，直接返回错误并在 `mod.rs` 中退回到 `Hex` 模式。

由于 Windows 下绝大部分包含中文的批处理脚本（`.bat`、`.cmd`）以及由系统或传统编辑器生成的 `.txt`、`.ini`、`.cfg` 都是默认采用 **ANSI（中文环境下为 CP936/GBK/GB2312）** 编码保存，且不带任何 BOM。旧流程直接判定 UTF-8 失败并回退为 HEX，导致用户打开 `package.bat` 看到十六进制乱码，且没有 Batch 语法高亮。

### 1.2 修复方案（严格四层渐进检测）
在 `codec.rs` 中重构自动解码算法：
1. **BOM 优先**：严格识别 UTF-8 BOM (`EF BB BF`)、UTF-16LE BOM (`FF FE`)、UTF-16BE BOM (`FE FF`)，一旦检测到 BOM 严格按对应编码解码。
2. **已知二进制魔数拦截**：在进入文本尝试前，检查已知二进制魔数（JVM ClassFile `CA FE BA BE`、PNG、JPEG、GIF、ZIP/Office `50 4B`、PDF、GZIP、7Z、RAR、PE EXE/DLL `4D 5A`、ELF 等）。命中魔数立即拒绝作为文本打开，绝不把二进制假装成 BAT 脚本。
3. **严格 UTF-8 优先**：无 BOM 时，优先尝试 strict UTF-8 解码。解码成功且不含 NUL (`0x00`) 或二进制控制字符（`0x00..=0x08`, `0x0B`, `0x0E..=0x1A`, `0x1C..=0x1F`），确定为 UTF-8 文本。
4. **传统编码智能识别与无损往返校验**：
   当 UTF-8 失败时，对文本类型（`.bat`, `.cmd`, `.txt`, `.csv`, `.ini`, `.cfg`, `.conf`, `.properties`, `.log`, `.sql`, `.md`, `.java`, 无扩展名等）：
   - 检查字节流不含 NUL 且不含二进制控制字节；
   - 使用 `GB18030` 解码（无替换字符）；
   - **字节级 100% 往返校验**：将解码文本重新以 `GB18030` 编码，必须与原始字节流 `bytes` **完全一致**；
   - **中文特征校验**：统计文本中包含的有效 CJK 字符/全角符号（`\u{4E00}..\u{9FFF}`、`\u{3000}..\u{303F}` 等），必须包含至少 1 个有效字符，避免纯随机高位字节误判；
   - 同样支持西欧语言的 `windows-1252` 校验；
   - 若不满足上述严格校验，返回明确错误提示并在 HEX 模式中供用户手动选择编码，不盲目武断认定。

---

## 2. GB2312 / GBK / CP936 兼容策略

1. **字符集包含关系**：
   `GB18030`（GB18030-2000 / GB18030-2005 / GB18030-2022）是我国强制性国家标准，严格向下兼容 `GBK`（微软代码页 CP936）及 `GB2312`。所有合法的 GB2312 和 GBK 双字节中文序列在 `GB18030` 下均具有完全一致的双字节编码表示与 Unicode 映射。
2. **准确命名与规范声明**：
   在底层 Rust 代码与前端交互中，支持用户请求 `GB18030`、`GBK`、`GB2312`、`CP936`，并统一使用标准兼容名称 `"GB18030"` 展示，界面提示为 `GB18030 (兼容 GBK/GB2312)`，真实且符合规范，不虚假声称已精确分离原始字符集。
3. **保持原文件编码方案与换行符**：
   - 打开 GB2312/GBK 文件后，文档元数据记录 `encoding: 'GB18030', bom: false, eol: 'CRLF'`；
   - 只要用户未显式修改文本，直接保存或自动保存时，重新编码生成的字节流与原始磁盘字节流 **100% 逐字节一致**；
   - 普通保存时默认保持当前编码与 CRLF，绝不自动转换成 UTF-8；
   - 只有用户通过状态栏显式执行“转换为指定编码并保存”或“另存为指定编码”时，才进行编码转换。

---

## 3. 状态栏编码手动选择交互

在 [src/components/layout/StatusBar.vue](src/components/layout/StatusBar.vue) 编码显示区域提供交互式下拉入口：

```
+-------------------------------------------------------+
| UTF-8 ▼                                               |
+-------------------------------------------------------+
|  以指定编码重新打开               >                    |
|    - UTF-8                                            |
|    - GB18030 (兼容 GBK/GB2312)                        |
|    - UTF-16LE                                         |
|    - UTF-16BE                                         |
|    - Windows-1252 (西欧)                              |
|    - 以字节方式打开 (HEX)                              |
|  ---------------------------------------------------  |
|  转换为指定编码并保存             >                    |
|    - UTF-8 (无 BOM)                                   |
|    - UTF-8 带 BOM                                     |
|    - GB18030 (兼容 GBK/GB2312)                        |
|    - UTF-16LE / UTF-16BE / Windows-1252              |
|  ---------------------------------------------------  |
|  另存为指定编码…                  >                    |
|    - UTF-8 / GB18030 / UTF-16LE / UTF-16BE / CP1252   |
+-------------------------------------------------------+
```

### 关键安全机制：
1. **重新打开 vs 转换编码严格分离**：
   - “以指定编码重新打开”：从磁盘原样读取字节并以新编码重新解释，**绝不修改磁盘字节**；
   - “转换为指定编码并保存”：将内存中当前内容按目标编码编码后写回当前文件；
   - “另存为指定编码…”：弹出另存为对话框，将内容按选定编码写入新文件。
2. **未保存修改保护**：
   若当前文档存在未保存修改（`doc.dirty`），点击“以指定编码重新打开”时，触发 `DiscardDialog` 确认对话框：
   - 允许用户选择“继续编辑”（取消操作，保留当前修改）；
   - 允许用户选择“放弃修改并重新打开”（丢弃未保存修改，重新从磁盘以新编码读入）；
   - 允许用户选择“保存后重新打开”（先保存修改，再以新编码加载）；
   - 绝不静默丢弃任何编辑内容。
3. **HEX 模式恢复正常文本编辑**：
   当用户在 HEX 字节模式下选择“以指定编码重新打开”为 GB18030 时，`FileService.reopen` 重新解码并返回文本模型，`DocumentManager.reloadFile` 自动卸载 HEX 视图并根据扩展名检测语言（`.bat` -> `Batch`），完全恢复正常文本 CodeMirror 编辑与语法高亮。
4. **有损保存防御**：
   转换编码时若目标编码无法表示全部字符（如将含中文文本转换为 `windows-1252`），`codec::encode` 拦截并返回 `encoding_loss` 错误，磁盘原文件与当前编辑内容均安全保留。

---

## 4. Windows Batch 语言模式实现

在 [src/editor/languages/batch.ts](src/editor/languages/batch.ts) 中，基于 CodeMirror 6 `StreamLanguage` 实现轻量 Batch 解析器：

1. **关键字识别**：
   `if`, `else`, `for`, `in`, `do`, `goto`, `call`, `exit`, `setlocal`, `endlocal`, `shift`, `not`, `exist`, `defined`, `errorlevel`, `equ`, `neq`, `lss`, `leq`, `gtr`, `geq` 等；
2. **批处理命令识别**：
   `@echo`, `echo`, `set`, `pause`, `cls`, `title`, `color`, `copy`, `xcopy`, `robocopy`, `move`, `del`, `erase`, `ren`, `rename`, `mkdir`, `md`, `rmdir`, `rd`, `dir`, `type`, `cd`, `chdir`, `pushd`, `popd`, `find`, `findstr`, `chcp`, `start`, `powershell`, `pwsh` 等；
3. **注释识别**：
   - 冒号注释：行首 `::...`
   - REM 注释：`rem ...`（大小写不敏感）
4. **变量识别**：
   - 环境变量：%VAR%, %DATE%, %WEB%
   - 延迟变量：!VAR!, !COUNT!
   - 参数变量：%~dp0, %~f1, %1 ~ %9, %*, %%a（FOR 循环迭代变量）
5. **字符串与标签**：
   - 双引号字符串 `"..."`
   - 跳转标签 `:label`
6. **安全保证**：
   Batch 模式纯粹作为 CodeMirror 词法高亮装饰，绝不调用系统 shell 或执行任何命令。

---

## 5. 修改文件清单

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| [src/editor/languages/batch.ts](src/editor/languages/batch.ts) | 新增 | CodeMirror 6 Batch/CMD 语法高亮解析器 |
| [src/editor/languages/index.ts](src/editor/languages/index.ts) | 修改 | 增加 `Batch` 语言定义，将 `.bat` 与 `.cmd` 映射到 `Batch` |
| [src-tauri/src/files/codec.rs](src-tauri/src/files/codec.rs) | 修改 | 严格四层解码：BOM 严格优先、二进制魔数拦截、严格 UTF-8、GB18030/CP936 智能识别与往返校验 |
| [src-tauri/src/files/mod.rs](src-tauri/src/files/mod.rs) | 修改 | `open_selected` 传入路径用于扩展名感知传统编码检测 |
| [src-tauri/src/files/tests.rs](src-tauri/src/files/tests.rs) | 修改 | 新增 `windows_traditional_chinese_batch_and_text_encodings_round_trip` 专项测试 |
| [src/components/layout/StatusBar.vue](src/components/layout/StatusBar.vue) | 修改 | 编码区域重构为交互式下拉菜单，支持重新打开、转换保存、另存为及 HEX 恢复 |
| [src/features/files/FileController.ts](src/features/files/FileController.ts) | 修改 | `save` 支持显式 `bom` 参数，`reopen` 支持 `force` 覆盖 dirty |
| [src/editor/core/DocumentManager.ts](src/editor/core/DocumentManager.ts) | 修改 | `reloadFile` 支持 `force` 标记，用于用户确认后的安全重新加载 |
| [src/app/useAppShell.ts](src/app/useAppShell.ts) | 修改 | 实现 `reopenEncoding`（带 dirty 保护）、`convertEncoding`、`saveAsEncoding` |
| [src/App.vue](src/App.vue) | 修改 | 状态栏编码事件绑定到 shell 控制器 |
| [tests/batch-syntax-and-encoding.test.ts](tests/batch-syntax-and-encoding.test.ts) | 新增 | Batch 语法词法、变量提取、CodeMirror 装载及前端重新打开/HEX 切换测试（8 项） |
| [tests/change-gutter.test.ts](tests/change-gutter.test.ts) | 修改 | 配合 `Batch` 语言模式更新原有断言 |
| [tests/files.test.ts](tests/files.test.ts) | 修改 | 配合 `Batch` 语言模式更新原有断言 |
| [tests/editor-core.test.ts](tests/editor-core.test.ts) | 修改 | 增加 `script.bat` 和 `script.cmd` 语言识别测试 |
| [docs/PHASE_PROGRESS.md](docs/PHASE_PROGRESS.md) | 修改 | 记录本次台账 |

---

## 6. 真实测试结果

### 6.1 Rust 自动化单元与集成测试
运行命令：`cargo test --manifest-path src-tauri/Cargo.toml`
结果：**83 passed / 0 failed**
覆盖：
1. `package.bat` 包含中文注释、`%date%`、`%web%`、`!variable!`，以 GB18030/GBK 编码：自动识别为 `GB18030`，不显示为 HEX；
2. 不修改内容直接保存后，原始文件字节 100% 完全一致；
3. 编辑中文后保存维持 `GB18030` 编码与 `CRLF`；
4. 合法二进制（PNG 图片、JVM ClassFile、含 NUL 字节数据）绝不误判为文本；
5. HEX 模式可安全调用 `reopen("GB18030")` 恢复为正常可编辑文本；
6. 转换为 `windows-1252` 时阻止有损保存，原文件与编辑内容均安全保留。

### 6.2 前端 Vitest 全套测试
运行命令：`pnpm test`
结果：**24 passed (24 test files, 245 passed / 245 total tests)**
- [tests/batch-syntax-and-encoding.test.ts](tests/batch-syntax-and-encoding.test.ts)：8/8 PASS
  - `.bat` / `.cmd` 检测为 `Batch` 语言；
  - `@echo`、`echo`、`rem`、`::` 词法高亮；
  - `%date%`、`%web%`、`!variable!`、`%~dp0`、`%1` 变量高亮；
  - `if`、`else`、`goto`、`exit` 控制流高亮；
  - 无副作用纯净装载入 `EditorState`；
  - 干净文档重新打开保持编码与 CRLF；
  - 未保存修改文档重新打开触发保护；
  - HEX 模式重新打开为 GB18030 恢复 Batch 高亮。
- 其余 23 个既有测试套件（含多分栏、文件保存、大纲、工作区等）100% PASS。

### 6.3 类型检查与构建
- `pnpm typecheck`：**PASS**（0 错误）
- `pnpm build`：**PASS**（产出 `dist/assets/batch-*.js`）
- `cargo check --manifest-path src-tauri/Cargo.toml`：**PASS**

---

## 7. 仍存在的编码歧义与限制说明

1. **纯 ASCII 文件的编码不可分性**：
   纯 ASCII 内容（如仅含 `@echo off\necho hello`）在 UTF-8、GBK、GB2312、GB18030、Windows-1252 下的字节完全相同。按照行业惯例（Notepad++、VS Code），无 BOM 纯 ASCII 文件默认标记为 `UTF-8`（因为它是所有这些编码的真子集）。保存时同样完全兼容。
2. **GB2312 vs GBK vs GB18030 名称统一性**：
   GB2312 是 GBK 的子集，GBK 是 GB18030 的子集。当一个文件只包含常用汉字时，它同时是合法的 GB2312、GBK 和 GB18030。界面统一显示标准兼容名称 `GB18030`，不虚假宣称区分这三者，但在保存时保证与原有双字节序列完全一致。
3. **罕见的非双向映射 GB18030 4 字节序列**：
   极少数历史 4 字节序列在 Unicode 映射中存在多对一情况。若检测到重新编码后字节发生微小变动，LightEdit 会拒绝自动判定为传统编码并保留在 HEX 模式，提示用户手动选择，以避免破坏非标准数据。
