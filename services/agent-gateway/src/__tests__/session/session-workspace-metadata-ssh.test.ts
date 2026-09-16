import { describe, expect, it } from 'vitest';
import {
  extractSessionSshConnectionId,
  mergeSessionMetadataForUpdate,
  normalizeIncomingSessionMetadata,
  normalizePersistedSessionMetadata,
  normalizeSshRemoteWorkingDirectory,
  validateSessionMetadataPatch,
} from '../../session/session-workspace-metadata.js';

describe('SSH 远程工作区元数据', () => {
  it('元数据 patch 接受 sshConnectionId 字段（strict 白名单内）', () => {
    const result = validateSessionMetadataPatch({ sshConnectionId: 'conn-1' });
    expect(result.success).toBe(true);

    const rejected = validateSessionMetadataPatch({ sshConnection: 'conn-1' });
    expect(rejected.success).toBe(false);
  });

  it('extractSessionSshConnectionId 仅接受非空字符串', () => {
    expect(extractSessionSshConnectionId({ sshConnectionId: 'c1' })).toBe('c1');
    expect(extractSessionSshConnectionId({ sshConnectionId: '   ' })).toBeNull();
    expect(extractSessionSshConnectionId({ sshConnectionId: 42 })).toBeNull();
    expect(extractSessionSshConnectionId({})).toBeNull();
  });

  it('normalizeSshRemoteWorkingDirectory 归一化远端绝对路径', () => {
    expect(normalizeSshRemoteWorkingDirectory('/srv/app/')).toBe('/srv/app');
    expect(normalizeSshRemoteWorkingDirectory('/srv/./a/../b')).toBe('/srv/b');
    expect(normalizeSshRemoteWorkingDirectory('  /srv/app  ')).toBe('/srv/app');
    expect(normalizeSshRemoteWorkingDirectory('/')).toBe('/');
    expect(normalizeSshRemoteWorkingDirectory('relative/path')).toBeNull();
    expect(normalizeSshRemoteWorkingDirectory('')).toBeNull();
  });

  it('SSH 会话的远端绝对路径可写入并被归一化', () => {
    const result = normalizeIncomingSessionMetadata({
      sshConnectionId: 'conn-1',
      workingDirectory: '/srv/app/',
    });
    expect(result.workingDirectory).toBe('/srv/app');
    expect(result.metadata['workingDirectory']).toBe('/srv/app');
  });

  it('SSH 会话的相对路径按非法处理（返回 null 触发 403 路径）', () => {
    const result = normalizeIncomingSessionMetadata({
      sshConnectionId: 'conn-1',
      workingDirectory: 'srv/app',
    });
    expect(result.workingDirectory).toBeNull();
  });

  it('非 SSH 会话的相对路径按本地语义拒绝', () => {
    const result = normalizeIncomingSessionMetadata({ workingDirectory: 'relative-workdir' });
    expect(result.workingDirectory).toBeNull();
  });

  it('持久化读取路径对 SSH 会话保留远端路径，非法时删除字段', () => {
    const kept = normalizePersistedSessionMetadata({
      sshConnectionId: 'conn-1',
      workingDirectory: '/srv/app/',
    });
    expect(kept['workingDirectory']).toBe('/srv/app');

    const dropped = normalizePersistedSessionMetadata({
      sshConnectionId: 'conn-1',
      workingDirectory: 'not-absolute',
    });
    expect('workingDirectory' in dropped).toBe(false);
  });

  it('更新合并时保留 SSH 会话的远端目录与连接 id', () => {
    const merged = mergeSessionMetadataForUpdate(
      { sshConnectionId: 'conn-1', workingDirectory: '/srv/app' },
      { modelId: 'gpt-x' },
    );
    expect(merged.workingDirectory).toBe('/srv/app');
    expect(merged.metadata['sshConnectionId']).toBe('conn-1');
    expect(merged.metadata['modelId']).toBe('gpt-x');
  });

  it('SSH 会话允许通过合并切换远端目录（不被本地 root 语义拦截）', () => {
    const merged = mergeSessionMetadataForUpdate(
      { sshConnectionId: 'conn-1', workingDirectory: '/srv/app' },
      { workingDirectory: '/opt/other-project' },
    );
    expect(merged.workingDirectory).toBe('/opt/other-project');
  });

  it('元数据 patch 接受 sshConnectionId: null（显式清除绑定）', () => {
    const result = validateSessionMetadataPatch({ sshConnectionId: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data['sshConnectionId']).toBeNull();
    }
  });

  it('显式清除 SSH 绑定后，workingDirectory 回到本地语义', () => {
    const merged = mergeSessionMetadataForUpdate(
      { sshConnectionId: 'conn-1', workingDirectory: '/srv/app' },
      { sshConnectionId: null, workingDirectory: 'relative-path' },
    );
    expect(extractSessionSshConnectionId(merged.metadata)).toBeNull();
    // 相对路径在本地语义下非法 → 清空（触发上层 403 引导用户给出合法本地路径）。
    expect(merged.workingDirectory).toBeNull();
  });
});
