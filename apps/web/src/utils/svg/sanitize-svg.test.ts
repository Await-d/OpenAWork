import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize-svg.js';

describe('sanitizeSvg', () => {
  it('保留正常绘图元素与几何属性', () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>',
    );
    expect(out).toContain('<circle');
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).toContain('fill="red"');
  });

  it('移除 script 元素及其内容', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<rect');
  });

  it('移除 <script/src=...> 这类正则可绕过的写法', () => {
    const out = sanitizeSvg('<svg><script/src="//evil.example/x.js"></script><rect/></svg>');
    expect(out.toLowerCase()).not.toContain('script');
  });

  it('移除无引号的事件处理器属性', () => {
    const out = sanitizeSvg('<svg onload=alert(1)><rect/></svg>');
    expect(out.toLowerCase()).not.toContain('onload');
  });

  it('移除带引号的事件处理器属性', () => {
    const out = sanitizeSvg('<svg><rect onclick="alert(1)" width="4"/></svg>');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out).toContain('width="4"');
  });

  it('拦截 javascript: 链接', () => {
    const out = sanitizeSvg('<svg><a href="javascript:alert(1)"><rect/></a></svg>');
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).toContain('<a');
  });

  it('拦截 use 元素上的 javascript: 引用', () => {
    const out = sanitizeSvg('<svg><use href="javascript:alert(1)"/></svg>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('拦截实体编码绕过', () => {
    const out = sanitizeSvg('<svg><a href="javascript&#58;alert(1)"><rect/></a></svg>');
    expect(out.toLowerCase()).not.toContain('javascript');
  });

  it('拦截控制字符拼接绕过', () => {
    const out = sanitizeSvg('<svg><a href="java\nscript:alert(1)"><rect/></a></svg>');
    expect(out.toLowerCase()).not.toContain('script:');
  });

  it('移除 animate / set 等可改写属性的动画元素', () => {
    const out = sanitizeSvg(
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><rect/></a></svg>',
    );
    expect(out.toLowerCase()).not.toContain('animate');
    expect(out.toLowerCase()).not.toContain('javascript');
  });

  it('移除 foreignObject', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>',
    );
    expect(out.toLowerCase()).not.toContain('foreignobject');
  });

  it('移除 <style> 元素，避免文档级样式污染宿主界面', () => {
    const out = sanitizeSvg('<svg><style>body{display:none}</style><rect/></svg>');
    expect(out.toLowerCase()).not.toContain('<style');
    expect(out).not.toContain('display:none');
  });

  it('清洗 style 属性中的外部 url()', () => {
    const out = sanitizeSvg('<svg><rect style="fill:url(https://evil.example/x#g)"/></svg>');
    expect(out).not.toContain('evil.example');
  });

  it('清洗 style 属性中的 expression 与 javascript:', () => {
    const out = sanitizeSvg(
      '<svg><rect style="width:expression(alert(1));fill:javascript:alert(1)"/></svg>',
    );
    expect(out.toLowerCase()).not.toContain('expression');
    expect(out.toLowerCase()).not.toContain('javascript');
  });

  it('保留 style 属性中的本地片段引用', () => {
    const out = sanitizeSvg('<svg><rect style="fill:url(#grad)"/></svg>');
    expect(out).toContain('url(#grad)');
  });

  it('保留位图 data URI，拦截 svg+xml data URI', () => {
    const png = sanitizeSvg('<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>');
    expect(png).toContain('data:image/png;base64');
    const nested = sanitizeSvg('<svg><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>');
    expect(nested).not.toContain('svg+xml');
  });

  it('对非法 / 空输入安全失败', () => {
    expect(sanitizeSvg('')).toBe('');
    expect(sanitizeSvg('   ')).toBe('');
    expect(sanitizeSvg('not an svg at all')).toBe('');
    expect(sanitizeSvg('<div>html not svg</div>')).toBe('');
  });

  it('对非 XML 的宽松 SVG 也能回退解析', () => {
    const out = sanitizeSvg('<svg width=10 onload=alert(1)><rect width=5></svg>');
    expect(out).toContain('<rect');
    expect(out.toLowerCase()).not.toContain('onload');
  });
});
