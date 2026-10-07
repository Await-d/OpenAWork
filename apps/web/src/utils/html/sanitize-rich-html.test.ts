import { describe, expect, it } from 'vitest';
import { sanitizeRichHtml, sanitizeRichHtmlStyle } from './sanitize-rich-html.js';

describe('sanitizeRichHtml', () => {
  it('保留常规排版结构', () => {
    const out = sanitizeRichHtml(
      '<h1>标题</h1><p>正文 <strong>加粗</strong><em>斜体</em></p><ul><li>一</li></ul>',
    );
    expect(out).toContain('<h1>标题</h1>');
    expect(out).toContain('<strong>加粗</strong>');
    expect(out).toContain('<li>一</li>');
  });

  it('保留表格结构与合并单元格属性', () => {
    const out = sanitizeRichHtml('<table><tr><td colspan="2" align="center">A</td></tr></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('align="center"');
  });

  it('移除 script 及其内容', () => {
    const out = sanitizeRichHtml('<p>ok</p><script>fetch("//evil")</script>');
    expect(out).toContain('ok');
    expect(out.toLowerCase()).not.toContain('script');
  });

  it('移除无引号与单引号的事件处理器', () => {
    expect(sanitizeRichHtml('<p onclick=alert(1)>x</p>')).not.toContain('onclick');
    expect(sanitizeRichHtml("<p onmouseover='alert(1)'>x</p>")).not.toContain('onmouseover');
  });

  it('拦截 javascript: 链接（mammoth 会原样保留文档超链接）', () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">点我</a>');
    expect(out.toLowerCase()).not.toContain('javascript');
    expect(out).toContain('点我');
  });

  it('拦截实体编码绕过的 javascript: 链接', () => {
    const out = sanitizeRichHtml('<a href="javascript&#58;alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript');
  });

  it('保留 http(s) 链接并强制安全的外链属性', () => {
    const out = sanitizeRichHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('href="https://example.com"');
  });

  it('移除 iframe / form / object 等可嵌套文档的危险元素', () => {
    const out = sanitizeRichHtml(
      '<div><iframe src="https://evil"></iframe><form><input></form><object></object></div>',
    );
    expect(out.toLowerCase()).not.toContain('iframe');
    expect(out.toLowerCase()).not.toContain('<form');
    expect(out.toLowerCase()).not.toContain('<input');
    expect(out.toLowerCase()).not.toContain('<object');
  });

  it('移除 style 元素，避免文档级样式污染宿主', () => {
    const out = sanitizeRichHtml('<style>body{display:none}</style><p>x</p>');
    expect(out.toLowerCase()).not.toContain('<style');
    expect(out).not.toContain('display:none');
  });

  it('丢弃未列入白名单的标签（含其子树）', () => {
    const out = sanitizeRichHtml(
      '<p>前</p><marquee><script>alert(1)</script>轮播</marquee><p>后</p>',
    );
    expect(out).toContain('前');
    expect(out).toContain('后');
    expect(out.toLowerCase()).not.toContain('marquee');
    expect(out).not.toContain('轮播');
  });

  it('移除 id 属性以避免 DOM clobbering', () => {
    expect(sanitizeRichHtml('<p id="app">x</p>')).not.toContain('id="app"');
  });

  it('保留位图 data URI，拒绝 data:text/html', () => {
    const png = sanitizeRichHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(png).toContain('data:image/png;base64');
    const html = sanitizeRichHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">');
    expect(html).not.toContain('data:text/html');
  });

  it('清洗 style 属性中的外部 url 与 expression', () => {
    const out = sanitizeRichHtml('<p style="background:url(https://evil/x)">x</p>');
    expect(out).not.toContain('evil');
    const expr = sanitizeRichHtml('<p style="width:expression(alert(1))">x</p>');
    expect(expr.toLowerCase()).not.toContain('expression');
  });

  it('对空 / 非字符串输入安全失败', () => {
    expect(sanitizeRichHtml('')).toBe('');
    expect(sanitizeRichHtml('   ')).toBe('');
  });
});

describe('sanitizeRichHtmlStyle', () => {
  it('保留颜色等无害声明', () => {
    expect(sanitizeRichHtmlStyle('color: red; font-weight: 700')).toBe(
      'color: red; font-weight: 700',
    );
  });

  it('剥离 @import 与 expression', () => {
    const out = sanitizeRichHtmlStyle('@import url("//evil/x.css"); width: expression(alert(1))');
    expect(out).not.toContain('@import');
    expect(out.toLowerCase()).not.toContain('expression(alert');
  });
});
