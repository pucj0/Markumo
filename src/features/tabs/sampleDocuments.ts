import type { DocumentSeed } from '../../editor/core/DocumentManager'

export const sampleDocuments: DocumentSeed[] = [
  {
    id: 'rust-doc',
    name: 'main.rs',
    path: 'src/main.rs',
    text: `use std::path::PathBuf;\nuse tauri::Manager;\n\nmod commands;\nmod workspace;\n\nfn main() {\n    tauri::Builder::default()\n        .setup(|app| {\n            let window = app.get_webview_window("main").unwrap();\n            println!("Markumo is ready: {:?}", window.label());\n            Ok(())\n        })\n        .invoke_handler(tauri::generate_handler![\n            commands::open_file,\n            commands::save_file,\n        ])\n        .run(tauri::generate_context!())\n        .expect("error while running Markumo");\n}\n`,
    pinned: true,
  },
  {
    id: 'ts-doc',
    name: 'EditorView.ts',
    path: 'src/editor/EditorView.ts',
    text: `import { EditorState, Compartment } from '@codemirror/state'\nimport { EditorView } from '@codemirror/view'\nimport { basicSetup } from 'codemirror'\n\nexport function createEditor(container: HTMLElement, source: string) {\n  const language = new Compartment()\n  const state = EditorState.create({\n    doc: source,\n    extensions: [\n      basicSetup,\n      language.of([]),\n      EditorView.lineWrapping,\n    ],\n  })\n\n  return new EditorView({ state, parent: container })\n}\n`,
    pinned: true,
  },
  {
    id: 'json-doc',
    name: 'settings.json',
    path: 'config/settings.json',
    text: `{\n  "editor": {\n    "fontSize": 13,\n    "tabSize": 2,\n    "lineNumbers": true,\n    "wordWrap": false\n  },\n  "markdown": {\n    "defaultMode": "live",\n    "showSourceOnCursor": true\n  }\n}\n`,
    pinned: true,
  },
  {
    id: 'txt-doc',
    name: 'today.txt',
    path: 'notes/today.txt',
    text: `工作笔记 · 2026-10-13\n\n1. 设计轻量文本编辑器：单文件与工作区并重。\n2. 全部文件统一由 CodeMirror 6 编辑。\n3. Markdown 默认即时排版，其他文件不显示 Markdown 工具栏。\n4. 后端使用 Rust + Tauri 2 管理本地文件。\n\n任何文本，打开就能写。\n`,
    pinned: true,
  },
  {
    id: 'readme-doc',
    name: 'README.md',
    path: 'README.md',
    text: `# Markumo\n\n轻量、顺手、面向**所有文本**的桌面编辑器。\n兼顾 Fleet 的工作区体验和 Typora 的 Markdown 即时排版。\n\n## 核心特性\n\n- **纯文本**：打开 \`.txt\`、日志、CSV 和无扩展名文件。\n- **代码编辑**：TypeScript、Rust、Go、Python、JSON 等高亮与折叠。\n- **Markdown 即时排版**：同一编辑器里展示排版，光标进入即编辑。\n`,
    pinned: false,
  }
]
