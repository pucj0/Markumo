# HTML 所见即所得与原位编辑综合验收

## 1. 标题与段落 (h1-h6, p, div)
<h1>一级标题 H1</h1>
<h2>二级标题 H2</h2>
<h3>三级标题 H3</h3>
<h4>四级标题 H4</h4>
<h5>五级标题 H5</h5>
<h6>六级标题 H6</h6>

<p>这是一个原生的 HTML 段落文本。</p>
<div>这是一个纯 HTML div 容器包裹的内容。</div>

## 2. 文本格式与样式 (span color, strong, em, u, mark, kbd)
这是 <span style="color: red; font-weight: bold;">红色加粗文字</span>，这是 <span style="background-color: yellow; color: black;">黄色高亮文字</span>。

<strong>Strong 粗体</strong>、<b>Bold 粗体</b>、<em>Em 斜体</em>、<i>Italic 斜体</i>。

<u>Underline 下划线</u>、<del>删除线 del</del>、<s>删除线 s</s>、<mark>Mark 标记</mark>、<small>小号文字</small>。

按键展示：<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> 打开命令面板。

化学分子式：H<sub>2</sub>O，数学幂次：E = mc<sup>2</sup>。

注音展示：<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>。

## 3. 分隔线与换行
第一行内容<br>第二行紧接着第一行换行显示。

<hr>

## 4. 详情折叠 (details & summary)
<details>
<summary>点击展开查看折叠内容</summary>
<p>这里是折叠在内部的详细说明文本。</p>
</details>

## 5. HTML 表格与合并单元格 (colspan / rowspan)
<table>
  <thead>
    <tr>
      <th colspan="2">人员基本信息</th>
      <th rowspan="2">岗位职责</th>
    </tr>
    <tr>
      <th>姓名</th>
      <th>部门</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>张三</td>
      <td>研发部</td>
      <td rowspan="2">核心业务开发与架构设计</td>
    </tr>
    <tr>
      <td>李四</td>
      <td>测试部</td>
    </tr>
  </tbody>
</table>

## 6. HTML 图片 (相对路径、绝对路径、尺寸与空尺寸属性)
<img src="visual.assets/image-20261016123004763.png" alt="本地示例图片" width="">

<img src="./assets/demo.png" alt="带有指定宽度的图片" width="300">

## 7. HTML 代码围栏（不应被渲染为富文本，应保持源码高亮）
```html
<div class="code-fence">
  <p>这段代码是在 Markdown 围栏内部，绝不能被执行或渲染！</p>
</div>
```

## 8. 安全防护测试 (恶意脚本与事件属性攻击)
<script>alert("XSS Attack!")</script>
<img src="invalid.png" onerror="alert(1)">
<a href="javascript:alert('malicious')">恶意链接</a>
<iframe src="https://example.com"></iframe>

## 9. HTML 注释与实体
<!-- 这是 HTML 内部注释，不应破坏文档 -->
&copy; 2026 LightEdit &amp; &lt;Safe Markdown&gt;
