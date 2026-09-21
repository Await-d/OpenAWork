import * as os from 'node:os';
import * as path from 'node:path';
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
    expect(adapter.getDocumentsDir()).toBe('/data/data/com.openAwork.mobile/files/data');
  });

  it('技能目录默认落到同一个 Android 包名下', () => {
    vi.stubEnv('ANDROID_ROOT', '/system');
    vi.stubEnv('ANDROID_PACKAGE', '');

    const paths = resolveSkillsPaths('android');

    expect(paths.skillsPaths).toContain('/data/data/com.openAwork.mobile/files/config/skills');
  });
});

describe('platform-adapter documents dir', () => {
  it('非 android 平台默认回退到用户主目录下的 Documents', () => {
    vi.stubEnv('ANDROID_ROOT', undefined);
    vi.stubEnv('ANDROID_DATA', undefined);
    vi.stubEnv('XDG_DOCUMENTS_DIR', undefined);

    const adapter = createPlatformAdapter();

    expect(adapter.getDocumentsDir()).toBe(path.join(os.homedir(), 'Documents'));
  });

  it('XDG_DOCUMENTS_DIR 显式覆盖默认文档目录', () => {
    vi.stubEnv('ANDROID_ROOT', undefined);
    vi.stubEnv('ANDROID_DATA', undefined);
    vi.stubEnv('XDG_DOCUMENTS_DIR', '/tmp/docs');

    expect(createPlatformAdapter().getDocumentsDir()).toBe('/tmp/docs');
  });
});
