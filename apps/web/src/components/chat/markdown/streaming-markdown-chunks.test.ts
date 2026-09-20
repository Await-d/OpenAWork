import { describe, expect, it } from 'vitest';
import { splitStreamingMarkdownIntoSegments } from './streaming-markdown-chunks.js';

describe('splitStreamingMarkdownIntoSegments · 稳定块切分', () => {
  it('空行是安全边界：前面的段落落定，后面的内容留在尾部', () => {
    const segments = splitStreamingMarkdownIntoSegments('第一段\n\n第二段');

    expect(segments.stableBlocks).toEqual(['第一段']);
    expect(segments.activeTail).toBe('第二段');
  });

  it('未闭合围栏不切分，围栏内部的空行也不是边界', () => {
    const content = '```ts\nconst a = 1;\n\nconst b = 2;';
    const segments = splitStreamingMarkdownIntoSegments(content);

    expect(segments.stableBlocks).toEqual([]);
    expect(segments.activeTail).toBe(content);
  });

  it('闭合围栏立即切分，围栏之后的内容留在尾部', () => {
    const segments = splitStreamingMarkdownIntoSegments('```ts\nconst a = 1;\n```\n后续说明');

    expect(segments.stableBlocks).toEqual(['```ts\nconst a = 1;\n```']);
    expect(segments.activeTail).toBe('后续说明');
  });

  it('连续多个安全边界依次切分', () => {
    const segments = splitStreamingMarkdownIntoSegments('A\n\nB\n\nC');

    expect(segments.stableBlocks).toEqual(['A', 'B']);
    expect(segments.activeTail).toBe('C');
  });

  it('空内容返回空段', () => {
    expect(splitStreamingMarkdownIntoSegments('')).toEqual({
      activeTail: '',
      stableBlocks: [],
    });
  });

  it('中文段首全角空格不构成缩进，仍然是安全边界', () => {
    const segments = splitStreamingMarkdownIntoSegments('第一段。\n\n\u3000\u3000第二段。');

    expect(segments.stableBlocks).toEqual(['第一段。']);
    expect(segments.activeTail).toBe('\u3000\u3000第二段。');
  });
});

describe('splitStreamingMarkdownIntoSegments · 列表边界', () => {
  it('松散列表（列表项之间的空行）不切分', () => {
    const content = '- a\n\n- b';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('有序列表（句点标记）之间的空行不切分', () => {
    const content = '1. a\n\n2. b';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('有序列表（右括号标记）之间的空行不切分', () => {
    const content = '1) a\n\n2) b';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('嵌套列表（缩进的列表项）不切分', () => {
    const content = '- a\n\n  - b';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('列表项的 2 空格缩进续行不切分', () => {
    const content = '- item\n\n  more';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('列表项的 3 空格缩进续行（有序列表）不切分', () => {
    const content = '1. item\n\n   more';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('4 空格缩进续行不切分', () => {
    const content = '正文\n\n    缩进内容';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });
});

describe('splitStreamingMarkdownIntoSegments · 文档级构造不切分', () => {
  it('链接引用定义后的空行不切分', () => {
    const content = '[x]: https://example.com\n\n引用说明';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('引用定义与被引用块不相邻时也不切分（定义在文末）', () => {
    const content = '见 [x] 的说明。\n\n中间段落。\n\n[x]: https://example.com';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('冒号后无空白的引用定义同样触发不切分', () => {
    const content = '见 [x]。\n\n[x]:https://example.com';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('HTML block（<pre>）内含空行不切分', () => {
    const content = '<pre>\nline1\n\nline2\n</pre>\n\ndone';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('HTML 注释内含空行不切分', () => {
    const content = '<!-- note\n\nmore\n-->\n\n后文';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('$$ 数学块内含空行不切分', () => {
    const content = '$$\na\n\nb\n$$';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('整份 HTML 文档不切分（含空行也不切）', () => {
    const content =
      '<!DOCTYPE html>\n<html>\n<head>\n<title>x</title>\n</head>\n\n<body>\n<p>hi</p>\n</body>\n</html>';

    expect(splitStreamingMarkdownIntoSegments(content)).toEqual({
      activeTail: content,
      stableBlocks: [],
    });
  });

  it('围栏代码块内的 <script> 不算文档级构造，仍可切分', () => {
    const segments = splitStreamingMarkdownIntoSegments('```html\n<script>\n```\n\n后文');

    expect(segments.stableBlocks).toEqual(['```html\n<script>\n```']);
    expect(segments.activeTail).toBe('后文');
  });
});
