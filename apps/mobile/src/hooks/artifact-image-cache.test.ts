import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_IMAGE_CACHE_CAPACITY,
  ARTIFACT_IMAGE_FILE_SEGMENT_MAX_LENGTH,
  ArtifactImageFailureTracker,
  ArtifactImageInFlight,
  ArtifactImageLruCache,
  buildArtifactImageFileName,
  decideArtifactImagePayload,
  deriveArtifactImageCacheKey,
  deriveArtifactImageDimensions,
  deriveArtifactImageMetadata,
  describeArtifactImageError,
  describeArtifactImageRejectReason,
  normalizeArtifactImageMimeType,
  normalizeBase64ImagePayload,
  resolveArtifactImageDimensions,
  resolveArtifactImageFileExtension,
  sanitizeArtifactImageFileSegment,
} from './artifact-image-cache';

/** 1×1 PNG 的合法 base64（远大于最小长度阈值）。 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('normalizeArtifactImageMimeType', () => {
  it('白名单命中的 mime 小写化返回', () => {
    expect(normalizeArtifactImageMimeType('image/png')).toBe('image/png');
    expect(normalizeArtifactImageMimeType('IMAGE/JPEG')).toBe('image/jpeg');
    expect(normalizeArtifactImageMimeType('  image/svg+xml  ')).toBe('image/svg+xml');
    expect(normalizeArtifactImageMimeType('image/vnd.microsoft.icon')).toBe(
      'image/vnd.microsoft.icon',
    );
  });

  it('白名单外的 mime 回退 image/png', () => {
    expect(normalizeArtifactImageMimeType('text/html')).toBe('image/png');
    expect(normalizeArtifactImageMimeType('image/*')).toBe('image/png');
    expect(normalizeArtifactImageMimeType('image/')).toBe('image/png');
    expect(normalizeArtifactImageMimeType(undefined)).toBe('image/png');
    expect(normalizeArtifactImageMimeType(42)).toBe('image/png');
  });
});

describe('normalizeBase64ImagePayload', () => {
  it('去除空白并保留合法载荷', () => {
    const wrapped = `  ${PNG_BASE64.slice(0, 16)}\n${PNG_BASE64.slice(16)}  `;
    expect(normalizeBase64ImagePayload(wrapped)).toBe(PNG_BASE64);
  });

  it('拒绝过短与非法字符载荷', () => {
    expect(normalizeBase64ImagePayload('QUJD')).toBeNull();
    expect(normalizeBase64ImagePayload('/tmp/foobar')).toBeNull();
    expect(normalizeBase64ImagePayload('{"data":"image"}')).toBeNull();
    expect(normalizeBase64ImagePayload('!!!!not-base64!!!!')).toBeNull();
  });
});

describe('decideArtifactImagePayload', () => {
  it('非字符串载荷一律拒绝', () => {
    for (const value of [42, null, undefined, {}, [], true]) {
      expect(decideArtifactImagePayload(value)).toEqual({
        kind: 'reject',
        reason: 'not-a-string',
      });
    }
  });

  it('空载荷拒绝', () => {
    expect(decideArtifactImagePayload('   ')).toEqual({
      kind: 'reject',
      reason: 'empty-payload',
    });
  });

  it('data:image/...;base64 载荷应写盘，并保留声明 mime', () => {
    const decision = decideArtifactImagePayload(`data:image/png;base64,${PNG_BASE64}`);
    expect(decision).toEqual({ kind: 'write-base64', base64: PNG_BASE64, mimeType: 'image/png' });
  });

  it('data URI 的 mime 大小写不敏感且可带额外参数', () => {
    const upper = decideArtifactImagePayload(`data:IMAGE/SVG+XML;base64,${PNG_BASE64}`);
    expect(upper).toEqual({
      kind: 'write-base64',
      base64: PNG_BASE64,
      mimeType: 'image/svg+xml',
    });
    const parameterized = decideArtifactImagePayload(
      `data:image/png;charset=utf-8;base64,${PNG_BASE64}`,
    );
    expect(parameterized).toEqual({
      kind: 'write-base64',
      base64: PNG_BASE64,
      mimeType: 'image/png',
    });
  });

  it('data: 前缀只接受 data:image/，其余拒绝', () => {
    expect(decideArtifactImagePayload(`data:text/html;base64,${PNG_BASE64}`)).toEqual({
      kind: 'reject',
      reason: 'unsupported-data-uri',
    });
    expect(decideArtifactImagePayload('data:image/png;utf8,<svg />')).toEqual({
      kind: 'reject',
      reason: 'unsupported-data-uri',
    });
    expect(decideArtifactImagePayload(`data:image/png,${PNG_BASE64}`)).toEqual({
      kind: 'reject',
      reason: 'unsupported-data-uri',
    });
    expect(decideArtifactImagePayload('data:image/png')).toEqual({
      kind: 'reject',
      reason: 'unsupported-data-uri',
    });
  });

  it('data URI 内非法 base64 拒绝', () => {
    expect(decideArtifactImagePayload('data:image/png;base64,!!!broken!!!')).toEqual({
      kind: 'reject',
      reason: 'invalid-base64',
    });
  });

  it('裸 base64 应写盘：mime 回退 png / 采用 metadata mime', () => {
    expect(decideArtifactImagePayload(PNG_BASE64)).toEqual({
      kind: 'write-base64',
      base64: PNG_BASE64,
      mimeType: 'image/png',
    });
    expect(decideArtifactImagePayload(PNG_BASE64, 'image/jpeg')).toEqual({
      kind: 'write-base64',
      base64: PNG_BASE64,
      mimeType: 'image/jpeg',
    });
    expect(decideArtifactImagePayload(PNG_BASE64, 'application/pdf')).toEqual({
      kind: 'write-base64',
      base64: PNG_BASE64,
      mimeType: 'image/png',
    });
  });

  it('本地 file:// / content:// 地址可直接用', () => {
    expect(decideArtifactImagePayload('file:///data/user/0/app/cache/a.png', 'image/png')).toEqual({
      kind: 'direct-uri',
      uri: 'file:///data/user/0/app/cache/a.png',
      mimeType: 'image/png',
    });
    expect(decideArtifactImagePayload('content://media/external/images/1')).toEqual({
      kind: 'direct-uri',
      uri: 'content://media/external/images/1',
      mimeType: 'image/png',
    });
  });

  it('远端协议拒绝（取数层不做二次远端拉取）', () => {
    expect(decideArtifactImagePayload('https://example.com/a.png')).toEqual({
      kind: 'reject',
      reason: 'unsupported-uri-scheme',
    });
    expect(decideArtifactImagePayload('http://example.com/a.png')).toEqual({
      kind: 'reject',
      reason: 'unsupported-uri-scheme',
    });
  });

  it('拒绝原因都有中文文案', () => {
    const reasons = [
      'not-a-string',
      'empty-payload',
      'unsupported-data-uri',
      'invalid-base64',
      'unsupported-uri-scheme',
    ] as const;
    for (const reason of reasons) {
      expect(describeArtifactImageRejectReason(reason).length).toBeGreaterThan(0);
    }
  });
});

describe('deriveArtifactImageCacheKey', () => {
  it('稳定派生并归一网关地址', () => {
    expect(deriveArtifactImageCacheKey('http://10.0.0.2:3000', ' artifact-1 ')).toBe(
      'http://10.0.0.2:3000|artifact-1',
    );
    expect(deriveArtifactImageCacheKey('http://10.0.0.2:3000/', 'artifact-1')).toBe(
      'http://10.0.0.2:3000|artifact-1',
    );
  });

  it('artifactId 为空时返回 null（调用方据此不发请求）', () => {
    expect(deriveArtifactImageCacheKey('http://10.0.0.2:3000', '   ')).toBeNull();
  });

  it('不同网关的同一 artifactId 得到不同缓存键', () => {
    expect(deriveArtifactImageCacheKey('http://a:3000', 'artifact-1')).not.toBe(
      deriveArtifactImageCacheKey('http://b:3000', 'artifact-1'),
    );
  });
});

describe('sanitizeArtifactImageFileSegment / buildArtifactImageFileName', () => {
  it('路径穿越输入被安全化', () => {
    const segment = sanitizeArtifactImageFileSegment('../../etc/passwd');
    expect(segment).not.toContain('/');
    expect(segment).not.toContain('\\');
    expect(segment).not.toContain('..');
    expect(segment).toBe('etc-passwd');

    const windows = sanitizeArtifactImageFileSegment('..\\..\\windows\\system32');
    expect(windows).not.toContain('\\');
    expect(windows).not.toContain('..');
  });

  it('空串 / 纯分隔符回退为 artifact', () => {
    expect(sanitizeArtifactImageFileSegment('')).toBe('artifact');
    expect(sanitizeArtifactImageFileSegment('..')).toBe('artifact');
    expect(sanitizeArtifactImageFileSegment('///')).toBe('artifact');
  });

  it('文件名不含路径分隔符且不同 artifactId 不重名', () => {
    const first = buildArtifactImageFileName('http://a:3000|artifact-1', 'image/png');
    const second = buildArtifactImageFileName('http://a:3000|artifact-2', 'image/png');
    expect(first.startsWith('artifact-')).toBe(true);
    expect(first.endsWith('.png')).toBe(true);
    expect(first).not.toContain('/');
    expect(first).not.toBe(second);

    const traversal = buildArtifactImageFileName('http://a:3000|../../etc/passwd', 'image/png');
    expect(traversal).not.toContain('/');
    expect(traversal).not.toContain('..');
  });

  it('mime 映射扩展名：jpeg → jpg，svg+xml → svg', () => {
    expect(resolveArtifactImageFileExtension('image/jpeg')).toBe('jpg');
    expect(resolveArtifactImageFileExtension('image/svg+xml')).toBe('svg');
    expect(resolveArtifactImageFileExtension('image/webp')).toBe('webp');
    expect(resolveArtifactImageFileExtension('text/plain')).toBe('png');
  });

  it('超长 artifactId 片段被截断', () => {
    const segment = sanitizeArtifactImageFileSegment('a'.repeat(400));
    expect(segment.length).toBeLessThanOrEqual(ARTIFACT_IMAGE_FILE_SEGMENT_MAX_LENGTH);
  });
});

describe('尺寸派生', () => {
  it('从 metadata 派生宽高', () => {
    expect(deriveArtifactImageDimensions({ width: 1024, height: 768 })).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it('非法尺寸返回 null', () => {
    expect(deriveArtifactImageDimensions({ width: '1024', height: 768 })).toBeNull();
    expect(deriveArtifactImageDimensions({ width: 0, height: 768 })).toBeNull();
    expect(deriveArtifactImageDimensions({ width: 1024, height: -1 })).toBeNull();
    expect(deriveArtifactImageDimensions({ width: Number.NaN, height: 768 })).toBeNull();
    expect(deriveArtifactImageDimensions({ width: 1024 })).toBeNull();
    expect(deriveArtifactImageDimensions([1024, 768])).toBeNull();
    expect(deriveArtifactImageDimensions(null)).toBeNull();
  });

  it('metadata 尺寸优先，缺失时回退到探测结果', () => {
    expect(
      resolveArtifactImageDimensions({ width: 1024, height: 768 }, { width: 1, height: 1 }),
    ).toEqual({ width: 1024, height: 768 });
    expect(resolveArtifactImageDimensions(null, { width: 1, height: 1 })).toEqual({
      width: 1,
      height: 1,
    });
    expect(resolveArtifactImageDimensions(null, null)).toBeNull();
  });

  it('metadata 归一化 fileName / mimeType / dimensions', () => {
    expect(
      deriveArtifactImageMetadata({
        fileName: ' photo.png ',
        mimeType: 'IMAGE/PNG',
        width: 512,
        height: 512,
      }),
    ).toEqual({
      fileName: 'photo.png',
      mimeType: 'image/png',
      dimensions: { width: 512, height: 512 },
    });
    expect(deriveArtifactImageMetadata(undefined)).toEqual({
      fileName: null,
      mimeType: 'image/png',
      dimensions: null,
    });
  });
});

describe('ArtifactImageLruCache', () => {
  it('超出容量淘汰最旧条目', () => {
    const cache = new ArtifactImageLruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.keys()).toEqual(['b', 'c']);
    expect(cache.size).toBe(2);
    expect(cache.maxSize).toBe(2);
  });

  it('get 命中会刷新热度，最近访问的条目不被淘汰', () => {
    const cache = new ArtifactImageLruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.keys()).toEqual(['a', 'c']);
  });

  it('peek 不刷新热度；覆盖同 key 不增长；delete / clear 生效', () => {
    const cache = new ArtifactImageLruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.peek('a')).toBe(1);
    cache.set('a', 10);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.get('missing')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('容量被收敛为至少 1', () => {
    expect(new ArtifactImageLruCache<number>(0).maxSize).toBe(1);
    expect(new ArtifactImageLruCache<number>(Number.NaN).maxSize).toBe(1);
    expect(ARTIFACT_IMAGE_CACHE_CAPACITY).toBeGreaterThan(1);
  });
});

describe('ArtifactImageInFlight', () => {
  it('同一 key 的并发调用只发一次请求并共享结果', async () => {
    const registry = new ArtifactImageInFlight<string>();
    let calls = 0;
    const factory = async (): Promise<string> => {
      calls += 1;
      await Promise.resolve();
      return 'value';
    };
    const [first, second] = await Promise.all([
      registry.run('k', factory),
      registry.run('k', factory),
    ]);
    expect(calls).toBe(1);
    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(registry.size).toBe(0);
  });

  it('不同 key 各自请求', async () => {
    const registry = new ArtifactImageInFlight<number>();
    let calls = 0;
    const factory = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    await Promise.all([registry.run('a', factory), registry.run('b', factory)]);
    expect(calls).toBe(2);
  });

  it('失败后清理条目，下一次调用重新发起', async () => {
    const registry = new ArtifactImageInFlight<number>();
    let calls = 0;
    const factory = async (): Promise<number> => {
      calls += 1;
      if (calls === 1) {
        throw new Error('boom');
      }
      return 7;
    };
    await expect(registry.run('k', factory)).rejects.toThrow('boom');
    expect(registry.size).toBe(0);
    await expect(registry.run('k', factory)).resolves.toBe(7);
    expect(calls).toBe(2);
  });

  it('release 到 0 时中断共享请求，仍有消费者时不中断', async () => {
    const registry = new ArtifactImageInFlight<number>();
    const signals: AbortSignal[] = [];
    const factory = (signal: AbortSignal): Promise<number> => {
      signals.push(signal);
      return new Promise((resolve) => {
        setTimeout(() => resolve(1), 5);
      });
    };
    const first = registry.run('k', factory);
    const second = registry.run('k', factory);
    expect(registry.size).toBe(1);
    // factory 在微任务中执行（避免同步抛错逃逸出 run），先让出一次微任务。
    await Promise.resolve();
    expect(signals).toHaveLength(1);

    registry.release('k');
    expect(signals[0]?.aborted).toBe(false);
    registry.release('k');
    expect(signals[0]?.aborted).toBe(true);
    expect(registry.size).toBe(0);

    await Promise.all([first, second]);
  });
});

describe('ArtifactImageFailureTracker', () => {
  it('冷却窗口内禁止重试，窗口过后允许', () => {
    const tracker = new ArtifactImageFailureTracker(3, 30_000, 64);
    expect(tracker.canAttempt('k', 0)).toBe(true);
    tracker.recordFailure('k', '网络异常', 0);
    expect(tracker.get('k')).toEqual({ attempts: 1, lastFailedAt: 0, message: '网络异常' });
    expect(tracker.canAttempt('k', 10_000)).toBe(false);
    expect(tracker.canAttempt('k', 30_000)).toBe(true);
  });

  it('达到尝试上限后永久禁止自动重试，clear 后重置', () => {
    const tracker = new ArtifactImageFailureTracker(3, 30_000, 64);
    tracker.recordFailure('k', '失败', 0);
    tracker.recordFailure('k', '失败', 60_000);
    tracker.recordFailure('k', '失败', 120_000);
    expect(tracker.get('k')?.attempts).toBe(3);
    expect(tracker.canAttempt('k', 10_000_000)).toBe(false);
    tracker.clear('k');
    expect(tracker.canAttempt('k', 10_000_000)).toBe(true);
    expect(tracker.get('k')).toBeNull();
  });

  it('失败登记超过容量时淘汰最旧项', () => {
    const tracker = new ArtifactImageFailureTracker(3, 30_000, 2);
    tracker.recordFailure('a', '失败', 0);
    tracker.recordFailure('b', '失败', 1);
    tracker.recordFailure('c', '失败', 2);
    expect(tracker.size).toBe(2);
    expect(tracker.get('a')).toBeNull();
    expect(tracker.get('c')).not.toBeNull();
    tracker.clearAll();
    expect(tracker.size).toBe(0);
  });
});

describe('describeArtifactImageError', () => {
  it('Error / 字符串 / 带 message 对象 / 未知值都有可读文案', () => {
    expect(describeArtifactImageError(new Error('读取产物详情失败（HTTP 404）。'))).toBe(
      '读取产物详情失败（HTTP 404）。',
    );
    expect(describeArtifactImageError('network down')).toBe('network down');
    expect(describeArtifactImageError({ message: '网关不可用' })).toBe('网关不可用');
    expect(describeArtifactImageError(new Error('   '))).toBe('图片加载失败。');
    expect(describeArtifactImageError(undefined)).toBe('图片加载失败。');
    expect(describeArtifactImageError({ code: 500 })).toBe('图片加载失败。');
  });
});
