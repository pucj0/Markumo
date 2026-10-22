import MarkdownIt from 'markdown-it'

// Simple CRC32 implementation for ZIP generation
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Pure TypeScript ZIP Archive Packer (No external dependencies)
 */
export async function createZipArchive(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const fileEntries: {
    name: Uint8Array
    data: Uint8Array
    crc: number
    compressedSize: number
    uncompressedSize: number
    offset: number
  }[] = []

  const encoder = new TextEncoder()
  const localChunks: Uint8Array[] = []
  let currentOffset = 0

  for (const [path, content] of Object.entries(files)) {
    const rawData = typeof content === 'string' ? encoder.encode(content) : content
    const nameBytes = encoder.encode(path)
    const checksum = crc32(rawData)

    // Local file header: 30 bytes + name length + data length
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(localHeader.buffer)

    view.setUint32(0, 0x04034b50, true) // Local header signature PK\x03\x04
    view.setUint16(4, 20, true) // Version needed (2.0)
    view.setUint16(6, 0, true) // Flags
    view.setUint16(8, 0, true) // Compression (0 = store)
    view.setUint16(10, 0, true) // Mod time
    view.setUint16(12, 0, true) // Mod date
    view.setUint32(14, checksum, true) // CRC-32
    view.setUint32(18, rawData.length, true) // Compressed size
    view.setUint32(22, rawData.length, true) // Uncompressed size
    view.setUint16(26, nameBytes.length, true) // File name length
    view.setUint16(28, 0, true) // Extra field length

    localHeader.set(nameBytes, 30)

    fileEntries.push({
      name: nameBytes,
      data: rawData,
      crc: checksum,
      compressedSize: rawData.length,
      uncompressedSize: rawData.length,
      offset: currentOffset,
    })

    localChunks.push(localHeader)
    localChunks.push(rawData)
    currentOffset += localHeader.length + rawData.length
  }

  // Central Directory
  const centralDirStart = currentOffset
  const centralChunks: Uint8Array[] = []

  for (const entry of fileEntries) {
    const centralHeader = new Uint8Array(46 + entry.name.length)
    const view = new DataView(centralHeader.buffer)

    view.setUint32(0, 0x02014b50, true) // Central directory signature PK\x01\x02
    view.setUint16(4, 20, true) // Version made by
    view.setUint16(6, 20, true) // Version needed
    view.setUint16(8, 0, true) // Flags
    view.setUint16(10, 0, true) // Compression (store)
    view.setUint16(12, 0, true) // Mod time
    view.setUint16(14, 0, true) // Mod date
    view.setUint32(16, entry.crc, true) // CRC-32
    view.setUint32(20, entry.compressedSize, true) // Compressed size
    view.setUint32(24, entry.uncompressedSize, true) // Uncompressed size
    view.setUint16(28, entry.name.length, true) // File name length
    view.setUint16(30, 0, true) // Extra field length
    view.setUint16(32, 0, true) // Comment length
    view.setUint16(34, 0, true) // Disk number start
    view.setUint16(36, 0, true) // Internal file attrs
    view.setUint32(38, 0, true) // External file attrs
    view.setUint32(42, entry.offset, true) // Relative offset of local header

    centralHeader.set(entry.name, 46)
    centralChunks.push(centralHeader)
    currentOffset += centralHeader.length
  }

  const centralDirSize = currentOffset - centralDirStart

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true) // End of central directory signature PK\x05\x06
  eocdView.setUint16(4, 0, true) // Number of this disk
  eocdView.setUint16(6, 0, true) // Disk where central directory starts
  eocdView.setUint16(8, fileEntries.length, true) // Total entries on this disk
  eocdView.setUint16(10, fileEntries.length, true) // Total entries
  eocdView.setUint32(12, centralDirSize, true) // Size of central directory
  eocdView.setUint32(16, centralDirStart, true) // Offset of start of central directory
  eocdView.setUint16(20, 0, true) // ZIP comment length

  // Assemble full ZIP
  const totalLength = currentOffset + eocd.length
  const result = new Uint8Array(totalLength)
  let pos = 0

  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    result.set(chunk, pos)
    pos += chunk.length
  }

  return result
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Native Markdown to Word (.docx) Converter
 */
export async function exportMarkdownToNativeDocx(markdownContent: string, documentTitle?: string): Promise<Uint8Array> {
  const md = new MarkdownIt('commonmark', { html: true, linkify: true }).enable(['table', 'strikethrough', 'linkify'])
  const tokens = md.parse(markdownContent, {})

  let bodyXml = ''

  // Document Title if provided
  if (documentTitle) {
    bodyXml += `<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>${escapeXml(documentTitle)}</w:t></w:r></w:p>`
  }

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'heading_open') {
      const level = Math.min(6, Math.max(1, Number(token.tag.slice(1)) || 1))
      const inlineToken = tokens[i + 1]
      const text = inlineToken?.content || ''
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${Math.max(24, 38 - level * 3)}"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
      i += 3
      continue
    }

    if (token.type === 'paragraph_open') {
      const inlineToken = tokens[i + 1]
      const content = inlineToken?.content || ''

      // Check if it's a [TOC]
      if (/^\[toc\]$/i.test(content.trim())) {
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>目录</w:t></w:r></w:p>`
        i += 3
        continue
      }

      bodyXml += `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>`
      if (inlineToken?.children) {
        let bold = false
        let italic = false
        let strike = false
        for (const child of inlineToken.children) {
          if (child.type === 'strong_open') bold = true
          else if (child.type === 'strong_close') bold = false
          else if (child.type === 'em_open') italic = true
          else if (child.type === 'em_close') italic = false
          else if (child.type === 's_open') strike = true
          else if (child.type === 's_close') strike = false
          else if (child.type === 'code_inline') {
            bodyXml += `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F4F4F5"/></w:rPr><w:t xml:space="preserve"> ${escapeXml(child.content)} </w:t></w:r>`
          } else if (child.type === 'text') {
            let rPr = ''
            if (bold) rPr += '<w:b/>'
            if (italic) rPr += '<w:i/>'
            if (strike) rPr += '<w:strike/>'
            bodyXml += `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(child.content)}</w:t></w:r>`
          }
        }
      } else {
        bodyXml += `<w:r><w:t xml:space="preserve">${escapeXml(content)}</w:t></w:r>`
      }
      bodyXml += `</w:p>`
      i += 3
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      const lines = token.content.split('\n')
      for (const line of lines) {
        bodyXml += `<w:p><w:pPr><w:shd w:val="clear" w:fill="F6F8FA"/><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="240" w:right="240"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t></w:r></w:p>`
      }
      i++
      continue
    }

    if (token.type === 'hr') {
      bodyXml += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="D0D7DE"/></w:pBdr></w:pPr></w:p>`
      i++
      continue
    }

    if (token.type === 'blockquote_open') {
      let j = i + 1
      while (j < tokens.length && tokens[j].type !== 'blockquote_close') {
        if (tokens[j].type === 'inline') {
          const text = tokens[j].content
          bodyXml += `<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="3B82F6"/></w:pBdr><w:ind w:left="240"/><w:shd w:val="clear" w:fill="F8FAFC"/></w:pPr><w:r><w:rPr><w:color w:val="475569"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
        }
        j++
      }
      i = j + 1
      continue
    }

    if (token.type === 'table_open') {
      bodyXml += `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D0D7DE"/><w:left w:val="single" w:sz="4" w:color="D0D7DE"/><w:bottom w:val="single" w:sz="4" w:color="D0D7DE"/><w:right w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideH w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideV w:val="single" w:sz="4" w:color="D0D7DE"/></w:tblBorders></w:tblPr>`
      let j = i + 1
      while (j < tokens.length && tokens[j].type !== 'table_close') {
        if (tokens[j].type === 'tr_open') {
          bodyXml += `<w:tr>`
        } else if (tokens[j].type === 'tr_close') {
          bodyXml += `</w:tr>`
        } else if (tokens[j].type === 'th_open' || tokens[j].type === 'td_open') {
          const isTh = tokens[j].type === 'th_open'
          const inlineText = tokens[j + 1]?.content || ''
          bodyXml += `<w:tc><w:tcPr>${isTh ? '<w:shd w:val="clear" w:fill="F6F8FA"/>' : ''}</w:tcPr><w:p><w:r>${isTh ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(inlineText)}</w:t></w:r></w:p></w:tc>`
          j += 2
        }
        j++
      }
      bodyXml += `</w:tbl>`
      i = j + 1
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const isOrdered = token.type === 'ordered_list_open'
      let count = 1
      let j = i + 1
      while (j < tokens.length && tokens[j].type !== 'bullet_list_close' && tokens[j].type !== 'ordered_list_close') {
        if (tokens[j].type === 'list_item_open') {
          const inline = tokens[j + 2]
          const text = inline?.content || ''
          const bulletPrefix = isOrdered ? `${count++}. ` : '• '
          bodyXml += `<w:p><w:pPr><w:ind w:left="480" w:hanging="240"/></w:pPr><w:r><w:t xml:space="preserve">${bulletPrefix}${escapeXml(text)}</w:t></w:r></w:p>`
        }
        j++
      }
      i = j + 1
      continue
    }

    i++
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="36"/>
      <w:color w:val="1E293B"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="30"/>
      <w:color w:val="334155"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
      <w:b/>
      <w:sz w:val="26"/>
      <w:color w:val="475569"/>
    </w:rPr>
  </w:style>
</w:styles>`

  const files: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': rootRelsXml,
    'word/_rels/document.xml.rels': docRelsXml,
    'word/document.xml': documentXml,
    'word/styles.xml': stylesXml,
  }

  return createZipArchive(files)
}
