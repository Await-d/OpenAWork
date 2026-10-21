/**
 * 回归：副本回收必须**吞掉**自己的失败。
 *
 * 回收的调用点都在「队列条目已经删除」之后（DELETE 单条 / 清空 / 会话删除），此时抛错
 * 会让 HTTP 响应变成 500——客户端据此认为删除失败并把条目放回本地队列，而服务端记录
 * 已经不存在，两边状态就此分叉。索引落盘（`persistArtifacts`）在磁盘满 / 无写权限时会
 * 抛，故该路径必须被兜住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposerQueueAttachment } from '../../session/composer-queue-store.js';

const mocks = vi.hoisted(() => ({
  removeMany: vi.fn<(artifactIds: Iterable<string>) => number>(),
}));

vi.mock('../../infra/artifact-manager.js', () => ({
  getGatewayArtifactManager: () => ({ removeMany: mocks.removeMany }),
}));

const { purgeComposerQueueAttachments } =
  await import('../../session/composer-queue-artifact-purge.js');

function attachment(artifactId?: string): ComposerQueueAttachment {
  return {
    ...(artifactId ? { artifactId } : {}),
    id: 'att-1',
    name: '截图.png',
    sizeBytes: 3,
    type: 'image',
  };
}

beforeEach(() => {
  mocks.removeMany.mockReset();
});

describe('purgeComposerQueueAttachments', () => {
  it('索引落盘失败时吞掉错误并返回 0（调用方的删除结果不受影响）', () => {
    mocks.removeMany.mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    let removed = -1;
    expect(() => {
      removed = purgeComposerQueueAttachments([attachment('artifact-1')]);
    }).not.toThrow();
    expect(removed).toBe(0);
  });

  it('把同一批副本 id 一次性交给批量删除（单次落盘）', () => {
    mocks.removeMany.mockReturnValueOnce(2);

    const removed = purgeComposerQueueAttachments([
      attachment('artifact-1'),
      attachment('artifact-2'),
      // 重复引用（同一条目里两个附件指向同一副本）只删一次。
      attachment('artifact-1'),
    ]);

    expect(removed).toBe(2);
    const [artifactIds] = mocks.removeMany.mock.calls[0] ?? [];
    expect([...(artifactIds ?? [])]).toEqual(['artifact-1', 'artifact-2']);
  });

  it('条目没有 artifactId（未上传 / 旧数据）时不触碰产物管理器', () => {
    const removed = purgeComposerQueueAttachments([attachment(), attachment()]);

    expect(removed).toBe(0);
    expect(mocks.removeMany).not.toHaveBeenCalled();
  });
});
