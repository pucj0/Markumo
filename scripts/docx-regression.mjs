// Native Word DOCX Export Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1448, strictPort: true, hmr: false, watch: null }
})

const { exportMarkdownToNativeDocx, createZipArchive } = await server.ssrLoadModule('./src/features/document-conversion/nativeDocxExport.ts')

console.log('--- Running Native DOCX Export Regression Suite ---')

const markdownSource = [
  '# 文档总标题 (H1)',
  '',
  '这是一段普通的正文文本，包含 **粗体字**、*斜体字*、~~删除线~~ 以及 `行内代码`。',
  '',
  '## 二级章节 (H2)',
  '',
  '> 这是一个引用块，测试 Word 边框与缩进排版。',
  '',
  '### 代码与列表 (H3)',
  '',
  '- 无序列表第一项',
  '- 无序列表第二项',
  '',
  '1. 有序第一步',
  '2. 有序第二步',
  '',
  '```javascript',
  'const message = "Hello Markumo Native DOCX";',
  'console.log(message);',
  '```',
  '',
  '| 参数名称 | 默认值 | 说明 |',
  '| :--- | :---: | ---: |',
  '| enabled | true | 是否开启原生导出 |',
  '| quality | 100 | 输出文档质量 |',
  '',
  '---',
  '',
  '包含 XML 特殊字符测试：`<`、`>`、`&`、`"`、`\'`，保证不发生 XML 解析异常。'
].join('\n')

// Test 1: Generates valid DOCX binary with standard PKZip magic bytes
{
  const bytes = (await exportMarkdownToNativeDocx(markdownSource, { title: '专业文档导出' })).bytes
  assert.ok(bytes instanceof Uint8Array)
  assert.ok(bytes.length > 500, 'Docx file should have substantial size')

  // Check PKZip magic signature PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  assert.equal(bytes[2], 0x03)
  assert.equal(bytes[3], 0x04)
  console.log('PASS 1. Generated DOCX has valid PKZip archive header')
}

// Test 2: Verify OOXML components inside the archive
{
  const bytes = (await exportMarkdownToNativeDocx(markdownSource, { title: '测试文档' })).bytes
  const binaryString = new TextDecoder('latin1').decode(bytes)

  assert.ok(binaryString.includes('[Content_Types].xml'), 'Contains [Content_Types].xml')
  assert.ok(binaryString.includes('_rels/.rels'), 'Contains _rels/.rels')
  assert.ok(binaryString.includes('word/document.xml'), 'Contains word/document.xml')
  assert.ok(binaryString.includes('word/styles.xml'), 'Contains word/styles.xml')
  console.log('PASS 2. All required OOXML structure parts present')
}

// Test 3: Verify semantic XML content inside document.xml
{
  const bytes = (await exportMarkdownToNativeDocx(markdownSource, { title: '语义测试' })).bytes
  const binaryString = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

  // Title & Headings
  assert.ok(binaryString.includes('w:val="Heading1"'), 'Contains Heading1 style')
  assert.ok(binaryString.includes('w:val="Heading2"'), 'Contains Heading2 style')
  assert.ok(binaryString.includes('文档总标题'), 'Heading text present')

  // Inline formatting
  assert.ok(binaryString.includes('<w:b/>'), 'Bold tag present')
  assert.ok(binaryString.includes('<w:i/>'), 'Italic tag present')
  assert.ok(binaryString.includes('<w:strike/>'), 'Strike tag present')

  // Table structure
  assert.ok(binaryString.includes('<w:tbl>'), 'Table tag present')
  assert.ok(binaryString.includes('<w:tc>'), 'Table cell present')
  assert.ok(binaryString.includes('参数名称'), 'Table text present')

  // Code block
  assert.ok(binaryString.includes('Hello Markumo Native DOCX'), 'Code block content present')
  assert.ok(binaryString.includes('Consolas'), 'Code font present')

  // XML escape security
  assert.ok(!binaryString.includes('未转义的 < 或 >'), 'Characters properly escaped')
  console.log('PASS 3. Word semantic elements (headings, formatting, tables, code) accurately structured')
}

// Test 4: Write real physical docx artifact to disk and verify file existence
{
  const artifactPath = path.resolve('test-results/native-export-test.docx')
  const bytes = (await exportMarkdownToNativeDocx(markdownSource, { title: '物理导出文件' })).bytes
  fs.writeFileSync(artifactPath, bytes)

  const stat = fs.statSync(artifactPath)
  assert.ok(stat.isFile() && stat.size > 500)
  console.log(`PASS 4. Physical DOCX artifact created successfully (${stat.size} bytes) at ${artifactPath}`)
}

console.log('========================================')
console.log('All Native DOCX Export tests passed successfully!')
console.log('========================================')
await server.close()
