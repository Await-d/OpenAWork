import { describe, expect, it } from 'vitest';
import { extractMarkdownImageUrls } from './markdown-image-urls.js';

describe('extractMarkdownImageUrls', () => {
  it('按出现顺序抽取多张图片', () => {
    const source = [
      '![架构图](/images/arch.png)',
      '',
      '正文',
      '',
      '![流程](/images/flow.png)',
    ].join('\n');

    expect(extractMarkdownImageUrls(source)).toEqual(['/images/arch.png', '/images/flow.png']);
  });

  it('支持 title 的双引号、单引号与括号写法', () => {
    expect(extractMarkdownImageUrls('![a](/a.png "标题")')).toEqual(['/a.png']);
    expect(extractMarkdownImageUrls("![a](/a.png '标题')")).toEqual(['/a.png']);
    expect(extractMarkdownImageUrls('![a](/a.png (标题))')).toEqual(['/a.png']);
  });

  it('URL 内的成对括号完整保留', () => {
    expect(extractMarkdownImageUrls('![a](https://x.test/img(1).png)')).toEqual([
      'https://x.test/img(1).png',
    ]);
    expect(extractMarkdownImageUrls('![a](./dir(1)/b(2).png)')).toEqual(['./dir(1)/b(2).png']);
  });

  it('尖括号包裹的 URL 允许空格', () => {
    expect(extractMarkdownImageUrls('![a](<https://x.test/my image.png>)')).toEqual([
      'https://x.test/my image.png',
    ]);
  });

  it('空 alt、data URL 与链接混排都能识别', () => {
    const source = [
      '[文档](/docs/intro)',
      '![](data:image/png;base64,AAAA)',
      '[![嵌套](</nested.png>)](/target)',
    ].join('\n');

    expect(extractMarkdownImageUrls(source)).toEqual(['data:image/png;base64,AAAA', '/nested.png']);
  });

  it('剥离 fenced code 与行内代码中的图片写法', () => {
    const source = [
      '```md',
      '![code](/code.png)',
      '```',
      '',
      '`![inline](/inline.png)`',
      '',
      '![real](/real.png)',
    ].join('\n');

    expect(extractMarkdownImageUrls(source)).toEqual(['/real.png']);
  });

  it('~~~~ 围栏同样被剥离', () => {
    const source = ['~~~md', '![code](/code.png)', '~~~', '![real](/real.png)'].join('\n');
    expect(extractMarkdownImageUrls(source)).toEqual(['/real.png']);
  });

  it('未闭合围栏之后的图片写法不再计入（流式半成品）', () => {
    const source = ['![real](/real.png)', '```md', '![inside](/code.png)'].join('\n');
    expect(extractMarkdownImageUrls(source)).toEqual(['/real.png']);
  });

  it('无效写法（空目标 / 未闭合）直接跳过', () => {
    expect(extractMarkdownImageUrls('![a]()')).toEqual([]);
    expect(extractMarkdownImageUrls('![a](/broken.png')).toEqual([]);
    expect(extractMarkdownImageUrls('普通链接 [link](/page) 不是图片')).toEqual([]);
    expect(extractMarkdownImageUrls('')).toEqual([]);
  });
});
