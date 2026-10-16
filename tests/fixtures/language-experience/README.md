# LightEdit 语言与局部源码验收

普通段落 **加粗中文**、*斜体文字*、~~删除线~~ 和 `inline code`。

### H3 当前标题

[中文 English 链接](https://example.com/old) 以及 [另一个链接](https://example.org/untouched "保留标题")。

![LightEdit 图片](./logo.png)

| 项目 | 值 |
| :--- | ---: |
| 中文 | **保留** |

```java extra-info
// Java 中文
public class Hello {
    private int count = 42;
    public static void main(String[] args) {
        System.out.println("Hello LightEdit");
    }
}
```

```bash
# Shell 中文
export NODE_ENV=production
count=42
echo "Hello LightEdit"
if [ "$count" -gt 1 ]; then npm install; fi
```

```javascript
// JavaScript 中文
const name = "LightEdit";
const count = 42;
function greet(value) { return value + name; }
console.log(greet(count));
```

```sql
-- SQL 中文
SELECT id, name FROM users WHERE status = 42 AND name = 'LightEdit';
```

### 代码块之后的标题

这一段用于验证语言菜单不遮挡代码，也不与标题重叠。
