import fs from 'node:fs'

const objects = []

function addObject(content) {
  const num = objects.length + 1
  objects.push({ num, content })
  return num
}

// 1: Catalog
const catNum = addObject('<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R >>')

// 2: Pages (forward ref, updated below)
const pagesNum = addObject('')

// 3: Outlines
const outlinesNum = addObject('<< /Type /Outlines /First 4 0 R /Last 5 0 R /Count 3 >>')

// 4: Chapter 1 (has sub-item Section 1.1)
const ch1Num = addObject('<< /Title (Chapter 1) /Parent 3 0 R /Next 5 0 R /First 6 0 R /Last 6 0 R /Count 1 /Dest [ 7 0 R /XYZ 0 750 null ] >>')

// 5: Chapter 2
const ch2Num = addObject('<< /Title (Chapter 2) /Parent 3 0 R /Prev 4 0 R /Dest [ 9 0 R /XYZ 0 650 null ] >>')

// 6: Section 1.1 (child of Chapter 1)
const sec11Num = addObject('<< /Title (Section 1.1) /Parent 4 0 R /Dest [ 8 0 R /XYZ 0 700 null ] >>')

// 7, 8, 9, 10: Page 1, Page 2, Page 3, Page 4
const p1Num = addObject('<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 612 792 ] /Contents 11 0 R /Resources << /Font << /F1 15 0 R >> >> >>')
const p2Num = addObject('<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 612 792 ] /Contents 12 0 R /Resources << /Font << /F1 15 0 R >> >> >>')
const p3Num = addObject('<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 612 792 ] /Contents 13 0 R /Resources << /Font << /F1 15 0 R >> >> >>')
const p4Num = addObject('<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 612 792 ] /Contents 14 0 R /Resources << /Font << /F1 15 0 R >> >> >>')

// Update Pages content
objects[1].content = `<< /Type /Pages /Kids [ ${p1Num} 0 R ${p2Num} 0 R ${p3Num} 0 R ${p4Num} 0 R ] /Count 4 >>`

// 11, 12, 13, 14: Contents
const s1 = 'BT /F1 24 Tf 72 710 Td (Page 1 - Chapter 1 Content) Tj ET'
const s2 = 'BT /F1 24 Tf 72 710 Td (Page 2 - Section 1.1 Content) Tj ET'
const s3 = 'BT /F1 24 Tf 72 710 Td (Page 3 - Chapter 2 Content) Tj ET'
const s4 = 'BT /F1 24 Tf 72 710 Td (Page 4 - Unreferenced Page Content) Tj ET'

addObject(`<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`)
addObject(`<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`)
addObject(`<< /Length ${s3.length} >>\nstream\n${s3}\nendstream`)
addObject(`<< /Length ${s4.length} >>\nstream\n${s4}\nendstream`)

// 15: Font
addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

let offset = 0
let body = '%PDF-1.4\n'
offset += Buffer.byteLength(body, 'utf8')

const offsets = [0]
for (let i = 0; i < objects.length; i++) {
  offsets.push(offset)
  const objStr = `${i + 1} 0 obj\n${objects[i].content}\nendobj\n`
  body += objStr
  offset += Buffer.byteLength(objStr, 'utf8')
}

const xrefStart = offset
body += `xref\n0 ${objects.length + 1}\n`
body += '0000000000 65535 f \n'
for (let i = 1; i <= objects.length; i++) {
  body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
}
body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

fs.mkdirSync('.markumo-media-test/fixtures', { recursive: true })
fs.writeFileSync('.markumo-media-test/fixtures/bookmark.pdf', body)
console.log('Successfully generated .markumo-media-test/fixtures/bookmark.pdf, bytes:', Buffer.byteLength(body, 'utf8'))
