// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 320 180"><text>d</text></svg>' })),
  },
}));

import { CollapsibleAssistantContent } from './collapsible-assistant-content.js';
import { parseSubagentResultBlocks } from '@openAwork/shared';
import type { SubagentResultSection } from '@openAwork/shared';

const EXPLORE_RESULTS = `<results>
<files>
- /abs/path/to/file1.ts — 状态机核心实现
</files>

<answer>
状态机在 file1.ts 中定义。
</answer>

<next_steps>
- 先读 transition 函数
</next_steps>
</results>`;

/** 把 1600 字符的纯文本正文推过 1500 字符折叠阈值。 */
const LONG_FILLER = Array.from(
  { length: 80 },
  (_, index) => `正文段落 ${index + 1}：用于把正文推过 1500 字符阈值。`,
).join('\n\n');

function buildSections(content: string): readonly SubagentResultSection[] {
  return parseSubagentResultBlocks(content);
}

afterEach(cleanup);

describe('CollapsibleAssistantContent 的子代理结果豁免', () => {
  it('带可见 <results> 结果节时不做消息级折叠（即使正文超长）', () => {
    const content = `${LONG_FILLER}\n\n${EXPLORE_RESULTS}`;
    const sections = buildSections(content);

    render(
      <CollapsibleAssistantContent content={content} messageId="m-1">
        <div>{sections.length > 0 ? 'content-rendered' : 'empty'}</div>
      </CollapsibleAssistantContent>,
    );

    expect(screen.queryByText(/展开全部 ·/)).toBeNull();
    expect(screen.getByText('content-rendered')).toBeTruthy();
  });

  it('results 块剥壳后无可见正文（空块）时仍按普通长文折叠', () => {
    const content = `${LONG_FILLER}\n\n<results>\n</results>`;

    render(
      <CollapsibleAssistantContent content={content} messageId="m-2">
        <div>content-rendered</div>
      </CollapsibleAssistantContent>,
    );

    expect(screen.getByText(/展开全部 ·/)).toBeTruthy();
  });

  it('无 <results> 的普通长文仍折叠', () => {
    render(
      <CollapsibleAssistantContent content={LONG_FILLER} messageId="m-3">
        <div>content-rendered</div>
      </CollapsibleAssistantContent>,
    );

    expect(screen.getByText(/展开全部 ·/)).toBeTruthy();
  });

  it('短正文 + <results> 结果节：无折叠控件（本来就不折叠）', () => {
    render(
      <CollapsibleAssistantContent content={EXPLORE_RESULTS} messageId="m-4">
        <div>content-rendered</div>
      </CollapsibleAssistantContent>,
    );

    expect(screen.queryByText(/展开全部/)).toBeNull();
    expect(screen.getByText('content-rendered')).toBeTruthy();
  });
});
