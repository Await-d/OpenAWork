// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { AttachmentItem } from '@openAwork/shared-ui';
import { buildAttachmentFileMap } from './use-composer-queue.js';

function makeItem(id: string): AttachmentItem {
  return { id, name: `${id}.png`, type: 'image', sizeBytes: 4 };
}

function makeFile(name: string): File {
  return new File(['data'], name, { type: 'image/png' });
}

describe('buildAttachmentFileMap', () => {
  it('按 id 关联同序的条目与文件', () => {
    const items = [makeItem('a'), makeItem('b')];
    const files = [makeFile('a.png'), makeFile('b.png')];

    const map = buildAttachmentFileMap(items, files);

    expect(map.get('a')?.name).toBe('a.png');
    expect(map.get('b')?.name).toBe('b.png');
    expect(map.size).toBe(2);
  });

  it('文件数少于条目时只映射已存在的部分，不产生错位', () => {
    const items = [makeItem('a'), makeItem('b')];
    const files = [makeFile('a.png')];

    const map = buildAttachmentFileMap(items, files);

    expect(map.get('a')?.name).toBe('a.png');
    expect(map.has('b')).toBe(false);
  });

  it('条目为空时返回空映射', () => {
    expect(buildAttachmentFileMap([], []).size).toBe(0);
  });
});
