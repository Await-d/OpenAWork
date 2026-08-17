import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSkillsPaths } from './agentskills-paths.js';
import { createPlatformAdapter } from './platform-adapter.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('platform-adapter android defaults', () => {
  it('在未显式提供 ANDROID_PACKAGE 时回退到移动端真实包名', () => {
    vi.stubEnv('ANDROID_ROOT', '/system');
    vi.stubEnv('ANDROID_PACKAGE', '');

    const adapter = createPlatformAdapter();

    expect(adapter.getPlatform()).toBe('android');
    expect(adapter.getConfigDir()).toBe('/data/data/com.openAwork.mobile/files/config');
    expect(adapter.getDataDir()).toBe('/data/data/com.openAwork.mobile/files/data');
    expect(adapter.getTempDir()).toBe('/data/data/com.openAwork.mobile/cache');
    expect(adapter.getSkillsDir()).toBe('/data/data/com.openAwork.mobile/files/config/skills');
  });

  it('技能目录默认落到同一个 Android 包名下', () => {
    vi.stubEnv('ANDROID_ROOT', '/system');
    vi.stubEnv('ANDROID_PACKAGE', '');

    const paths = resolveSkillsPaths('android');

    expect(paths.skillsPaths).toContain('/data/data/com.openAwork.mobile/files/config/skills');
  });
});
