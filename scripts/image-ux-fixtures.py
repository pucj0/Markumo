"""Create an independent image UX workspace. Requires Pillow; never overwrites a directory.

Usage: python scripts/image-ux-fixtures.py [new-output-directory]
Without an argument, creates a new directory under the system temporary folder.
"""
from pathlib import Path
import sys
import tempfile
from PIL import Image, ImageDraw

if len(sys.argv) > 1:
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=False)
else:
    root = Path(tempfile.mkdtemp(prefix="markumo-image-ux-"))
(root / "images").mkdir()
for name, size in [("test", (320, 180)), ("tiny", (24, 24)),
                   ("large", (6000, 4000)), ("tall", (600, 6000)),
                   ("中文 图片", (320, 180))]:
    image = Image.new("RGB", size, "#347ba6")
    draw = ImageDraw.Draw(image)
    draw.rectangle((5, 5, size[0] - 6, size[1] - 6), outline="orange", width=4)
    draw.text((12, 12), f"{name} {size}", fill="white")
    image.save(root / "images" / f"{name}.png")
image = Image.open(root / "images/test.png")
for ext in ["jpg", "gif", "webp"]:
    image.save(root / "images" / f"test.{ext}")
(root / "images/corrupt.png").write_bytes(b"not an image")
document = """# 图片 UX 审计

正文 BEFORE

![普通](./images/test.png "标题")

正文 AFTER

![小图](./images/tiny.png) ![连续](./images/test.png)

前文 ![行内](./images/test.png) 后文

<img src="./images/test.png" alt="HTML 测试" width="160" />

<img src="./images/test.png" alt="普通 HTML" />

![不存在](./images/missing.png)

![空路径]()

![中文 空格](<./images/中文 图片.png>)

| 图片 | 文字 |
| --- | --- |
| ![表格](./images/test.png) | 单元格 |

- 列表 ![列表](./images/test.jpg)

> 引用 ![引用](./images/test.gif)

![WebP](./images/test.webp)

![网络待确认](https://example.com/markumo-image-ux-test.png)

![损坏](./images/corrupt.png)

![大图](./images/large.png)

![长图](./images/tall.png)

文末 END
"""
for name in ["audit.md", "typora.md"]:
    (root / name).write_text(document, encoding="utf-8")
(root / "insert.md").write_text("", encoding="utf-8")
print(root)
