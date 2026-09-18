/**
 * Hermetic coverage for the shell-profile allowlist.
 *
 * These tests never touch the real filesystem: every probe (`readTextFile`,
 * `fileExists`, `commandExists`, `isExecutable`) is injected, so the suite is
 * independent of which shells happen to be installed on the CI host.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidShellProfileError,
  __resetShellProfilesCacheForTest,
  detectShellProfiles,
  listPublicShellProfiles,
  resolveShellForSpawn,
  resolveShellProfile,
  shellArgsForProfile,
  shellProfileLabelForId,
  type ShellProfileDetectionDeps,
} from '../../session/shell-profiles.js';

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';

beforeEach(() => {
  __resetShellProfilesCacheForTest();
});

describe('detectShellProfiles — POSIX', () => {
  it('解析 /etc/shells、跳过注释与空行、按 basename 去重、并纳入 env.SHELL', () => {
    const deps: ShellProfileDetectionDeps = {
      readTextFile: (filePath) =>
        filePath === '/etc/shells' ? '# comment\n\n/bin/bash\n/bin/zsh\n/nonexistent/shell\n' : '',
      fileExists: (candidate) =>
        ['/opt/custom/myshell', '/bin/bash', '/bin/zsh'].includes(candidate),
    };

    const profiles = detectShellProfiles('linux', { SHELL: '/opt/custom/myshell' }, deps);

    // env.SHELL 优先，其次 /etc/shells 顺序；/usr/bin/bash 与 /bin/bash 去重只保留首个。
    expect(profiles.map((profile) => profile.id)).toEqual(['myshell', 'bash', 'zsh']);
    expect(profiles.map((profile) => profile.shell)).toEqual([
      '/opt/custom/myshell',
      '/bin/bash',
      '/bin/zsh',
    ]);
    expect(profiles.map((profile) => profile.label)).toEqual(['Myshell', 'Bash', 'Zsh']);
    expect(profiles.every((profile) => profile.isPowerShell === false)).toBe(true);
  });

  it('丢弃不存在的 env.SHELL，只保留真实存在的 well-known shell', () => {
    const deps: ShellProfileDetectionDeps = {
      readTextFile: () => '',
      fileExists: (candidate) => candidate === '/bin/bash',
    };

    const profiles = detectShellProfiles('linux', { SHELL: '/opt/missing/zsh' }, deps);

    expect(profiles.map((profile) => profile.id)).toEqual(['bash']);
  });
});

describe('detectShellProfiles — win32', () => {
  it('探测 pwsh.exe / powershell.exe，并通过 ComSpec 纳入 cmd.exe', () => {
    const deps: ShellProfileDetectionDeps = {
      commandExists: (command) => command === 'pwsh.exe' || command === 'powershell.exe',
      fileExists: (candidate) => candidate === COMSPEC,
    };

    const profiles = detectShellProfiles('win32', { ComSpec: COMSPEC }, deps);

    expect(profiles.map((profile) => profile.id)).toEqual([
      'pwsh.exe',
      'powershell.exe',
      'cmd.exe',
    ]);
    expect(profiles.find((profile) => profile.id === 'pwsh.exe')?.isPowerShell).toBe(true);
    expect(profiles.find((profile) => profile.id === 'cmd.exe')?.isPowerShell).toBe(false);
    expect(profiles.find((profile) => profile.id === 'cmd.exe')?.shell).toBe(COMSPEC);
  });
});

describe('listPublicShellProfiles', () => {
  it('标记与当前默认 shell 选择一致的 profile 为 default', () => {
    const deps: ShellProfileDetectionDeps = {
      readTextFile: () => '',
      fileExists: (candidate) => candidate === '/bin/bash' || candidate === '/bin/zsh',
    };

    const publicProfiles = listPublicShellProfiles('linux', {}, deps);

    expect(publicProfiles.find((profile) => profile.isDefault)?.id).toBe('bash');
    expect(publicProfiles.filter((profile) => profile.isDefault)).toHaveLength(1);
    for (const profile of publicProfiles) {
      expect(Object.keys(profile).sort()).toEqual(['id', 'isDefault', 'label']);
    }
  });

  it('公共载荷绝不包含文件系统路径', () => {
    const deps: ShellProfileDetectionDeps = {
      readTextFile: () => '/bin/bash\n',
      fileExists: (candidate) =>
        ['/bin/bash', '/bin/zsh', '/opt/secret/internal-tool'].includes(candidate),
    };

    const publicProfiles = listPublicShellProfiles(
      'linux',
      { SHELL: '/opt/secret/internal-tool' },
      deps,
    );
    const serialized = JSON.stringify(publicProfiles);

    expect(serialized).not.toContain('/');
    expect(serialized).not.toContain('\\');
  });
});

describe('resolveShellProfile', () => {
  const deps: ShellProfileDetectionDeps = {
    readTextFile: () => '/bin/bash\n',
    fileExists: (candidate) => candidate === '/bin/bash',
  };

  it('按不透明 id 解析到服务端 shell 路径', () => {
    const profile = resolveShellProfile('bash', 'linux', {}, deps);
    expect(profile?.shell).toBe('/bin/bash');
    expect(profile?.isPowerShell).toBe(false);
  });

  it('拒绝路径形态或未知 id（客户端输入从不被当作路径解析）', () => {
    expect(resolveShellProfile('/bin/bash', 'linux', {}, deps)).toBeUndefined();
    expect(resolveShellProfile('/bin/evil', 'linux', {}, deps)).toBeUndefined();
    expect(resolveShellProfile('definitely-not-real', 'linux', {}, deps)).toBeUndefined();
  });
});

describe('resolveShellForSpawn', () => {
  const defaultShell = { defaultShell: '/bin/bash', defaultArgs: ['-i'] };

  it('未提供 id 时返回运行时默认 shell，行为不变', () => {
    const resolution = resolveShellForSpawn({ platform: 'linux', env: {}, ...defaultShell });
    expect(resolution).toEqual({ shell: '/bin/bash', args: ['-i'] });
  });

  it('提供合法 id 时返回 allowlist 解析出的可执行文件与默认 argv', () => {
    const deps: ShellProfileDetectionDeps = {
      readTextFile: () => '/bin/zsh\n',
      fileExists: () => true,
      isExecutable: () => true,
    };

    const resolution = resolveShellForSpawn({
      shellProfileId: 'zsh',
      platform: 'linux',
      env: {},
      deps,
      ...defaultShell,
    });

    expect(resolution.shell).toBe('/bin/zsh');
    expect(resolution.args).toEqual(['-i']);
    expect(resolution.shellProfileId).toBe('zsh');
  });

  it('未知 id 抛出 typed error，绝不 spawn(由路由映射为 400)', () => {
    const deps: ShellProfileDetectionDeps = {
      readTextFile: () => '/bin/zsh\n',
      fileExists: () => true,
      isExecutable: () => true,
    };

    expect(() =>
      resolveShellForSpawn({
        shellProfileId: '/bin/evil',
        platform: 'linux',
        env: {},
        deps,
        ...defaultShell,
      }),
    ).toThrow(InvalidShellProfileError);
  });

  it('allowlist 命中但可执行文件已消失时回退默认并触发告警回调', () => {
    let fallback: { requestedId: string; missingShell: string } | undefined;
    const deps: ShellProfileDetectionDeps = {
      readTextFile: () => '/bin/zsh\n',
      fileExists: () => true,
      isExecutable: () => false,
    };

    const resolution = resolveShellForSpawn({
      shellProfileId: 'zsh',
      platform: 'linux',
      env: {},
      deps,
      ...defaultShell,
      onFallback: (details) => {
        fallback = details;
      },
    });

    expect(resolution).toEqual({ shell: '/bin/bash', args: ['-i'] });
    expect(fallback).toEqual({ requestedId: 'zsh', missingShell: '/bin/zsh' });
  });
});

describe('server-defined argv and labels', () => {
  it('argv 完全由服务端定义（客户端无法注入额外参数）', () => {
    expect(shellArgsForProfile({ isPowerShell: true })).toEqual(['-NoLogo', '-NoProfile']);
    expect(shellArgsForProfile({ isPowerShell: false })).toEqual(['-i']);
  });

  it('已知 shell 使用人类可读 label，未知 id 回退首字母大写', () => {
    expect(shellProfileLabelForId('pwsh.exe')).toBe('PowerShell');
    expect(shellProfileLabelForId('cmd.exe')).toBe('Command Prompt');
    expect(shellProfileLabelForId('myshell')).toBe('Myshell');
  });
});
