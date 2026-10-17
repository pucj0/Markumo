"""Generate local, non-sensitive viewer regression fixtures. Requires Pillow, reportlab, pypdf.
Run with the bundled Python: python scripts/media-fixtures.py .markumo-media-test/fixtures
Encrypted PDF password: markumo-test
"""
from pathlib import Path
import sys
from PIL import Image, ImageDraw
from reportlab.pdfgen.canvas import Canvas
from pypdf import PdfWriter

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".markumo-media-test/fixtures")
root.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (1200, 800), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rectangle((100, 100, 1100, 700), fill=(50, 130, 220, 160))
draw.text((350, 350), "Markumo transparent image", fill="white", font_size=32)
image.save(root / "transparent.png")
for ext in ("jpg", "bmp", "webp"):
    image.convert("RGB").save(root / f"sample.{ext}")
image.save(root / "sample.avif")
icon = image.resize((256, 256))
icon.save(root / "sample.ico", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
cursor = bytearray((root / "sample.ico").read_bytes())
cursor[2:4] = (2).to_bytes(2,"little")
for n in range(int.from_bytes(cursor[4:6],"little")):
    cursor[6+n*16+4:6+n*16+8] = bytes(4)
(root / "sample.cur").write_bytes(cursor)
(root / "sample.jfif").write_bytes((root / "sample.jpg").read_bytes())
frames = [Image.new("RGB", (240, 160), c) for c in ("red", "blue", "green")]
frames[0].save(root / "animated.gif", save_all=True, append_images=frames[1:], duration=250, loop=0)
frames[0].save(root / "animated.apng", format="PNG", save_all=True, append_images=frames[1:], duration=250, loop=0)
image.save(root / "wrong-extension.txt", format="PNG")
Image.new("RGB", (10000, 10000), "white").save(root / "over-budget.png")
(root / "corrupt.png").write_bytes(b"\x89PNG\r\n\x1a\nbroken")
(root / "safe.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><script>alert("UNSAFE")</script><rect width="400" height="300" fill="teal"/><text x="40" y="150" fill="white">SVG image context</text></svg>', encoding="utf-8")
for name, pages in (("single.pdf", 1), ("long.pdf", 550)):
    c = Canvas(str(root / name))
    for n in range(1, pages + 1):
        c.drawString(72, 720, f"Markumo PDF fixture page {n}")
        c.drawString(72, 690, "Search needle: preview lifecycle")
        c.showPage()
    c.save()
c = Canvas(str(root / "mixed.pdf"))
for n, size in enumerate([(595,842),(842,595),(420,595),(595,842)],1):
    c.setPageSize(size)
    c.drawString(60,size[1]-80,f"Mixed size page {n}")
    c.drawString(60,size[1]-110,"Selection and rotation fixture")
    c.showPage()
c.save()
writer = PdfWriter()
writer.append(str(root / "single.pdf"))
writer.encrypt("markumo-test")
with (root / "encrypted.pdf").open("wb") as f:
    writer.write(f)
# Valid PDF with an unused stream >16 MiB: size must not route it through the text reader.
from pypdf.generic import DecodedStreamObject, NameObject
writer = PdfWriter()
writer.append(str(root / "single.pdf"))
stream = DecodedStreamObject()
stream.set_data(b"X" * (20 * 1024 * 1024))
writer._root_object[NameObject("/MarkumoFixture")] = writer._add_object(stream)
with (root / "large.pdf").open("wb") as f:
    writer.write(f)
(root / "notes.md").write_text("# Viewer regression\n\nText **editing** and undo must remain intact.\n", encoding="utf-8")
(root / "sample.txt").write_text("Plain text regression fixture\n", encoding="utf-8")
print(f"Generated fixtures in {root.resolve()}")
