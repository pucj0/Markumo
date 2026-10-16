# Markdown Source Preservation（2026-10-15）

## 当前行内源码增量契约

链接/图片/强调的局部 CM 仅在可验证的 Lezer 源范围与 PM Fragment 一致时打开，no-op 聚焦不改源码。可表示输入提交 PM Transaction，同时携带带块 id 的精确 raw 区间；Bridge 使用保留 reference environment 的解析结果验证节点，不能把邻近引用链接/空格改成序列化后的另一种写法。其他 Pane 改写目标使旧控件失效；非目标改动映射位置。非法多块/超 8192 字符草稿保留可见并阻止保存、模式与关闭，修正或显式 Esc 取消后解除。没有独立保存、history 或全文响应式 v-model。实际 BOM/CRLF/同段邻近语法证据见 [本轮报告](统一语言与Typora编辑体验整改_2026-10-15.md)。

## 权威数据与保存

磁盘 Markdown 文本是持久化权威。DocumentManager 的 canonical CodeMirror Text 采用 LF；既有 lineEndings RangeSet 跟踪每个原始分隔符，Rust 仍持有编码/BOM/文件版本授权。ProseMirror 文档只是 Live 可编辑模型，不能直接全量 serializer 后覆盖磁盘。

打开、选择、滚动、主题/字号更改、Live/Source/Split 切换不执行源码序列化。保存只取已有 canonical snapshot，经原 FileController 和 Rust 服务。Windows 原生已实测无修改切模式/保存后 UTF-8 BOM、CRLF、所有 Markdown 字节完全一致。

## 来源映射与补丁

1. 初次 Live 打开，用共享 markdown-it 的顶层 token.map 建立块范围；YAML 先隔离，保留定义/无法解析区间。
2. 每个顶层块保存稳定 sourceId、LF 源码起止、原始切片、前置分隔和 PM Node。没有发生变化的块直接复用原始切片。
3. PM appendTransaction 给新增/拆分的顶层块分配唯一身份，避免复制/拆分时重复来源覆盖。
4. 一个块修改时只调用该块 serializer；普通表格形状不变时只生成发生变化的单元格文本，其他空格/对齐分隔符/转义/单元格源码逐字保留。行列结构改变只重写该表格。
5. 代码块保留围栏字符、长度和信息字符串；当代码包含冲突围栏时增大围栏，保证内容不变。未修改的不完整围栏也直接保留原切片。
6. 组合新源码时复用未修改块，计算最小共同前后缀补丁，不切断 UTF-16 高代理字符；发给 DocumentManager 前检查 expected source 与当前 canonical source 完全相同。过期、只读或不能序列化的编辑拒绝应用并提示，不静默覆盖。
7. 只有 canonical 接受后，Live 状态与来源记录推进。新补丁通过既有 CM 行尾历史跟踪和共享撤销保存，原始未改动换行继续映射。

这里不会对每次 Live 输入全文重新 parse/serialize 或重建编辑器；组合源码/比较 expected source 仍有线性字符串开销。编辑性能有实际基准，超预算改用 Source。

## 无法无损表示的语法

HTML 块、未知 `:::` 扩展、复杂/未知语法保留 `protected_source`；YAML 是独立折叠源码；公式/脚注/目录/Callout 有明确适配，保留对应源码。禁止任意 HTML 脚本。复杂 HTML 表格不会转换为 GFM，合并单元格不在 GFM 工具菜单里；检测到无法序列化的 rowspan/colspan 拒绝编辑。

引用定义原文不会丢失。引用链接可在 Live 作为普通链接编辑；修改该段落时允许改写为等价的行内链接，原引用定义保留。未修改段落的引用语法完全不变。

## 明确保真边界

- 保证未修改的顶层块和未修改普通表格单元格原文不变；**不承诺被编辑的整个段落/列表/引用子树内部每一个原始标记都保留**。修改这些块可规范化该块内的强调、链接、转义、列表间距等。复杂结构操作允许改写受影响子树。
- 源码修改/Undo 时需重新解析 PM；不是对任意 Markdown 扩展的完美 AST 等价保证。未知/不能安全解析的块优先受保护原文。
- 跨模式光标使用块来源和文本匹配近似映射；代码块单独扣除围栏偏移。进入 Markdown 标记内部、重复/转义文字和复杂嵌套时不承诺字符级互逆。Live 多 Pane 同步使用 PM Steps，接收选区独立映射。
- IME 组合期间拒绝模式切换/保存/关闭，不强制销毁；完成后重试。合成事件只能检验 guard，真实 Windows 输入法仍待人工。
- 预算用 UTF-16 字符，不把它说成磁盘字节。混合换行、传统编码、原位安全保存和冲突保护继续由既有基础层处理；本轮原生新增证据主要是 UTF-8 BOM/CRLF，其他编码由完整 Rust 回归覆盖。

## 验证

`tests/markdown-wysiwyg.test.ts`：13 项包含 no-op/三模式 CRLF 原文、真实表格/任务/扩展模型、修改段落后复杂块/Setext/引用定义不变、逐单元格原文、行列结构事务、围栏冲突增长、延迟 commit、重复编辑不累积定义前空白、软/硬换行/数学脚注、相对路径拒绝和设置边界；另覆盖普通/代码单元格反斜杠＋管道符往返，以及语言信息含反引号时选择合法 tilde 围栏。

真实浏览器还覆盖 30 次切模式原文、任务精确 Undo/Redo、Source 剪贴板原文、跨 Pane 与跨模式历史。Windows Tauri 直接比较磁盘 Buffer（含 BOM），验证打开/切模式/保存、正文/表格/代码编辑、共享撤销、图片属性事务、脏关闭和外部版本冲突。证据路径见 `Markdown所见即所得验收报告.md`。
