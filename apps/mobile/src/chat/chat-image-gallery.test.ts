import { describe, expect, it } from 'vitest';
import type { MobileInputImage } from './chat-message-content';
import {
  buildMessageImageGallery,
  collectInputImageArtifactIds,
  hasRenderableImageUrl,
  resolveInputImageUri,
} from './chat-image-gallery';

function makeInputImage(overrides: Partial<MobileInputImage> = {}): MobileInputImage {
  return { ...overrides };
}

/** 空解析表：所有只带 artifactId 的条目都不可渲染。 */
const EMPTY_URI_BY_ID: ReadonlyMap<string, string> = new Map();

describe('hasRenderableImageUrl', () => {
  it('只有非空 imageUrl 才算可直接渲染', () => {
    expect(hasRenderableImageUrl(makeInputImage({ imageUrl: 'file:///a.png' }))).toBe(true);
    expect(hasRenderableImageUrl(makeInputImage({ imageUrl: '' }))).toBe(false);
    expect(hasRenderableImageUrl(makeInputImage({ artifactId: 'art-1' }))).toBe(false);
  });
});

describe('resolveInputImageUri', () => {
  it('imageUrl 直用，不查 artifact 解析表', () => {
    const image = makeInputImage({ imageUrl: 'file:///local.png', artifactId: 'art-1' });
    const uriById = new Map([['art-1', 'file:///artifact.png']]);
    expect(resolveInputImageUri(image, uriById)).toBe('file:///local.png');
  });

  it('仅 artifactId 时走解析表', () => {
    const image = makeInputImage({ artifactId: 'art-2' });
    const uriById = new Map([['art-2', 'file:///cache/art-2.png']]);
    expect(resolveInputImageUri(image, uriById)).toBe('file:///cache/art-2.png');
  });

  it('解析表缺失 / 值为空串时返回 undefined', () => {
    expect(resolveInputImageUri(makeInputImage({ artifactId: 'art-3' }), EMPTY_URI_BY_ID)).toBe(
      undefined,
    );
    expect(
      resolveInputImageUri(makeInputImage({ artifactId: 'art-3' }), new Map([['art-3', '']])),
    ).toBe(undefined);
  });

  it('空字符串 imageUrl 视为不可用，回退到 artifactId', () => {
    const image = makeInputImage({ imageUrl: '', artifactId: 'art-4' });
    const uriById = new Map([['art-4', 'file:///fallback.png']]);
    expect(resolveInputImageUri(image, uriById)).toBe('file:///fallback.png');
  });

  it('既无 imageUrl 也无有效 artifactId 时返回 undefined', () => {
    expect(resolveInputImageUri(makeInputImage(), EMPTY_URI_BY_ID)).toBe(undefined);
    expect(
      resolveInputImageUri(makeInputImage({ artifactId: '' }), new Map([['', 'file:///x.png']])),
    ).toBe(undefined);
  });
});

describe('collectInputImageArtifactIds', () => {
  it('跳过已有 imageUrl 的条目（不得再发请求）', () => {
    const images = [
      makeInputImage({ imageUrl: 'file:///local.png', artifactId: 'art-1' }),
      makeInputImage({ artifactId: 'art-2' }),
    ];
    expect(collectInputImageArtifactIds(images)).toEqual(['art-2']);
  });

  it('保序且保留重复（去重交给取数层 in-flight）', () => {
    const images = [
      makeInputImage({ artifactId: 'art-b' }),
      makeInputImage({ imageUrl: 'file:///local.png' }),
      makeInputImage({ artifactId: 'art-a' }),
      makeInputImage({ artifactId: 'art-b' }),
    ];
    expect(collectInputImageArtifactIds(images)).toEqual(['art-b', 'art-a', 'art-b']);
  });

  it('跳过空 artifactId，空输入返回空数组', () => {
    expect(
      collectInputImageArtifactIds([makeInputImage({ artifactId: '' }), makeInputImage()]),
    ).toEqual([]);
    expect(collectInputImageArtifactIds([])).toEqual([]);
    expect(collectInputImageArtifactIds(undefined)).toEqual([]);
    expect(collectInputImageArtifactIds(null)).toEqual([]);
  });
});

describe('buildMessageImageGallery', () => {
  it('空数组 / 缺失输入返回 undefined', () => {
    expect(buildMessageImageGallery([], EMPTY_URI_BY_ID)).toBe(undefined);
    expect(buildMessageImageGallery(undefined, EMPTY_URI_BY_ID)).toBe(undefined);
    expect(buildMessageImageGallery(null, EMPTY_URI_BY_ID)).toBe(undefined);
  });

  it('全部不可解析时返回 undefined（不凭空构造图集）', () => {
    const images = [makeInputImage({ artifactId: 'art-1' }), makeInputImage()];
    expect(buildMessageImageGallery(images, EMPTY_URI_BY_ID)).toBe(undefined);
  });

  it('按 inputImages 顺序保序构造 items', () => {
    const images = [
      makeInputImage({ imageUrl: 'file:///a.png', fileName: 'a.png' }),
      makeInputImage({ artifactId: 'art-b', fileName: 'b.png' }),
      makeInputImage({ artifactId: 'art-c', fileName: 'c.png' }),
    ];
    const gallery = buildMessageImageGallery(
      images,
      new Map([
        ['art-b', 'file:///cache/b.png'],
        ['art-c', 'file:///cache/c.png'],
      ]),
    );

    expect(gallery?.items.map((item) => item.src)).toEqual([
      'file:///a.png',
      'file:///cache/b.png',
      'file:///cache/c.png',
    ]);
    expect(gallery?.items.map((item) => item.sourceIndex)).toEqual([0, 1, 2]);
    expect(gallery?.items.map((item) => item.fileName)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(gallery?.items.map((item) => item.alt)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('丢弃未解析项，但保留其余条目的顺序', () => {
    const images = [
      makeInputImage({ imageUrl: 'file:///a.png' }),
      makeInputImage({ artifactId: 'art-missing' }),
      makeInputImage({ artifactId: 'art-c' }),
    ];
    const gallery = buildMessageImageGallery(images, new Map([['art-c', 'file:///c.png']]));

    expect(gallery?.items).toHaveLength(2);
    expect(gallery?.items.map((item) => item.src)).toEqual(['file:///a.png', 'file:///c.png']);
    expect(gallery?.items.map((item) => item.sourceIndex)).toEqual([0, 2]);
  });

  it('indexOf 走原始下标映射：被丢弃的条目不影响后续条目定位', () => {
    const dropped = makeInputImage({ artifactId: 'art-missing' });
    const first = makeInputImage({ imageUrl: 'file:///a.png' });
    const third = makeInputImage({ artifactId: 'art-c' });
    const images = [dropped, first, third];
    const gallery = buildMessageImageGallery(images, new Map([['art-c', 'file:///c.png']]));

    expect(gallery?.indexOf(first)).toBe(0);
    expect(gallery?.indexOf(third)).toBe(1);
    expect(gallery?.indexOf(dropped)).toBe(-1);
  });

  it('未知对象（不在 inputImages 中）返回 -1', () => {
    const images = [makeInputImage({ imageUrl: 'file:///a.png' })];
    const gallery = buildMessageImageGallery(images, EMPTY_URI_BY_ID);
    expect(gallery?.indexOf(makeInputImage({ imageUrl: 'file:///a.png' }))).toBe(-1);
  });

  it('单图退化为长度 1 的图集', () => {
    const image = makeInputImage({ imageUrl: 'file:///only.png', fileName: 'only.png' });
    const gallery = buildMessageImageGallery([image], EMPTY_URI_BY_ID);

    expect(gallery?.items).toHaveLength(1);
    expect(gallery?.items[0]?.src).toBe('file:///only.png');
    expect(gallery?.indexOf(image)).toBe(0);
  });

  it('重复项不去重：同 artifactId 两次各自成条且下标正确', () => {
    const repeated = makeInputImage({ artifactId: 'art-dup' });
    const images = [repeated, makeInputImage({ imageUrl: 'file:///mid.png' }), repeated];
    const gallery = buildMessageImageGallery(images, new Map([['art-dup', 'file:///dup.png']]));

    expect(gallery?.items).toHaveLength(3);
    expect(gallery?.items.map((item) => item.src)).toEqual([
      'file:///dup.png',
      'file:///mid.png',
      'file:///dup.png',
    ]);
    // 同对象出现在两个位置：indexOf 取首次出现（真实数据里 collectInputImages 每次新建对象）。
    expect(gallery?.indexOf(repeated)).toBe(0);
  });

  it('重复项引用不同但内容相同：各自定位到自己的图集下标', () => {
    const first = makeInputImage({ artifactId: 'art-dup' });
    const second = makeInputImage({ artifactId: 'art-dup' });
    const images = [first, second];
    const gallery = buildMessageImageGallery(images, new Map([['art-dup', 'file:///dup.png']]));

    expect(gallery?.items).toHaveLength(2);
    expect(gallery?.items.map((item) => item.id)).toEqual(['input-image:0', 'input-image:1']);
    expect(gallery?.indexOf(first)).toBe(0);
    expect(gallery?.indexOf(second)).toBe(1);
  });

  it('fileName 透传到条目，未给定时不伪造', () => {
    const withName = makeInputImage({
      artifactId: 'art-mime',
      fileName: 'mime.webp',
      mimeType: 'image/webp',
    });
    const withoutName = makeInputImage({ imageUrl: 'file:///anon.png' });
    const gallery = buildMessageImageGallery(
      [withName, withoutName],
      new Map([['art-mime', 'file:///m.webp']]),
    );

    expect(gallery?.items[0]?.fileName).toBe('mime.webp');
    expect(gallery?.items[0]?.caption).toBe(undefined);
    expect(gallery?.items[1]?.fileName).toBe(undefined);
    expect(gallery?.items[1]?.alt).toBe(undefined);
  });
});
