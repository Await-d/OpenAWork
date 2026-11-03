import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 格式契约测试：锁死上游 `attachment-upload.ts` 的写入模板与包裹段。
 *
 * 解析端（`attachment-reference.ts`）依赖两件事：
 * 1. 附件行形如 `- <fileName> (artifact:<artifactId>)`
 * 2. 这些行被包在 `[附件]` 段里，由 `appendAttachmentSummary` 追加到正文末尾
 *
 * 任一上游格式被改动，本测试必须失败，否则引用解析会静默失效（降级为纯文本）。
 */
function readWebSource(relativePath: string): string {
  // vitest 的 root / cwd 是 apps/web（vitest.config.ts 所在目录）。
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('附件引用格式契约', () => {
  const uploadSource = readWebSource(
    'src/components/conversation-runtime/attachments/attachment-upload.ts',
  );

  it('上游写入模板保留 `- ${` 与 `(artifact:${`', () => {
    expect(uploadSource).toContain('- ${');
    expect(uploadSource).toContain('(artifact:${');
  });

  it('上游确实在 buildUploadedAttachmentSummaryLine 内拼装该行', () => {
    const functionStart = uploadSource.indexOf(
      'export function buildUploadedAttachmentSummaryLine',
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);

    const bodyChunk = uploadSource.slice(functionStart, functionStart + 400);
    expect(bodyChunk).toContain('(artifact:${');
  });

  it('上游用 `[附件]` 段包裹引用行', () => {
    expect(uploadSource).toContain('[附件]');
    expect(uploadSource).toContain('buildAttachmentSummary');
    expect(uploadSource).toContain('appendAttachmentSummary');
  });
});
