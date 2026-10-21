import fs from 'node:fs'

const objects = []

function addObject(content) {
  const num = objects.length + 1
  objects.push({ num, content })
  return num
}

// 1: Catalog
const catNum = addObject('<< /Type /Catalog /Pages 2 0 R /Names 3 0 R >>')

// 2: Pages (placeholder)
const pagesNum = addObject('')

// 3: Names (Dests name tree)
const namesNum = addObject('<< /Dests 4 0 R >>')

// 4: Dests name tree root
const destsNum = addObject('')

// Page object placeholders
const p1Num = 5
const p2Num = 6
const p3Num = 7
const p4Num = 8

// Allocate page numbers
for (let i = 0; i < 4; i++) addObject('')

// Annotations on Page 1
// 9: Link to Page 3
const linkPage3 = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 700 350 725 ] /Dest [ ${p3Num} 0 R /XYZ 0 750 null ] >>`)

// 10: Link to Page 2 at Y=500 (coordinate jump to landscape page)
const linkCoordJump = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 660 350 685 ] /Dest [ ${p2Num} 0 R /XYZ 72 500 null ] >>`)

// 11: Link to Named Destination
const linkNamedDest = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 620 350 645 ] /Dest (named-chapter) >>`)

// 12: External HTTPS link
const linkHttps = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 580 350 605 ] /A << /S /URI /URI (https://example.com/test-page) >> >>`)

// 13: JavaScript action (must be safely ignored/blocked)
const linkJsAction = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 540 350 565 ] /A << /S /JavaScript /JS (app.alert("xss")) >> >>`)

// 14: Unsafe protocol link (javascript: URL)
const linkUnsafeUrl = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 500 350 525 ] /A << /S /URI /URI (javascript:alert(1)) >> >>`)

// 15: Invalid destination
const linkInvalidDest = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 460 350 485 ] /Dest (nonexistent-dest) >>`)

// 16: Named Action NextPage
const linkNextPage = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 420 350 445 ] /A << /S /Named /N /NextPage >> >>`)

// 17: FitR target rectangle destination
const linkFitR = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 380 350 405 ] /Dest [ ${p2Num} 0 R /FitR 72 300 400 500 ] >>`)

// 18: Destination to non-zero CropBox page (Page 4)
const linkCropBox = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 340 350 365 ] /Dest [ ${p4Num} 0 R /XYZ 100 800 null ] >>`)

// 19: Destination with extreme large XYZ zoom (9999x)
const linkLargeZoom = addObject(`<< /Type /Annot /Subtype /Link /Rect [ 72 300 350 325 ] /Dest [ ${p1Num} 0 R /XYZ 72 700 9999 ] >>`)

// Contents placeholders: 20, 21, 22, 23
const c1Num = addObject('')
const c2Num = addObject('')
const c3Num = addObject('')
const c4Num = addObject('')

// 24: Font
const fontNum = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

// Page 1: Portrait [0 0 612 792] with 11 annotations
objects[p1Num - 1].content = `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [ 0 0 612 792 ] /Annots [ ${linkPage3} 0 R ${linkCoordJump} 0 R ${linkNamedDest} 0 R ${linkHttps} 0 R ${linkJsAction} 0 R ${linkUnsafeUrl} 0 R ${linkInvalidDest} 0 R ${linkNextPage} 0 R ${linkFitR} 0 R ${linkCropBox} 0 R ${linkLargeZoom} 0 R ] /Contents ${c1Num} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`

// Page 2: Landscape [0 0 792 612]
objects[p2Num - 1].content = `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [ 0 0 792 612 ] /Contents ${c2Num} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`

// Page 3: Portrait [0 0 612 792] with Rotation 90
objects[p3Num - 1].content = `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [ 0 0 612 792 ] /Rotate 90 /Contents ${c3Num} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`

// Page 4: Portrait with non-zero CropBox [ 50 100 662 892 ]
objects[p4Num - 1].content = `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [ 0 0 712 992 ] /CropBox [ 50 100 662 892 ] /Contents ${c4Num} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`

// Update Pages object
objects[pagesNum - 1].content = `<< /Type /Pages /Kids [ ${p1Num} 0 R ${p2Num} 0 R ${p3Num} 0 R ${p4Num} 0 R ] /Count 4 >>`

// Update Dests object with (named-chapter) -> Page 3 /Fit
objects[destsNum - 1].content = `<< /Names [ (named-chapter) [ ${p3Num} 0 R /Fit ] ] >>`

// Stream contents
const s1 = 'BT /F1 12 Tf 72 710 Td (1. Jump to Page 3) Tj 0 -40 Td (2. Coordinate Jump to Page 2 Y=500) Tj 0 -40 Td (3. Named Destination) Tj 0 -40 Td (4. HTTPS External Link) Tj 0 -40 Td (5. JavaScript Action) Tj 0 -40 Td (6. Unsafe javascript URL) Tj 0 -40 Td (7. Invalid Destination) Tj 0 -40 Td (8. Next Page Action) Tj 0 -40 Td (9. FitR Target Rect) Tj 0 -40 Td (10. Non-zero CropBox) Tj 0 -40 Td (11. Extreme Large Zoom) Tj ET'
const s2 = 'BT /F1 18 Tf 72 500 Td (Page 2 - Landscape Destination Content at Y=500) Tj ET'
const s3 = 'BT /F1 18 Tf 72 710 Td (Page 3 - Rotated 90 Named Destination Target) Tj ET'
const s4 = 'BT /F1 18 Tf 100 800 Td (Page 4 - Non-zero CropBox Content) Tj ET'

objects[c1Num - 1].content = `<< /Length ${Buffer.byteLength(s1, 'utf8')} >>\nstream\n${s1}\nendstream`
objects[c2Num - 1].content = `<< /Length ${Buffer.byteLength(s2, 'utf8')} >>\nstream\n${s2}\nendstream`
objects[c3Num - 1].content = `<< /Length ${Buffer.byteLength(s3, 'utf8')} >>\nstream\n${s3}\nendstream`
objects[c4Num - 1].content = `<< /Length ${Buffer.byteLength(s4, 'utf8')} >>\nstream\n${s4}\nendstream`

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
body += `trailer\n<< /Size ${objects.length + 1} /Root ${catNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

fs.mkdirSync('.markumo-media-test/fixtures', { recursive: true })
fs.writeFileSync('.markumo-media-test/fixtures/links.pdf', body)
console.log('Successfully generated .markumo-media-test/fixtures/links.pdf, bytes:', Buffer.byteLength(body, 'utf8'))
