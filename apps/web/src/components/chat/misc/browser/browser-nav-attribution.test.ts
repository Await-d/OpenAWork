/**
 * `nav` 回报的标签归属判定。
 *
 * 钉住的真实缺陷：新建空白标签 → 切到已打开的标签 → 再切回空白标签，空白标签
 * 被替换成前一个标签的地址。成因是门关侧的导航回报是**延迟**的，用户切标签之后
 * 才到达，而宿主无条件把它写回「当前激活标签」。
 */

import { describe, expect, it } from 'vitest';

import { attributeNavReport } from './browser-nav-attribution.js';

describe('attributeNavReport', () => {
  it('地址不属于其它标签时接受（正常的页面内跳转）', () => {
    const verdict = attributeNavReport(
      { url: 'https://example.test/about', generation: 3 },
      {
        activeUrl: 'https://example.test/',
        otherTabUrls: ['https://other.test/'],
        acceptedGeneration: 2,
      },
    );

    expect(verdict).toEqual({ accept: true, generation: 3 });
  });

  it('地址正被其它标签占着时丢弃（这就是「空白标签被替换」的直接原因）', () => {
    // 当前标签是空白页；上一个标签停在 app 页。延迟到达的 app 页 nav 属于上一个标签。
    const verdict = attributeNavReport(
      { url: 'https://example.test/app' },
      {
        activeUrl: 'about:blank',
        otherTabUrls: ['https://example.test/app'],
        acceptedGeneration: null,
      },
    );

    expect(verdict).toEqual({ accept: false, reason: 'foreign-url' });
  });

  it('代次比已接受的更旧时丢弃（不依赖地址的判据）', () => {
    const verdict = attributeNavReport(
      { url: 'https://example.test/old', generation: 4 },
      { activeUrl: 'about:blank', otherTabUrls: [], acceptedGeneration: 7 },
    );

    expect(verdict).toEqual({ accept: false, reason: 'stale-generation' });
  });

  it('代次更新时接受，即使地址暂时没人占用', () => {
    const verdict = attributeNavReport(
      { url: 'https://example.test/new', generation: 8 },
      { activeUrl: 'https://example.test/', otherTabUrls: [], acceptedGeneration: 7 },
    );

    expect(verdict).toEqual({ accept: true, generation: 8 });
  });

  it('老网关不带代次时只看地址归属', () => {
    const accepted = attributeNavReport(
      { url: 'https://example.test/next' },
      { activeUrl: 'https://example.test/', otherTabUrls: [], acceptedGeneration: 7 },
    );
    expect(accepted).toEqual({ accept: true, generation: null });

    // 没有代次可依时，仍然靠地址识别别人的回报。
    const rejected = attributeNavReport(
      { url: 'https://other.test/' },
      {
        activeUrl: 'about:blank',
        otherTabUrls: ['https://other.test/'],
        acceptedGeneration: 7,
      },
    );
    expect(rejected).toEqual({ accept: false, reason: 'foreign-url' });
  });

  it('地址与当前标签相同时接受（SPA 同址换 title 需要写回）', () => {
    const verdict = attributeNavReport(
      { url: 'https://example.test/app', generation: 5 },
      {
        activeUrl: 'https://example.test/app',
        // 即使别的标签也访问这个地址，本标签自己也在这个地址上，不能当别人的回报。
        otherTabUrls: ['https://example.test/app'],
        acceptedGeneration: 5,
      },
    );

    expect(verdict).toEqual({ accept: true, generation: 5 });
  });

  it('代次门槛未知时不因代次拒收', () => {
    const verdict = attributeNavReport(
      { url: 'https://example.test/', generation: 1 },
      { activeUrl: 'about:blank', otherTabUrls: [], acceptedGeneration: null },
    );

    expect(verdict).toEqual({ accept: true, generation: 1 });
  });
});
