// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebArtifactPlatformAdapter } from './artifact-platform-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWebArtifactPlatformAdapter', () => {
  it('openPath 对本地路径返回中文错误', async () => {
    const adapter = createWebArtifactPlatformAdapter();

    await expect(adapter.openPath('/tmp/demo.txt')).rejects.toThrow(
      '当前 Web 环境不支持直接打开本地文件路径。',
    );
  });
});
