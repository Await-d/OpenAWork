import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_TRANSFORM_STATE,
  MAX_ZOOM_SCALE,
  MIN_IMAGE_DISPLAY_SIZE,
  MIN_ZOOM_SCALE,
  ZOOM_STEP,
  buildGallery,
  clampIndex,
  formatProgress,
  formatZoomPercent,
  goToIndex,
  hasMultiple,
  normalizeRotationDegrees,
  pageIndexFromOffset,
  resolveAltText,
  resolveBackAction,
  resolveDisplaySize,
  resolveFileName,
  resolveImageSrc,
  resolveIndex,
  resolveRotatedContentSize,
  resolveRotatedDisplaySize,
  resolveTransformControls,
  shouldResetTransform,
  transformReducer,
  type GallerySourceImage,
  type TransformState,
} from './lightbox-model';

function makeImage(overrides: Partial<GallerySourceImage> = {}): GallerySourceImage {
  return {
    id: 'img-1',
    type: 'image',
    content: 'AAAA',
    alt: '图一',
    ...overrides,
  };
}

/** 与真实调用点一致的默认解析器：content + mimeType → data URL。 */
const resolvePng = (image: GallerySourceImage): string | undefined =>
  resolveImageSrc(image.content, image.mimeType);

/** 永远解析不出地址的解析器，用于验证「不可渲染即过滤」。 */
const resolveNothing = (): string | undefined => undefined;

describe('clampIndex', () => {
  it('count === 0 时恒为 0', () => {
    expect(clampIndex(0, 0)).toBe(0);
    expect(clampIndex(5, 0)).toBe(0);
    expect(clampIndex(-3, 0)).toBe(0);
  });

  it('范围内原样返回', () => {
    expect(clampIndex(0, 3)).toBe(0);
    expect(clampIndex(2, 3)).toBe(2);
  });

  it('负数收敛到 0，越界收敛到 count - 1', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(-99, 3)).toBe(0);
    expect(clampIndex(3, 3)).toBe(2);
    expect(clampIndex(99, 3)).toBe(2);
  });

  it('非法输入收敛成确定值（NaN → 0，小数取整）', () => {
    expect(clampIndex(Number.NaN, 3)).toBe(0);
    expect(clampIndex(1.5, 3)).toBe(1);
    expect(clampIndex(1, 2.9)).toBe(1);
    expect(clampIndex(1, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('resolveIndex', () => {
  it('受控索引优先于内部状态', () => {
    expect(resolveIndex(2, 0, 3)).toBe(2);
  });

  it('受控缺失（undefined / null）时回退内部状态', () => {
    expect(resolveIndex(undefined, 1, 3)).toBe(1);
    expect(resolveIndex(null, 1, 3)).toBe(1);
  });

  it('受控越界时 clamp，count 为 0 时恒为 0', () => {
    expect(resolveIndex(9, 0, 3)).toBe(2);
    expect(resolveIndex(-4, 0, 3)).toBe(0);
    expect(resolveIndex(9, 1, 0)).toBe(0);
  });
});

describe('goToIndex（边界不循环 + 显式 no-op）', () => {
  it('中间位置返回 change，下标为 clamp 后的目标', () => {
    expect(goToIndex(0, 1, 3)).toEqual({ kind: 'change', index: 1 });
    expect(goToIndex(1, 2, 3)).toEqual({ kind: 'change', index: 2 });
  });

  it('第一张再往前：no-op，不回绕到最后一张', () => {
    expect(goToIndex(0, -1, 3)).toEqual({ kind: 'noop', index: 0 });
  });

  it('最后一张再往后：no-op，不回绕到第一张', () => {
    expect(goToIndex(2, 3, 3)).toEqual({ kind: 'noop', index: 2 });
  });

  it('count === 0 或单图时恒为 no-op', () => {
    expect(goToIndex(0, 0, 0)).toEqual({ kind: 'noop', index: 0 });
    expect(goToIndex(0, 1, 1)).toEqual({ kind: 'noop', index: 0 });
    expect(goToIndex(0, -1, 1)).toEqual({ kind: 'noop', index: 0 });
  });

  it('越界目标先 clamp 再比较：越界且落在别处仍是 change', () => {
    expect(goToIndex(0, 99, 3)).toEqual({ kind: 'change', index: 2 });
    expect(goToIndex(2, -99, 3)).toEqual({ kind: 'change', index: 0 });
  });

  it('非法的 current 也按 clamp 后比较（-5 视作 0，因此 -5 → 0 是 no-op）', () => {
    expect(goToIndex(-5, 0, 3)).toEqual({ kind: 'noop', index: 0 });
  });

  it('no-op 不会把相同索引回抛给受控调用点（spy 断言）', () => {
    const onIndexChange = vi.fn<(index: number) => void>();

    const atFirst = goToIndex(0, -1, 3);
    if (atFirst.kind === 'change') onIndexChange(atFirst.index);
    expect(atFirst.kind).toBe('noop');
    expect(onIndexChange).not.toHaveBeenCalled();

    const moved = goToIndex(0, 1, 3);
    if (moved.kind === 'change') onIndexChange(moved.index);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
});

describe('hasMultiple / formatProgress', () => {
  it('仅条目数 > 1 时渲染导航', () => {
    expect(hasMultiple(0)).toBe(false);
    expect(hasMultiple(1)).toBe(false);
    expect(hasMultiple(2)).toBe(true);
    expect(hasMultiple(1.9)).toBe(false);
  });

  it('进度文案为 "{i+1} / {count}"', () => {
    expect(formatProgress(0, 3)).toBe('1 / 3');
    expect(formatProgress(1, 3)).toBe('2 / 3');
    expect(formatProgress(2, 3)).toBe('3 / 3');
    expect(formatProgress(0, 1)).toBe('1 / 1');
  });

  it('进度下标先 clamp，越界不产生 "4 / 3" 之类文案', () => {
    expect(formatProgress(-1, 3)).toBe('1 / 3');
    expect(formatProgress(99, 3)).toBe('3 / 3');
  });

  it('空图集退化为 "0 / 0"，而不是无意义的 "1 / 0"', () => {
    expect(formatProgress(0, 0)).toBe('0 / 0');
  });
});

describe('transformReducer', () => {
  it('初始状态为 { scale: 1, rotation: 0 }', () => {
    expect(INITIAL_TRANSFORM_STATE).toEqual({ scale: 1, rotation: 0 });
  });

  it('zoomIn / zoomOut 步长固定 0.25', () => {
    expect(ZOOM_STEP).toBe(0.25);
    expect(transformReducer({ scale: 1, rotation: 0 }, { type: 'zoomIn' })).toEqual({
      scale: 1.25,
      rotation: 0,
    });
    expect(transformReducer({ scale: 1.25, rotation: 0 }, { type: 'zoomOut' })).toEqual({
      scale: 1,
      rotation: 0,
    });
  });

  it('scale 上界 5：越界 clamp 且不越过', () => {
    expect(MAX_ZOOM_SCALE).toBe(5);
    expect(transformReducer({ scale: 4.9, rotation: 0 }, { type: 'zoomIn' })).toEqual({
      scale: 5,
      rotation: 0,
    });
    expect(transformReducer({ scale: 5, rotation: 0 }, { type: 'zoomIn' })).toEqual({
      scale: 5,
      rotation: 0,
    });
  });

  it('scale 下界 0.25：越界 clamp 且不越过', () => {
    expect(MIN_ZOOM_SCALE).toBe(0.25);
    expect(transformReducer({ scale: 0.4, rotation: 0 }, { type: 'zoomOut' })).toEqual({
      scale: 0.25,
      rotation: 0,
    });
    expect(transformReducer({ scale: 0.25, rotation: 0 }, { type: 'zoomOut' })).toEqual({
      scale: 0.25,
      rotation: 0,
    });
  });

  it('越界缩放返回原状态对象（引用相等），避免无意义重渲染', () => {
    const atMax: TransformState = { scale: MAX_ZOOM_SCALE, rotation: 90 };
    const atMin: TransformState = { scale: MIN_ZOOM_SCALE, rotation: -90 };
    expect(transformReducer(atMax, { type: 'zoomIn' })).toBe(atMax);
    expect(transformReducer(atMin, { type: 'zoomOut' })).toBe(atMin);
  });

  it('旋转 ±90° 可累计，负角合法（不取模）', () => {
    let state: TransformState = INITIAL_TRANSFORM_STATE;
    state = transformReducer(state, { type: 'rotateRight' });
    expect(state.rotation).toBe(90);
    state = transformReducer(state, { type: 'rotateRight' });
    expect(state.rotation).toBe(180);
    state = transformReducer(state, { type: 'rotateRight' });
    expect(state.rotation).toBe(270);
    state = transformReducer(state, { type: 'rotateLeft' });
    expect(state.rotation).toBe(180);
    state = transformReducer(state, { type: 'rotateLeft' });
    state = transformReducer(state, { type: 'rotateLeft' });
    expect(state.rotation).toBe(0);
    state = transformReducer(state, { type: 'rotateLeft' });
    expect(state.rotation).toBe(-90);
  });

  it('resetZoom 仅把 scale 归 1，保留 rotation（易漏点）', () => {
    let state: TransformState = { scale: 1, rotation: 0 };
    state = transformReducer(state, { type: 'zoomIn' });
    state = transformReducer(state, { type: 'zoomIn' });
    state = transformReducer(state, { type: 'rotateRight' });
    expect(state).toEqual({ scale: 1.5, rotation: 90 });

    expect(transformReducer(state, { type: 'resetZoom' })).toEqual({ scale: 1, rotation: 90 });
  });

  it('resetZoom 时 scale 已是 1 → 返回原状态对象', () => {
    const rotated: TransformState = { scale: 1, rotation: 270 };
    expect(transformReducer(rotated, { type: 'resetZoom' })).toBe(rotated);
  });

  it('resetAll 回到 { 1, 0 }，rotation 一并清除', () => {
    const distorted: TransformState = { scale: 2.5, rotation: -180 };
    expect(transformReducer(distorted, { type: 'resetAll' })).toEqual({ scale: 1, rotation: 0 });
    expect(transformReducer(INITIAL_TRANSFORM_STATE, { type: 'resetAll' })).toBe(
      INITIAL_TRANSFORM_STATE,
    );
  });

  it('不可变：不修改传入状态，返回新对象', () => {
    const state: TransformState = { scale: 1, rotation: 0 };
    const next = transformReducer(state, { type: 'zoomIn' });
    expect(state).toEqual({ scale: 1, rotation: 0 });
    expect(next).not.toBe(state);
  });

  it('非法 scale（NaN）被收敛回初始值，不扩散脏值', () => {
    expect(transformReducer({ scale: Number.NaN, rotation: 0 }, { type: 'zoomIn' })).toEqual({
      scale: 1.25,
      rotation: 0,
    });
  });
});

describe('shouldResetTransform（锚定 src，而非 index）', () => {
  it('同一张图且非打开态：不重置', () => {
    expect(shouldResetTransform('/images/a.png', '/images/a.png', false)).toBe(false);
  });

  it('index 不变但 src 变化：必须重置（两次调用断言）', () => {
    // 第一次：同一张图 → 不重置
    expect(shouldResetTransform('/images/a.png', '/images/a.png', false)).toBe(false);
    // 第二次：Pager 数据刷新，index 仍是 0，但当前图片被换成另一张 → 必须重置
    expect(shouldResetTransform('/images/a.png', '/images/b.png', false)).toBe(true);
  });

  it('打开动作即使 src 相同也重置（重新打开不残留上次的缩放 / 旋转）', () => {
    expect(shouldResetTransform('/images/a.png', '/images/a.png', true)).toBe(true);
    expect(shouldResetTransform(undefined, undefined, true)).toBe(true);
  });

  it('src 从无到有 / 从有到无都重置', () => {
    expect(shouldResetTransform(undefined, '/images/a.png', false)).toBe(true);
    expect(shouldResetTransform('/images/a.png', undefined, false)).toBe(true);
  });

  it('null 与 undefined 等价；两者都为空且非打开态时不重置', () => {
    expect(shouldResetTransform(null, undefined, false)).toBe(false);
    expect(shouldResetTransform(undefined, null, false)).toBe(false);
    expect(shouldResetTransform(null, '/images/a.png', false)).toBe(true);
  });

  it('关闭 → 打开同一张图：关闭时不重置，打开时重置', () => {
    expect(shouldResetTransform('/images/a.png', '/images/a.png', false)).toBe(false);
    expect(shouldResetTransform('/images/a.png', '/images/a.png', true)).toBe(true);
  });
});

describe('buildGallery（四守卫 + 过滤后下标）', () => {
  const firstImage = makeImage({ id: 'img-1', alt: '图一', caption: '第一张', fileName: 'a.png' });
  const secondImage = makeImage({ id: 'img-2', content: 'BBBB', alt: '图二' });
  const markdown = makeImage({ id: 'doc-1', type: 'markdown', content: '# 标题' });

  it('只收 image 类型，保持原始顺序，src 由 resolveSource 提供', () => {
    const gallery = buildGallery(
      { images: [firstImage, markdown, secondImage], selected: firstImage },
      resolvePng,
    );

    expect(gallery?.items.map((item) => item.id)).toEqual(['img-1', 'img-2']);
    expect(gallery?.items[0]).toEqual({
      id: 'img-1',
      src: 'data:image/png;base64,AAAA',
      alt: '图一',
      caption: '第一张',
      fileName: 'a.png',
    });
    expect(gallery?.items[1]?.src).toBe('data:image/png;base64,BBBB');
    expect(gallery?.index).toBe(0);
  });

  it('守卫 1：无选中（undefined / null）返回 undefined', () => {
    const images = [firstImage];
    expect(buildGallery({ images }, resolvePng)).toBeUndefined();
    expect(buildGallery({ images, selected: null }, resolvePng)).toBeUndefined();
  });

  it('守卫 2：选中项不是图片返回 undefined', () => {
    expect(
      buildGallery({ images: [firstImage, markdown], selected: markdown }, resolvePng),
    ).toBeUndefined();
  });

  it('守卫 3：过滤后没有任何可渲染条目返回 undefined', () => {
    expect(buildGallery({ images: [], selected: firstImage }, resolvePng)).toBeUndefined();
    expect(buildGallery({ images: [markdown], selected: firstImage }, resolvePng)).toBeUndefined();
    expect(
      buildGallery({ images: [firstImage], selected: firstImage }, resolveNothing),
    ).toBeUndefined();
  });

  it('守卫 4：选中项不在过滤后条目里返回 undefined（列表被裁剪 / 过渡帧）', () => {
    const outsider = makeImage({ id: 'img-9' });
    expect(
      buildGallery({ images: [firstImage, secondImage], selected: outsider }, resolvePng),
    ).toBeUndefined();
  });

  it('守卫 4（内容不可渲染）：选中的图解析不出 src 时返回 undefined，不指向别的图', () => {
    const broken = makeImage({ id: 'img-broken', content: undefined });
    expect(
      buildGallery({ images: [firstImage, broken, secondImage], selected: broken }, resolvePng),
    ).toBeUndefined();
  });

  it('跳过不可渲染条目后，index 与 indexOf 都按过滤后下标计算', () => {
    const broken = makeImage({ id: 'img-broken', content: undefined });
    const gallery = buildGallery(
      { images: [broken, firstImage, secondImage], selected: secondImage },
      resolvePng,
    );

    expect(gallery?.index).toBe(1);
    expect(gallery?.indexOf('img-1')).toBe(0);
    expect(gallery?.indexOf('img-2')).toBe(1);
  });

  it('content 缺失 / 非图片 data 前缀的条目被丢弃且不打乱顺序', () => {
    const broken = makeImage({ id: 'img-broken', content: undefined });
    const unsafe = makeImage({ id: 'img-unsafe', content: 'data:text/html,<script/>' });
    const gallery = buildGallery(
      { images: [firstImage, broken, unsafe, secondImage], selected: firstImage },
      resolvePng,
    );

    expect(gallery?.items.map((item) => item.id)).toEqual(['img-1', 'img-2']);
  });

  it('indexOf 对未知 id 返回 -1（调用点据此 no-op）', () => {
    const gallery = buildGallery({ images: [firstImage], selected: firstImage }, resolvePng);
    expect(gallery?.indexOf('img-9')).toBe(-1);
  });
});

describe('resolveImageSrc', () => {
  it('content 已是 data:image/ 时原样返回，不重复拼前缀', () => {
    expect(resolveImageSrc('data:image/webp;base64,ZZZ')).toBe('data:image/webp;base64,ZZZ');
    expect(resolveImageSrc('data:image/svg+xml;base64,ZZZ')).toBe('data:image/svg+xml;base64,ZZZ');
  });

  it('data: 前缀只接受 data:image/，其它协议返回 undefined', () => {
    expect(resolveImageSrc('data:text/html,<script/>')).toBeUndefined();
    expect(resolveImageSrc('data:application/pdf;base64,ZZZ')).toBeUndefined();
  });

  it('裸 base64 按 mimeType 拼 data URL', () => {
    expect(resolveImageSrc('AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolveImageSrc('BBBB', 'image/jpeg')).toBe('data:image/jpeg;base64,BBBB');
    expect(resolveImageSrc('CCCC', 'image/svg+xml')).toBe('data:image/svg+xml;base64,CCCC');
  });

  it('mime 白名单拒绝参数注入，回退 image/png', () => {
    expect(resolveImageSrc('AAAA', 'image/png;base64,注入')).toBe('data:image/png;base64,AAAA');
    expect(resolveImageSrc('AAAA', 'text/html')).toBe('data:image/png;base64,AAAA');
    expect(resolveImageSrc('AAAA', 'image/')).toBe('data:image/png;base64,AAAA');
  });

  it('mime 缺失 / 非字符串回退 image/png；空白被 trim，大小写原样保留', () => {
    expect(resolveImageSrc('AAAA', undefined)).toBe('data:image/png;base64,AAAA');
    expect(resolveImageSrc('AAAA', 42)).toBe('data:image/png;base64,AAAA');
    expect(resolveImageSrc('AAAA', '  image/png  ')).toBe('data:image/png;base64,AAAA');
    // 与 Web 契约一致：只 trim，不改变大小写（media type 大小写不敏感）。
    expect(resolveImageSrc('AAAA', 'IMAGE/JPEG')).toBe('data:IMAGE/JPEG;base64,AAAA');
  });

  it('非字符串 content 返回 undefined 且不抛错', () => {
    const values: unknown[] = [undefined, null, 42, true, { base64: 'AAAA' }, ['AAAA']];
    for (const value of values) {
      expect(() => resolveImageSrc(value)).not.toThrow();
      expect(resolveImageSrc(value)).toBeUndefined();
    }
  });

  it('空字符串按裸 base64 处理（与 Web 契约一致，由调用方决定是否过滤）', () => {
    expect(resolveImageSrc('')).toBe('data:image/png;base64,');
  });
});

describe('resolveDisplaySize（C1：数据层尺寸兜底，无 DOM 测量）', () => {
  it('内禀尺寸缺失 / 非法时给 48px 最小占位', () => {
    expect(MIN_IMAGE_DISPLAY_SIZE).toBe(48);
    const invalid: Array<{ width?: unknown; height?: unknown }> = [
      {},
      { width: 100 },
      { width: Number.NaN, height: 100 },
      { width: 0, height: 0 },
      { width: -10, height: 10 },
      { width: '100', height: '100' },
      { width: Number.POSITIVE_INFINITY, height: 100 },
    ];
    for (const intrinsic of invalid) {
      expect(resolveDisplaySize(intrinsic)).toEqual({ width: 48, height: 48 });
    }
  });

  it('自定义 fallback 生效；fallback 自身非法时回退 48', () => {
    expect(resolveDisplaySize({}, undefined, 96)).toEqual({ width: 96, height: 96 });
    expect(resolveDisplaySize({}, undefined, 0)).toEqual({ width: 48, height: 48 });
    expect(resolveDisplaySize({}, undefined, Number.NaN)).toEqual({ width: 48, height: 48 });
  });

  it('宽图按 contain 等比适配到边界内', () => {
    expect(
      resolveDisplaySize({ width: 1000, height: 500 }, { maxWidth: 300, maxHeight: 300 }),
    ).toEqual({ width: 300, height: 150 });
  });

  it('高图按 contain 等比适配到边界内', () => {
    expect(
      resolveDisplaySize({ width: 500, height: 1000 }, { maxWidth: 300, maxHeight: 300 }),
    ).toEqual({ width: 150, height: 300 });
  });

  it('小于边界时按 contain 等比放大（对齐 CSS object-fit: contain）', () => {
    expect(
      resolveDisplaySize({ width: 200, height: 100 }, { maxWidth: 1000, maxHeight: 1000 }),
    ).toEqual({ width: 1000, height: 500 });
  });

  it('边界缺失 / 非法时返回内禀尺寸本身', () => {
    expect(resolveDisplaySize({ width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
    expect(resolveDisplaySize({ width: 320, height: 240 }, { maxWidth: 0, maxHeight: 0 })).toEqual({
      width: 320,
      height: 240,
    });
    expect(resolveDisplaySize({ width: 320, height: 240 }, null)).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('结果永远是有限正数，不出现 NaN / Infinity', () => {
    const size = resolveDisplaySize(
      { width: 1234, height: 567 },
      { maxWidth: 375, maxHeight: 667 },
    );
    expect(Number.isFinite(size.width)).toBe(true);
    expect(Number.isFinite(size.height)).toBe(true);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});

describe('resolveAltText / resolveFileName', () => {
  it('alt 优先，其次 caption，最后默认文案', () => {
    expect(resolveAltText('图片说明', '第一张')).toBe('图片说明');
    expect(resolveAltText(undefined, '第一张')).toBe('第一张');
    expect(resolveAltText(undefined, undefined)).toBe('图片预览');
    expect(resolveAltText(null, null)).toBe('图片预览');
  });

  it('空字符串按 ?? 语义原样保留（不被当作缺失）', () => {
    expect(resolveAltText('', '第一张')).toBe('');
  });

  it('文件名兜底为 image.png', () => {
    expect(resolveFileName('photo.jpg')).toBe('photo.jpg');
    expect(resolveFileName(undefined)).toBe('image.png');
    expect(resolveFileName(null)).toBe('image.png');
  });
});

describe('查看器状态机集成（模型即单一事实来源）', () => {
  it('打开 → 缩放旋转 → 切到下一张（src 变化）→ 变换重置', () => {
    const firstImage = makeImage({ id: 'img-1' });
    const secondImage = makeImage({ id: 'img-2', content: 'BBBB' });
    const gallery = buildGallery(
      { images: [firstImage, secondImage], selected: firstImage },
      resolvePng,
    );

    expect(gallery?.index).toBe(0);
    expect(hasMultiple(gallery?.items.length ?? 0)).toBe(true);

    const firstSrc = gallery?.items[0]?.src;
    const secondSrc = gallery?.items[1]?.src;
    let transform: TransformState = INITIAL_TRANSFORM_STATE;

    // 打开：锚定 isOpening 的重置
    if (shouldResetTransform(undefined, firstSrc, true)) transform = INITIAL_TRANSFORM_STATE;
    transform = transformReducer(transform, { type: 'zoomIn' });
    transform = transformReducer(transform, { type: 'rotateRight' });
    expect(transform).toEqual({ scale: 1.25, rotation: 90 });

    // 导航：受控调用点只在 change 时派发，边界 no-op 不发散
    const moved = goToIndex(gallery?.index ?? 0, 1, gallery?.items.length ?? 0);
    expect(moved).toEqual({ kind: 'change', index: 1 });

    // 切换后按 src 重置（index 变了、src 也变了）
    if (shouldResetTransform(firstSrc, secondSrc, false)) transform = INITIAL_TRANSFORM_STATE;
    expect(transform).toEqual(INITIAL_TRANSFORM_STATE);
    expect(formatProgress(moved.index, gallery?.items.length ?? 0)).toBe('2 / 2');
  });

  it('末尾继续下一张：no-op，transform 与进度都不变', () => {
    const images = [makeImage({ id: 'img-1' }), makeImage({ id: 'img-2', content: 'BBBB' })];
    const gallery = buildGallery({ images, selected: images[1] ?? null }, resolvePng);
    const index = gallery?.index ?? 0;
    let transform: TransformState = { scale: 2, rotation: 180 };

    const result = goToIndex(index, index + 1, gallery?.items.length ?? 0);
    expect(result).toEqual({ kind: 'noop', index: 1 });
    if (result.kind === 'change') transform = INITIAL_TRANSFORM_STATE;

    expect(transform).toEqual({ scale: 2, rotation: 180 });
    expect(formatProgress(index, gallery?.items.length ?? 0)).toBe('2 / 2');
  });
});

describe('resolveBackAction（先重置再关闭）', () => {
  it('未变换时直接 close：初始态是「无事可做」', () => {
    expect(resolveBackAction({ scale: 1, rotation: 0 })).toBe('close');
    expect(resolveBackAction(INITIAL_TRANSFORM_STATE)).toBe('close');
  });

  it('仅缩放偏离（放大 / 缩小 / 边界值）→ 先 resetAll', () => {
    expect(resolveBackAction({ scale: 1.25, rotation: 0 })).toBe('resetAll');
    expect(resolveBackAction({ scale: MIN_ZOOM_SCALE, rotation: 0 })).toBe('resetAll');
    expect(resolveBackAction({ scale: MAX_ZOOM_SCALE, rotation: 0 })).toBe('resetAll');
  });

  it('仅旋转偏离（正角 / 负角）→ 先 resetAll', () => {
    expect(resolveBackAction({ scale: 1, rotation: 90 })).toBe('resetAll');
    expect(resolveBackAction({ scale: 1, rotation: -270 })).toBe('resetAll');
  });

  it('缩放 + 旋转组合（scale > 1 且 rotation != 0）→ 先 resetAll', () => {
    expect(resolveBackAction({ scale: 2, rotation: 180 })).toBe('resetAll');
    expect(resolveBackAction({ scale: 5, rotation: -90 })).toBe('resetAll');
  });

  it('非法数值归一到初始态后按「未变换」处理 → close', () => {
    expect(resolveBackAction({ scale: Number.NaN, rotation: 0 })).toBe('close');
    expect(resolveBackAction({ scale: 1, rotation: Number.NaN })).toBe('close');
    expect(
      resolveBackAction({
        scale: Number.POSITIVE_INFINITY,
        rotation: Number.NEGATIVE_INFINITY,
      }),
    ).toBe('close');
  });

  it('与 transformReducer 的 resetAll 闭环：resetAll 之后必定 close', () => {
    let state: TransformState = { scale: 2, rotation: 90 };
    expect(resolveBackAction(state)).toBe('resetAll');

    state = transformReducer(state, { type: 'resetAll' });
    expect(state).toEqual(INITIAL_TRANSFORM_STATE);
    expect(resolveBackAction(state)).toBe('close');
  });

  it('纯函数：不修改传入状态', () => {
    const state: TransformState = { scale: 3, rotation: 90 };
    resolveBackAction(state);
    expect(state).toEqual({ scale: 3, rotation: 90 });
  });
});

describe('pageIndexFromOffset（分页偏移 → 下标）', () => {
  it('整页偏移映射到对应下标', () => {
    expect(pageIndexFromOffset(0, 300, 3)).toBe(0);
    expect(pageIndexFromOffset(300, 300, 3)).toBe(1);
    expect(pageIndexFromOffset(600, 300, 3)).toBe(2);
  });

  it('非整页偏移按半页就近取整', () => {
    expect(pageIndexFromOffset(120, 300, 3)).toBe(0);
    expect(pageIndexFromOffset(160, 300, 3)).toBe(1);
    // 1.5 页 → Math.round 进位到下一页
    expect(pageIndexFromOffset(450, 300, 3)).toBe(2);
  });

  it('负偏移（回弹 / 过冲）收敛到 0', () => {
    expect(pageIndexFromOffset(-1, 300, 3)).toBe(0);
    expect(pageIndexFromOffset(-300, 300, 3)).toBe(0);
    expect(pageIndexFromOffset(-99999, 300, 3)).toBe(0);
  });

  it('超出末页的偏移收敛到 count - 1', () => {
    expect(pageIndexFromOffset(900, 300, 3)).toBe(2);
    expect(pageIndexFromOffset(99999, 300, 3)).toBe(2);
    expect(pageIndexFromOffset(300, 300, 1)).toBe(0);
  });

  it('pageWidth <= 0 / 非法（未测量）时退化为第 0 页，不产生 NaN / Infinity', () => {
    const widths = [0, -300, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const pageWidth of widths) {
      const index = pageIndexFromOffset(900, pageWidth, 3);
      expect(index).toBe(0);
      expect(Number.isFinite(index)).toBe(true);
    }
  });

  it('offsetX 非法（NaN / Infinity）时退化为第 0 页，不产生 NaN 下标', () => {
    const offsets = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const offsetX of offsets) {
      const index = pageIndexFromOffset(offsetX, 300, 3);
      expect(index).toBe(0);
      expect(Number.isFinite(index)).toBe(true);
    }
  });

  it('count 为 0 / 单图时恒为 0（空图集不产生越界下标）', () => {
    expect(pageIndexFromOffset(0, 300, 0)).toBe(0);
    expect(pageIndexFromOffset(600, 300, 0)).toBe(0);
    expect(pageIndexFromOffset(600, 300, 1)).toBe(0);
  });

  it('与 goToIndex 组合：落到当前页是 no-op，跨页才是 change', () => {
    // 滑到下一页（610 ≈ 2.03 页 → 下标 2）→ change
    expect(goToIndex(1, pageIndexFromOffset(610, 300, 3), 3)).toEqual({ kind: 'change', index: 2 });
    // 回弹后仍落在当前页 → 不回抛相同下标给受控调用点
    expect(goToIndex(1, pageIndexFromOffset(300, 300, 3), 3)).toEqual({ kind: 'noop', index: 1 });
    expect(goToIndex(1, pageIndexFromOffset(-20, 300, 3), 3)).toEqual({ kind: 'change', index: 0 });
  });
});

describe('resolveRotatedDisplaySize（旋转后的视觉盒 / W2c）', () => {
  it('0° 与 180° 与 resolveDisplaySize 完全一致（宽高不换）', () => {
    const size = { width: 1000, height: 500 };
    const bounds = { maxWidth: 300, maxHeight: 300 };
    expect(resolveRotatedDisplaySize(size, 0, bounds)).toEqual(resolveDisplaySize(size, bounds));
    expect(resolveRotatedDisplaySize(size, 180, bounds)).toEqual(resolveDisplaySize(size, bounds));
  });

  it('90°：宽高互换后再 contain（横图变竖图，反之亦然）', () => {
    const bounds = { maxWidth: 300, maxHeight: 300 };
    expect(resolveRotatedDisplaySize({ width: 1000, height: 500 }, 90, bounds)).toEqual({
      width: 150,
      height: 300,
    });
    expect(resolveRotatedDisplaySize({ width: 500, height: 1000 }, 90, bounds)).toEqual({
      width: 300,
      height: 150,
    });
  });

  it('270°：结果与 90° 相同（交换宽高的几何等价）', () => {
    const bounds = { maxWidth: 375, maxHeight: 500 };
    const rotated = resolveRotatedDisplaySize({ width: 1000, height: 500 }, 90, bounds);
    expect(resolveRotatedDisplaySize({ width: 1000, height: 500 }, 270, bounds)).toEqual(rotated);
    // 非方边界下才是真正的「交换后再 contain」，而不是简单转置
    expect(rotated).toEqual({ width: 250, height: 500 });
  });

  it('负角 / 超 360° 先归一：-90 ≡ 270，-270 ≡ 90，450 ≡ 90', () => {
    const bounds = { maxWidth: 300, maxHeight: 300 };
    const size = { width: 1000, height: 500 };
    expect(resolveRotatedDisplaySize(size, -90, bounds)).toEqual(
      resolveRotatedDisplaySize(size, 270, bounds),
    );
    expect(resolveRotatedDisplaySize(size, -270, bounds)).toEqual(
      resolveRotatedDisplaySize(size, 90, bounds),
    );
    expect(resolveRotatedDisplaySize(size, 450, bounds)).toEqual(
      resolveRotatedDisplaySize(size, 90, bounds),
    );
  });

  it('bounds 缺失 / 非法：返回交换后的内禀尺寸（没有 bounds 就没有 contain）', () => {
    expect(resolveRotatedDisplaySize({ width: 320, height: 240 }, 90)).toEqual({
      width: 240,
      height: 320,
    });
    expect(resolveRotatedDisplaySize({ width: 320, height: 240 }, 90, null)).toEqual({
      width: 240,
      height: 320,
    });
    expect(
      resolveRotatedDisplaySize({ width: 320, height: 240 }, 90, { maxWidth: 0, maxHeight: 0 }),
    ).toEqual({ width: 240, height: 320 });
  });

  it('内禀尺寸非法：回退 48×48 占位（交换不改变占位）', () => {
    const invalid: Array<{ width?: unknown; height?: unknown }> = [
      {},
      { width: 100 },
      { width: Number.NaN, height: 100 },
      { width: 0, height: 0 },
      { width: -10, height: 10 },
      { width: '100', height: '100' },
      { width: Number.POSITIVE_INFINITY, height: 100 },
    ];
    for (const intrinsic of invalid) {
      expect(resolveRotatedDisplaySize(intrinsic, 90, { maxWidth: 300, maxHeight: 300 })).toEqual({
        width: MIN_IMAGE_DISPLAY_SIZE,
        height: MIN_IMAGE_DISPLAY_SIZE,
      });
      expect(resolveRotatedDisplaySize(intrinsic, 0)).toEqual({
        width: MIN_IMAGE_DISPLAY_SIZE,
        height: MIN_IMAGE_DISPLAY_SIZE,
      });
    }
  });

  it('自定义 fallback 生效；fallback 非法时回退 48', () => {
    expect(resolveRotatedDisplaySize({}, 90, undefined, 96)).toEqual({ width: 96, height: 96 });
    expect(resolveRotatedDisplaySize({}, 90, undefined, 0)).toEqual({ width: 48, height: 48 });
    expect(resolveRotatedDisplaySize({}, 270, undefined, Number.NaN)).toEqual({
      width: 48,
      height: 48,
    });
  });

  it('非象限角（45°）不换宽高，等价于 0°（UI 不可达，防语义漂移）', () => {
    expect(
      resolveRotatedDisplaySize({ width: 1000, height: 500 }, 45, {
        maxWidth: 300,
        maxHeight: 300,
      }),
    ).toEqual({ width: 300, height: 150 });
  });

  it('非有限 rotation 按 0° 处理，结果永远是有限正数', () => {
    const size = resolveRotatedDisplaySize({ width: 1234, height: 567 }, Number.NaN, {
      maxWidth: 375,
      maxHeight: 667,
    });
    expect(size).toEqual(
      resolveDisplaySize({ width: 1234, height: 567 }, { maxWidth: 375, maxHeight: 667 }),
    );
    expect(Number.isFinite(size.width)).toBe(true);
    expect(Number.isFinite(size.height)).toBe(true);
  });
});

describe('resolveRotatedContentSize（旋转前的布局尺寸 / W2c）', () => {
  it('非四分之一转原样返回（同一对象引用，便于跳过重渲染）', () => {
    const box = { width: 300, height: 150 };
    expect(resolveRotatedContentSize(box, 0)).toBe(box);
    expect(resolveRotatedContentSize(box, 180)).toBe(box);
    expect(resolveRotatedContentSize(box, 45)).toBe(box);
  });

  it('90° / 270° 返回转置，且与视觉盒互为转置', () => {
    expect(resolveRotatedContentSize({ width: 250, height: 500 }, 90)).toEqual({
      width: 500,
      height: 250,
    });
    expect(resolveRotatedContentSize({ width: 250, height: 500 }, 270)).toEqual({
      width: 500,
      height: 250,
    });
  });

  it('转置两次回到原尺寸（往返一致）', () => {
    const box = { width: 250, height: 500 };
    const once = resolveRotatedContentSize(box, 90);
    expect(resolveRotatedContentSize(once, 90)).toEqual(box);
    expect(resolveRotatedContentSize(once, 270)).toEqual(box);
  });

  it('与 resolveRotatedDisplaySize 成对：内容尺寸旋转后恰好等于视觉盒', () => {
    const intrinsic = { width: 1000, height: 500 };
    const bounds = { maxWidth: 375, maxHeight: 500 };
    const box = resolveRotatedDisplaySize(intrinsic, 90, bounds);
    const content = resolveRotatedContentSize(box, 90);
    // 内容（旋转前）与视觉盒同面积，且比例等于原图比例 —— 这正是「转置后旋转正好贴合」的条件
    expect(content.width * content.height).toBe(box.width * box.height);
    expect(content.width / content.height).toBeCloseTo(intrinsic.width / intrinsic.height, 10);
  });

  it('非有限 rotation 不转置（按 0° 处理）', () => {
    const box = { width: 250, height: 500 };
    expect(resolveRotatedContentSize(box, Number.NaN)).toBe(box);
  });
});

describe('normalizeRotationDegrees', () => {
  it('归一化到 [0, 360)：负角 / 超角 / 象限角', () => {
    expect(normalizeRotationDegrees(0)).toBe(0);
    expect(normalizeRotationDegrees(90)).toBe(90);
    expect(normalizeRotationDegrees(180)).toBe(180);
    expect(normalizeRotationDegrees(270)).toBe(270);
    expect(normalizeRotationDegrees(360)).toBe(0);
    expect(normalizeRotationDegrees(-90)).toBe(270);
    expect(normalizeRotationDegrees(-450)).toBe(270);
    expect(normalizeRotationDegrees(450)).toBe(90);
  });

  it('非有限值按 0 处理（不产生 NaN 角度）', () => {
    expect(normalizeRotationDegrees(Number.NaN)).toBe(0);
    expect(normalizeRotationDegrees(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeRotationDegrees(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('formatZoomPercent（工具栏读数）', () => {
  it('四舍五入到整数百分比', () => {
    expect(formatZoomPercent(1)).toBe('100%');
    expect(formatZoomPercent(1.25)).toBe('125%');
    expect(formatZoomPercent(0.25)).toBe('25%');
    expect(formatZoomPercent(MAX_ZOOM_SCALE)).toBe('500%');
    expect(formatZoomPercent(2.5)).toBe('250%');
    // 浮点边界：1.005 × 100 = 100.49999999999999 → 100%（不要写死「半值进位」的假设）
    expect(formatZoomPercent(1.005)).toBe('100%');
    expect(formatZoomPercent(1.006)).toBe('101%');
    expect(formatZoomPercent(1.004)).toBe('100%');
  });

  it('非有限值按初始比例读作 100%，不产生 NaN%', () => {
    expect(formatZoomPercent(Number.NaN)).toBe('100%');
    expect(formatZoomPercent(Number.POSITIVE_INFINITY)).toBe('100%');
  });
});

describe('resolveTransformControls（工具栏禁用态）', () => {
  it('初始态：两端都可缩放，但无可复位', () => {
    expect(resolveTransformControls(INITIAL_TRANSFORM_STATE)).toEqual({
      canZoomIn: true,
      canZoomOut: true,
      canReset: false,
    });
  });

  it('到上下界时对应端点禁用', () => {
    expect(resolveTransformControls({ scale: MIN_ZOOM_SCALE, rotation: 0 })).toEqual({
      canZoomIn: true,
      canZoomOut: false,
      canReset: true,
    });
    expect(resolveTransformControls({ scale: MAX_ZOOM_SCALE, rotation: 0 })).toEqual({
      canZoomIn: false,
      canZoomOut: true,
      canReset: true,
    });
  });

  it('仅旋转偏离：缩放两端仍可用，复位可用（旋转不设上下界）', () => {
    expect(resolveTransformControls({ scale: 1, rotation: -450 })).toEqual({
      canZoomIn: true,
      canZoomOut: true,
      canReset: true,
    });
  });

  it('非法数值按初始态归一：NaN / Infinity 不产生禁用态错判', () => {
    expect(resolveTransformControls({ scale: Number.NaN, rotation: Number.NaN })).toEqual({
      canZoomIn: true,
      canZoomOut: true,
      canReset: false,
    });
    expect(resolveTransformControls({ scale: Number.POSITIVE_INFINITY, rotation: 0 })).toEqual({
      canZoomIn: true,
      canZoomOut: true,
      canReset: false,
    });
  });

  it('与 resolveBackAction 同源：canReset === false ⟺ 返回键直接关闭', () => {
    const states: TransformState[] = [
      INITIAL_TRANSFORM_STATE,
      { scale: 1, rotation: 0 },
      { scale: 1.25, rotation: 0 },
      { scale: 1, rotation: 90 },
      { scale: 2, rotation: -180 },
      { scale: MIN_ZOOM_SCALE, rotation: 0 },
      { scale: Number.NaN, rotation: 0 },
    ];
    for (const state of states) {
      expect(resolveTransformControls(state).canReset).toBe(
        resolveBackAction(state) === 'resetAll',
      );
    }
  });
});

describe('transformReducer setScale（缩放层上报回灌）', () => {
  it('采纳上报的绝对比例，保留 rotation', () => {
    const state = transformReducer({ scale: 1, rotation: 90 }, { type: 'setScale', scale: 2.5 });
    expect(state).toEqual({ scale: 2.5, rotation: 90 });
  });

  it('越界值 clamp 到 [0.25, 5]（与步进缩放同一区间）', () => {
    expect(transformReducer(INITIAL_TRANSFORM_STATE, { type: 'setScale', scale: 9 })).toEqual({
      scale: MAX_ZOOM_SCALE,
      rotation: 0,
    });
    expect(transformReducer(INITIAL_TRANSFORM_STATE, { type: 'setScale', scale: 0.05 })).toEqual({
      scale: MIN_ZOOM_SCALE,
      rotation: 0,
    });
  });

  it('与当前比例一致时返回原状态对象（回执不触发重渲染）', () => {
    const state: TransformState = { scale: 2, rotation: 90 };
    expect(transformReducer(state, { type: 'setScale', scale: 2 })).toBe(state);
  });

  it('非法值按初始比例归一（NaN → 1）', () => {
    expect(
      transformReducer({ scale: 2, rotation: 45 }, { type: 'setScale', scale: Number.NaN }),
    ).toEqual({ scale: 1, rotation: 45 });
  });

  it('回灌后 resolveBackAction 反映真实画面（捏合进状态才不会再点就关）', () => {
    const pinned = transformReducer(INITIAL_TRANSFORM_STATE, { type: 'setScale', scale: 3 });
    expect(resolveBackAction(pinned)).toBe('resetAll');
    expect(resolveBackAction(transformReducer(pinned, { type: 'resetAll' }))).toBe('close');
  });
});
