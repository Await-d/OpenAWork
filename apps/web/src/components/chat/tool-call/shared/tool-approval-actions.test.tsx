import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToolApprovalActions } from './tool-approval-actions.js';

describe('ToolApprovalActions', () => {
  it('renders three selectable permission scope modes before approval actions', () => {
    const html = renderToStaticMarkup(
      <ToolApprovalActions
        approvalActions={{
          items: [
            {
              id: 'session',
              label: '本会话允许',
              onClick: vi.fn(),
              primary: true,
            },
          ],
          onSelectScopeLevel: vi.fn(),
          scopeLevels: [
            {
              category: 'full',
              description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
              label: '仅本次指令',
              pattern: 'npm run build -- --watch',
            },
            {
              category: 'partial',
              description: '覆盖网关提供的相同子命令模式。',
              label: '同子命令',
              pattern: 'npm run *',
            },
            {
              category: 'base',
              description: '覆盖网关提供的同类指令模式。',
              label: '同类指令',
              pattern: 'npm *',
            },
          ],
          selectedScopeCategory: 'partial',
          selectedScopePattern: 'npm run *',
        }}
      />,
    );

    expect(html).toContain('aria-label="审批范围"');
    expect(html).toContain('仅本次指令');
    expect(html).toContain('同子命令');
    expect(html).toContain('同类指令');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('本会话允许');
  });
});
