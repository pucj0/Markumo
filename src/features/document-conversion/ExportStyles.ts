import type { PdfOptions } from './contracts'

export function getHighlightCss(): string {
  return `
/* Syntax highlighting */
.tok-keyword { color: #d73a49; font-weight: 600; }
.tok-string { color: #032f62; }
.tok-comment { color: #6a737d; font-style: italic; }
.tok-variableName { color: #24292e; }
.tok-propertyName { color: #005cc5; }
.tok-number { color: #005cc5; }
.tok-operator { color: #d73a49; }
.tok-punctuation { color: #24292e; }
.tok-typeName { color: #6f42c1; }
.tok-definition { color: #24292e; font-weight: 600; }
.tok-tag { color: #22863a; }
.tok-attributeName { color: #6f42c1; }
`
}

export function getDocumentCss(codeWrap = true): string {
  return `
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
  --text: #24292e;
  --bg: #ffffff;
  --border: #e1e4e8;
  --code-bg: #f6f8fa;
  --quote-text: #6a737d;
  --table-border: #dfe2e5;
  --accent: #0366d6;
}

body {
  margin: 0;
  padding: 40px;
  color: var(--text);
  background: var(--bg);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.markumo-document {
  max-width: 860px;
  margin: 0 auto;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
  color: #1a1a1a;
}

h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: var(--quote-text); }

p, blockquote, ul, ol, dl, table, pre {
  margin-top: 0;
  margin-bottom: 16px;
}

hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: var(--border);
  border: 0;
}

blockquote {
  padding: 0 1em;
  color: var(--quote-text);
  border-left: 0.25em solid #dfe2e5;
  margin-left: 0;
  margin-right: 0;
}

ul, ol {
  padding-left: 2em;
}

li + li {
  margin-top: 0.25em;
}

li input[type="checkbox"] {
  margin: 0 0.2em 0.25em -1.4em;
  vertical-align: middle;
}

code {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: var(--code-bg);
  border-radius: 3px;
  font-family: var(--font-mono);
}

pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: var(--code-bg);
  border-radius: 6px;
  border: 1px solid var(--border);
}

pre code {
  display: inline;
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
  font-size: 100%;
  white-space: ${codeWrap ? 'pre-wrap' : 'pre'};
  word-break: ${codeWrap ? 'break-all' : 'normal'};
}

table {
  border-spacing: 0;
  border-collapse: collapse;
  width: 100%;
  overflow: auto;
  margin-bottom: 16px;
}

table th, table td {
  padding: 6px 13px;
  border: 1px solid var(--table-border);
}

table tr {
  background-color: #fff;
  border-top: 1px solid #c6cbd1;
}

table tr:nth-child(2n) {
  background-color: var(--code-bg);
}

table th {
  font-weight: 600;
  background-color: var(--code-bg);
}

img {
  max-width: 100%;
  box-sizing: border-box;
  vertical-align: middle;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

/* KaTeX formula centering */
.katex-display {
  margin: 1em 0;
  text-align: center;
}

${getHighlightCss()}
`
}

export function getPrintCss(pdfOptions?: PdfOptions): string {
  const paper = pdfOptions?.paperSize === 'Letter' ? 'letter' : 'a4'
  const orientation = pdfOptions?.orientation === 'landscape' ? 'landscape' : 'portrait'
  const marginSize =
    pdfOptions?.margins === 'compact' ? '12mm' :
    pdfOptions?.margins === 'loose' ? '25mm' : '18mm'

  return `
@page {
  size: ${paper} ${orientation};
  margin: ${marginSize};
}

@media print {
  body {
    padding: 0 !important;
    background: #ffffff !important;
    color: #000000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .markumo-document {
    max-width: 100% !important;
    margin: 0 !important;
  }

  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
    break-after: avoid;
  }

  table, pre, blockquote, img, .katex-display {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  a {
    color: inherit !important;
    text-decoration: none !important;
  }
}
`
}

export function buildCompleteHtml(
  title: string,
  bodyContent: string,
  includeStyles: boolean,
  pdfOptions?: PdfOptions
): string {
  const styleTag = includeStyles
    ? `<style>\n${getDocumentCss(pdfOptions?.codeWrap ?? true)}\n${pdfOptions ? getPrintCss(pdfOptions) : ''}\n</style>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${styleTag}
</head>
<body>
  <article class="markumo-document${includeStyles ? ' styled' : ' plain'}">
    ${bodyContent}
  </article>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
