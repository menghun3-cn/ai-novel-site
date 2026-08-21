/**
 * EPUB 统一阅读样式。
 */
export const DEFAULT_CSS = `@charset "utf-8";

body {
  font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", serif;
  line-height: 1.9;
  margin: 0;
  padding: 0;
  color: #1a1a1a;
  word-break: break-word;
  -webkit-text-size-adjust: 100%;
}

h1, h2, h3, h4, h5, h6 {
  font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.5;
  margin: 1.2em 0 0.6em;
  font-weight: 700;
}

h1 { font-size: 1.7em; text-align: center; margin-top: 0.5em; }
h2 { font-size: 1.4em; }
h3 { font-size: 1.2em; }

p { margin: 0.6em 0; }

.chapter-content p { text-indent: 2em; margin: 0.4em 0; }

blockquote {
  margin: 1em 1.5em;
  padding: 0.4em 1em;
  border-left: 3px solid #c9c9c9;
  color: #555;
}

hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }

img { max-width: 100%; height: auto; }

.cover { text-align: center; padding: 0; margin: 0; }
.cover img { max-width: 100%; height: auto; }

nav#toc ol {
  list-style: none;
  padding-left: 0;
}

nav#toc li {
  margin: 0.4em 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3em;
}

nav#toc a {
  text-decoration: none;
  color: #1a1a1a;
}
`;
