// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamFusionSuperbarSummary } from './TeamFusionSuperbarSummary.js';

afterEach(() => {
  cleanup();
});

describe('TeamFusionSuperbarSummary', () => {
  it('保留完整团队摘要并暴露紧凑布局需要的核心文案', () => {
    render(
      <TeamFusionSuperbarSummary
        description="团队运行中"
        footerLead="子树 5 / 层级 5"
        footerStats={[
          { label: '总', value: '5' },
          { label: '运行', value: '1' },
        ]}
      />,
    );

    const summary = screen.getByLabelText('团队运行摘要');
    const lead = screen.getByLabelText('子树 5 / 层级 5');
    const summaryText = summary.textContent?.replace(/\s+/g, ' ').trim();

    expect(lead.getAttribute('title')).toBe('子树 5 / 层级 5');
    expect(lead.textContent).toContain('层级 5');
    expect(summaryText).toContain('子树 5 / 层级 5');
    expect(screen.getByTitle('总 5')).toBeTruthy();
    expect(screen.getByTitle('运行 1')).toBeTruthy();
    expect(screen.getByTitle('团队运行中')).toBeTruthy();
  });
});
