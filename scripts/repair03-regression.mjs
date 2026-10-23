// Repair 03: native DOCX completeness.
//
// The generated package is unzipped here and every part is validated: OOXML
// well-formedness, relationships, numbering definitions, embedded media and
// the fact that no body text was dropped.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'

const server = await createServer({
  server: { host: '127.0.0.1', port: 1467, strictPort: true, hmr: false, watch: null }
})
const { exportMarkdownToNativeDocx, createZipArchive } = await server.ssrLoadModule('./src/features/document-conversion/nativeDocxExport.ts')

/** Minimal store-only ZIP reader: enough to inspect our own package. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = new Map()
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true)
    if (signature !== 0x04034b50) break
    const compressed = view.getUint32(offset + 18, true)
    const uncompressed = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const start = offset + 30 + nameLength + extraLength
    entries.set(name, { bytes: bytes.subarray(start, start + uncompressed), compressed, uncompressed })
    offset = start + compressed
  }
  return entries
}

const text = key => new TextDecoder('utf-8').decode(key.bytes)

const results = []
const test = async (name, run) => {
  await run()
  results.push(name)
  console.log('PASS ' + name)
}

const markdown = [
  '# 文档总标题',
  '',
  '正文包含 **粗体**、*斜体*、~~删除线~~ 与 `行内代码`，以及 [超链接](https://example.com/path?id=1)。',
  '',
  '## 二级标题',
  '',
  '> [!WARNING]',
  '> 这是一条警告提示。',
  '',
  '- 无序第一项',
  '- 无序第二项',
  '',
  '1. 有序第一步',
  '2. 有序第二步',
  '',
  '```javascript',
  'const answer = 42;',
  '```',
  '',
  '| 参数 | 说明 |',
  '| --- | --- |',
  '| 质量 | 导出质量 |',
  '',
  '![示例图片](./pixel.png)',
  '',
  '[toc]',
  '',
  '脚注引用[^n]。',
  '',
  '[^n]: 脚注定义正文。',
  '',
  '$$',
  'x^2 + y^2',
  '$$',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  '',
  '中文与特殊字符：<&>"\' 以及 emoji 🙂',
].join('\n')

const png = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

let result
try {
  result = await exportMarkdownToNativeDocx(markdown, {
    title: '专业导出',
    resolveImage: async source => (source.includes('pixel') ? { data: png, alt: '示例图片' } : null),
  })

  await test('1. the package contains every required OOXML part', async () => {
    const entries = unzip(result.bytes)
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/numbering.xml',
      'word/media/image1.png',
    ]) {
      assert.ok(entries.has(part), `missing part: ${part}`)
    }
  })

  await test('2. every XML part is well-formed and content types are honest', async () => {
    const entries = unzip(result.bytes)
    for (const [name, entry] of entries) {
      if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue
      const xml = text(entry)
      assert.ok(xml.startsWith('<?xml'), `${name} must be an XML document`)
      // Well-formedness: every tag opened is closed in order, no stray `<`.
      const stack = []
      for (const match of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"<]*")*)\s*(\/?)>/g)) {
        if (match[4] === '/') continue
        if (match[1] === '/') {
          assert.equal(stack.pop(), match[2], `${name}: closing </${match[2]}> does not match`)
        } else stack.push(match[2])
      }
      assert.deepEqual(stack, [], `${name}: unclosed elements`)
      assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')), `${name}: raw ampersand`)
    }
    const types = text(entries.get('[Content_Types].xml'))
    assert.ok(types.includes('wordprocessingml.numbering+xml'), 'numbering part is declared')
    assert.ok(types.includes('image/png'), 'png extension is declared')
  })

  await test('3. hyperlinks use real relationships with external targets', async () => {
    const entries = unzip(result.bytes)
    const rels = text(entries.get('word/_rels/document.xml.rels'))
    assert.ok(/relationships\/hyperlink/.test(rels), 'hyperlink relationship exists')
    assert.ok(rels.includes('https://example.com/path?id=1'), 'the exact target is preserved')
    assert.ok(rels.includes('TargetMode="External"'), 'external mode is set')
    const document = text(entries.get('word/document.xml'))
    const id = /Id="(rIdLink\d+)"/.exec(rels)?.[1]
    assert.ok(id && document.includes(`r:id="${id}"`), 'the body references the relationship')
  })

  await test('4. lists are real Word numbering, not literal bullets', async () => {
    const entries = unzip(result.bytes)
    const numbering = text(entries.get('word/numbering.xml'))
    const document = text(entries.get('word/document.xml'))
    assert.ok(numbering.includes('<w:numFmt w:val="bullet"/>'))
    assert.ok(numbering.includes('<w:numFmt w:val="decimal"/>'))
    assert.ok(/<w:num w:numId="\d+">/.test(numbering), 'num instances exist')
    assert.ok(document.includes('<w:numPr>'), 'paragraphs carry numbering properties')
    assert.ok(document.includes('<w:ilvl w:val="0"/>'))
  })

  await test('5. the image is embedded as media and referenced by a drawing', async () => {
    const entries = unzip(result.bytes)
    const media = entries.get('word/media/image1.png')
    assert.ok(media && media.bytes.length === png.length, 'media bytes are stored verbatim')
    assert.equal(media.bytes[0], 0x89)
    const rels = text(entries.get('word/_rels/document.xml.rels'))
    assert.ok(rels.includes('Target="media/image1.png"'))
    const document = text(entries.get('word/document.xml'))
    assert.ok(document.includes('<w:drawing>'), 'a drawing element is present')
    assert.ok(/r:embed="rIdImgimage1\.png"/.test(document), 'the drawing references the image relationship')
  })

  await test('6. tables and code blocks stay real Word content', async () => {
    const document = text(unzip(result.bytes).get('word/document.xml'))
    assert.ok(document.includes('<w:tbl>'))
    assert.ok(document.includes('<w:tc>'))
    assert.ok(document.includes('参数') && document.includes('导出质量'))
    assert.ok(document.includes('const answer = 42;'), 'code block text is present')
    assert.ok(document.includes('Consolas'), 'code uses a monospace run')
  })

  await test('7. headings keep their outline level and a bookmark for navigation', async () => {
    const document = text(unzip(result.bytes).get('word/document.xml'))
    const styles = text(unzip(result.bytes).get('word/styles.xml'))
    assert.ok(document.includes('w:val="Heading1"'))
    assert.ok(document.includes('w:val="Heading2"'))
    assert.ok(styles.includes('<w:outlineLvl w:val="0"/>'), 'heading 1 maps to outline level 0')
    assert.ok(document.includes('<w:bookmarkStart'), 'headings can be linked to')
  })

  await test('8. callouts, footnotes and TOC have explicit, documented representations', async () => {
    const document = text(unzip(result.bytes).get('word/document.xml'))
    assert.ok(document.includes('WARNING'), 'callout title is kept')
    assert.ok(document.includes('这是一条警告提示。'), 'callout body is kept')
    assert.ok(document.includes('脚注'), 'a footnote section exists')
    assert.ok(document.includes('脚注定义正文。'), 'footnote text is not dropped')
    assert.ok(document.includes('目录'), 'a table of contents block exists')
    const kinds = new Set(result.warnings.map(warning => warning.kind))
    assert.ok(kinds.has('toc'), 'the TOC limitation is reported')
    assert.ok(kinds.has('footnote'), 'the footnote representation is reported')
    assert.ok(kinds.has('math'), 'LaTeX fallback is reported')
    assert.ok(kinds.has('diagram'), 'Mermaid fallback is reported')
  })

  await test('9. no body text is lost and XML escapes are correct', async () => {
    const document = text(unzip(result.bytes).get('word/document.xml'))
    assert.ok(document.includes('文档总标题'))
    assert.ok(document.includes('粗体') && document.includes('斜体') && document.includes('删除线'))
    assert.ok(document.includes('行内代码'))
    assert.ok(document.includes('emoji'))
    assert.ok(document.includes('&lt;&amp;&gt;'), 'special characters are escaped, not dropped')
    assert.ok(!/[\u0000-\u0008]/.test(document), 'no control characters leak into XML')
    assert.equal(result.stats.tables, 1)
    assert.ok(result.stats.lists >= 2)
    assert.ok(result.stats.hyperlinks >= 1)
    assert.equal(result.stats.images, 1)
    assert.ok(result.stats.footnotes >= 1)
  })

  await test('10. a physical artifact opens as a valid ZIP and can be re-read', async () => {
    const artifact = 'test-results/native-export-repair03.docx'
    fs.writeFileSync(artifact, result.bytes)
    const stat = fs.statSync(artifact)
    assert.ok(stat.size > 2000)
    const reread = unzip(new Uint8Array(fs.readFileSync(artifact)))
    assert.equal(reread.size, unzip(result.bytes).size)
  })

  await test('11. an aborted export fails instead of writing a partial document', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => exportMarkdownToNativeDocx('# 标题\n\n正文', { signal: controller.signal }),
      /取消/,
    )
  })

  await test('12. oversized media is refused with a warning, not silently dropped', async () => {
    const big = await exportMarkdownToNativeDocx('![大图](./big.png)', {
      mediaBudgetBytes: 8,
      resolveImage: async () => ({ data: png, alt: '大图' }),
    })
    assert.ok(big.warnings.some(warning => warning.kind === 'image'))
    assert.equal(big.stats.images, 0)
    assert.ok(!unzip(big.bytes).has('word/media/image1.png'))
  })
  await test('13. schema validator negative control removes the required table grid from an otherwise real package',async()=>{
    const entries=unzip(result.bytes),files={}
    for(const [name,entry] of entries)files[name]=entry.bytes
    const document=text(entries.get('word/document.xml'))
    assert(document.includes('<w:tblGrid>'))
    files['word/document.xml']=document.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/,'')
    fs.writeFileSync('test-results/native-export-invalid-schema.docx',createZipArchive(files))
  })
} finally {
  await server.close()
}

console.log('========================================')
console.log(`All ${results.length} Repair 03 checks passed!`)
console.log('========================================')
