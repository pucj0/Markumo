---
title: LightEdit 原位写作验收
tags: [中文, English]
---

# Markdown 写作

这是一份中文 English 😀 综合文档。**粗体**、*斜体*、~~删除线~~ 与 `inline code`。

## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题

[链接文字](https://example.com) 与 https://example.com 以及 [引用链接][ref]。

- 普通列表
  - 嵌套项目
- [ ] 待完成
- [x] 已完成

1. 第一项
2. 第二项

> 引用 **加粗**
>
> > 多级引用

| 中文列 | 格式列 | 空列 |
| :--- | :---: | ---: |
| 内容 | **粗体** 与 [链接](https://example.com) | |
| 管道符 \| | `a\|b` | 空 |

~~~~javascript extra-info
const greeting = '中文';
console.log(greeting);
~~~~

```python
print('Hello')
```

![本地图片](./assets/pixel.png)

![受控网络图片](https://example.com/pixel.png)

---

脚注示例[^note]，公式 $E=mc^2$。

[^note]: 保留原始脚注内容。

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$

```mermaid
graph LR
  A[开始] --> B[结束]
```

> [!NOTE]
> 这是保留源码的 Callout。

[toc]

<table><tr><td colspan="2">复杂 HTML 不转换</td></tr></table>

:::unknown-extension
未知扩展原文
:::

[ref]: https://example.com "引用标题"
