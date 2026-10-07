import { describe, expect, it } from 'vitest';
import { resolveSvgIntrinsicSize } from './resolve-svg-intrinsic-size.js';

const WITH_VIEW_BOX = '<svg viewBox="0 0 1200 800"><rect /></svg>';
const WITH_COMMA_VIEW_BOX = "<svg viewBox='-10,-20,300,150'></svg>";
const WITH_PX_SIZE = '<svg width="640px" height="480"></svg>';
const BAD_VIEW_BOX = '<svg viewBox="bad" width="10" height="20"></svg>';

describe('resolveSvgIntrinsicSize', () => {
  it('优先取 viewBox 的宽高', () => {
    expect(resolveSvgIntrinsicSize(WITH_VIEW_BOX)).toEqual({ width: 1200, height: 800 });
  });

  it('容忍负起点与逗号分隔的 viewBox', () => {
    expect(resolveSvgIntrinsicSize(WITH_COMMA_VIEW_BOX)).toEqual({ width: 300, height: 150 });
  });

  it('没有 viewBox 时回退到根元素 width/height', () => {
    expect(resolveSvgIntrinsicSize(WITH_PX_SIZE)).toEqual({ width: 640, height: 480 });
  });

  it('百分比等上下文相关长度不作为尺寸来源', () => {
    expect(resolveSvgIntrinsicSize('<svg width="100%" height="100%"></svg>')).toBeNull();
  });

  it('viewBox 非法时退回 width/height', () => {
    expect(resolveSvgIntrinsicSize(BAD_VIEW_BOX)).toEqual({ width: 10, height: 20 });
  });

  it('既无 viewBox 也无有效尺寸时返回 null', () => {
    expect(resolveSvgIntrinsicSize('<svg><rect /></svg>')).toBeNull();
    expect(resolveSvgIntrinsicSize('not svg at all')).toBeNull();
  });

  it('viewBox 中的零宽高视为无效', () => {
    expect(resolveSvgIntrinsicSize('<svg viewBox="0 0 0 100"></svg>')).toBeNull();
  });
});
