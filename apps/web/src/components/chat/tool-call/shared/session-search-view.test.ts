import { describe, expect, it } from 'vitest';

import { parseSessionSearchHits } from './session-search-view.js';

const OUTPUT = [
  'Found 2 matches:',
  '',
  '[ses_a] Message msg_1 (user)',
  '这里出现了关键词 build pipeline',
  '',
  '[ses_b] Message msg_2 (assistant)',
  '另一条包含 build pipeline 的片段',
].join('\n');

describe('parseSessionSearchHits', () => {
  it('解析匹配条目的会话 / 消息 / 角色 / 片段', () => {
    const hits = parseSessionSearchHits(OUTPUT);

    expect(hits).toHaveLength(2);
    expect(hits?.[0]).toEqual({
      sessionId: 'ses_a',
      messageId: 'msg_1',
      role: 'user',
      snippet: '这里出现了关键词 build pipeline',
    });
    expect(hits?.[1]?.role).toBe('assistant');
  });

  it('无匹配返回空数组（渲染空态）', () => {
    expect(parseSessionSearchHits('No matches found.')).toEqual([]);
  });

  it('非该格式返回 null（回退文本）', () => {
    expect(parseSessionSearchHits('random text')).toBeNull();
    expect(parseSessionSearchHits('')).toBeNull();
    expect(parseSessionSearchHits({ hits: [] })).toBeNull();
  });

  it('片段跨多行时合并为一行', () => {
    const hits = parseSessionSearchHits(
      ['Found 1 matches:', '', '[ses_a] Message msg_1 (user)', 'line one', 'line two'].join('\n'),
    );

    expect(hits?.[0]?.snippet).toBe('line one line two');
  });
});
