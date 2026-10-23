# 图片完整交互研究

## 普通图片

![普通](./images/normal.png "标题")

## 图片前后有文字

正文 BEFORE ![行内](./images/normal.png) 正文 AFTER

## 连续图片

![第一张](./images/normal.png)
![第二张](./images/small.png)

## 图片在标题附近

### 标题
![图片](./images/normal.png)
下一段正文

## HTML 图片

<img src="./images/normal.png" alt="HTML 测试" width="160" />

## 空图片路径

![空路径]()

![]()

## 不存在的图片

![不存在](./images/missing.png)

## 中文及空格路径

![中文 空格](<./images/中文 图片.png>)

## 引用

> ![引用图片](./images/normal.png)

## 列表

- 第一项
- ![列表图片](./images/normal.png)

## 表格

| 名称 | 图片 |
| --- | --- |
| 测试 | ![表格图片](./images/small.png) |

## 图片引用定义

![引用图片][logo]

[logo]: ./images/normal.png

## large

![large](./images/large.png)

## tall

![tall](./images/tall.png)

## wide

![wide](./images/wide.png)

## transparent

![transparent](./images/transparent.png)

## animated.gif

![animated.gif](./images/animated.gif)

## photo.jpg

![photo.jpg](./images/photo.jpg)

## sample.webp

![sample.webp](./images/sample.webp)

## sample.svg

![sample.svg](./images/sample.svg)

## corrupt

![corrupt](./images/corrupt.png)

## 不可达网络图片

![网络](http://127.0.0.1:9/missing.png)

文末 END
