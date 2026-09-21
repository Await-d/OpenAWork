import { describe, expect, it, vi } from 'vitest';
import type { ArtifactRecord } from '@openAwork/artifacts';

import {
  buildArtifactImageGallery,
  buildArtifactImageLightboxItems,
  resolveArtifactImageSrc,
} from './artifact-image-gallery.js';

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'image',
    title: '生成的图片',
    content: 'AAAA',
    version: 1,
    parentVersionId: null,
    metadata: {},
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

const firstImage = makeArtifact({ id: 'img-1', title: '图一', content: 'AAAA' });
const secondImage = makeArtifact({ id: 'img-2', title: '图二', content: 'BBBB' });
const markdown = makeArtifact({
  id: 'doc-1',
  type: 'markdown',
  title: '说明文档',
  content: '# 标题',
});

describe('resolveArtifactImageSrc', () => {
  it('content 已是 data URL 时原样返回，不重复拼前缀', () => {
    expect(resolveArtifactImageSrc(firstImage, 'data:image/webp;base64,ZZZ')).toBe(
      'data:image/webp;base64,ZZZ',
    );
  });

  it('裸 base64 按 metadata.mimeType 拼接，缺省 image/png', () => {
    expect(resolveArtifactImageSrc(firstImage, 'AAAA')).toBe('data:image/png;base64,AAAA');
    expect(
      resolveArtifactImageSrc(makeArtifact({ metadata: { mimeType: 'image/jpeg' } }), 'BBBB'),
    ).toBe('data:image/jpeg;base64,BBBB');
  });

  it('content 非字符串时返回 undefined，不抛错', () => {
    expect(resolveArtifactImageSrc(firstImage, undefined)).toBeUndefined();
    expect(resolveArtifactImageSrc(firstImage, null)).toBeUndefined();
    expect(resolveArtifactImageSrc(firstImage, 42)).toBeUndefined();
  });

  it('metadata.mimeType 不在 image/* 白名单时回退 image/png', () => {
    expect(
      resolveArtifactImageSrc(makeArtifact({ metadata: { mimeType: 'text/html' } }), 'AAAA'),
    ).toBe('data:image/png;base64,AAAA');
    expect(
      resolveArtifactImageSrc(
        makeArtifact({ metadata: { mimeType: 'image/png;base64,注入' } }),
        'AAAA',
      ),
    ).toBe('data:image/png;base64,AAAA');
  });

  it('data: 前缀只接受 data:image/，其它协议返回 undefined', () => {
    expect(resolveArtifactImageSrc(firstImage, 'data:text/html,<script/>')).toBeUndefined();
    expect(resolveArtifactImageSrc(firstImage, 'data:image/svg+xml;base64,ZZZ')).toBe(
      'data:image/svg+xml;base64,ZZZ',
    );
  });
});

describe('buildArtifactImageLightboxItems', () => {
  it('只收图片类型，并按入参顺序构造条目', () => {
    const items = buildArtifactImageLightboxItems([firstImage, markdown, secondImage]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      src: 'data:image/png;base64,AAAA',
      alt: '图一',
      caption: '图一',
      fileName: '图一.png',
    });
    expect(items[1]?.src).toBe('data:image/png;base64,BBBB');
  });

  it('非图片产物不进入图集', () => {
    expect(buildArtifactImageLightboxItems([markdown])).toEqual([]);
  });

  it('过滤掉 content 缺失 / 非图片 data 前缀的条目', () => {
    const broken = makeArtifact({ id: 'img-broken', content: undefined });
    const unsafe = makeArtifact({ id: 'img-unsafe', content: 'data:text/html,<script/>' });

    const items = buildArtifactImageLightboxItems([firstImage, broken, unsafe, secondImage]);

    expect(items.map((item) => item.caption)).toEqual(['图一', '图二']);
  });
});

describe('buildArtifactImageGallery', () => {
  it('选中项不是图片时返回 undefined，预览面退化为单图', () => {
    expect(buildArtifactImageGallery([firstImage, markdown], markdown, vi.fn())).toBeUndefined();
  });

  it('列表里没有图片产物时返回 undefined', () => {
    expect(buildArtifactImageGallery([markdown], firstImage, vi.fn())).toBeUndefined();
  });

  it('选中图片不在列表中时返回 undefined，而不是指向别的图片', () => {
    expect(
      buildArtifactImageGallery([firstImage, secondImage], makeArtifact({ id: 'img-9' }), vi.fn()),
    ).toBeUndefined();
  });

  it('选中图片内容不可渲染时返回 undefined，而不是指向别的图片', () => {
    const broken = makeArtifact({ id: 'img-broken', content: undefined });
    expect(
      buildArtifactImageGallery([firstImage, broken, secondImage], broken, vi.fn()),
    ).toBeUndefined();
  });

  it('跳过内容不可渲染的条目后仍按剩余图集下标映射', () => {
    const broken = makeArtifact({ id: 'img-broken', content: undefined });
    const onSelectArtifactId = vi.fn();
    const gallery = buildArtifactImageGallery(
      [broken, firstImage, secondImage],
      secondImage,
      onSelectArtifactId,
    );

    expect(gallery?.index).toBe(1);
    gallery?.onIndexChange(0);
    expect(onSelectArtifactId).toHaveBeenCalledWith('img-1');
  });

  it('给出图片列表下标，切换时把下标映射回产物 id', () => {
    const onSelectArtifactId = vi.fn();
    const gallery = buildArtifactImageGallery(
      [firstImage, markdown, secondImage],
      secondImage,
      onSelectArtifactId,
    );

    expect(gallery?.index).toBe(1);
    expect(gallery?.items.map((item) => item.caption)).toEqual(['图一', '图二']);

    gallery?.onIndexChange(0);
    expect(onSelectArtifactId).toHaveBeenCalledWith('img-1');

    onSelectArtifactId.mockClear();
    gallery?.onIndexChange(7);
    expect(onSelectArtifactId).not.toHaveBeenCalled();
  });
});
