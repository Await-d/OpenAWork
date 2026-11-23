import { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryProposal } from '@openAwork/web-client';

vi.mock('react-native', () => ({
  View: ({ children }: PropsWithChildren) => createElement('div', null, children),
  Text: ({ children }: PropsWithChildren) => createElement('span', null, children),
}));
import { MemoryApprovalPayload } from './MemoryApprovalPayload';

const proposal: MemoryProposal = {
  id: 'p1',
  userId: 'owner',
  action: 'update',
  scope: { type: 'team', id: 'team-1' },
  targetMemoryId: 'm1',
  expectedRevision: 4,
  payload: {
    key: 'runtime',
    value: 'bun',
    enabled: false,
    roleLayers: ['executor'],
    priority: 0,
    type: 'instruction',
    workspaceRoot: '/project',
    teamWorkspaceId: 'team-1',
    confidence: 0.8,
  },
  payloadDigest: 'digest',
  reason: 'review',
  origin: 'maintenance',
  confidence: 1,
  status: 'pending',
  createdAt: '',
  expiresAt: null,
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  resultMemoryId: null,
  revision: 2,
};

describe('移动端完整批准载荷', () => {
  it('显示false、零值、角色层和工作区等全部实际字段以及目标版本', () => {
    const html = renderToStaticMarkup(createElement(MemoryApprovalPayload, { proposal }));
    const serialized = html.replace(/&quot;/g, '"');
    for (const key of Object.keys(proposal.payload)) expect(serialized).toContain(`"${key}":`);
    expect(serialized).toContain('"enabled": false');
    expect(serialized).toContain('"priority": 0');
    expect(serialized).toContain('executor');
    expect(serialized).toContain('/project');
    expect(serialized).toContain('预期目标版本：4');
    expect(serialized).toContain('目标条目：m1');
  });
  it('规则载荷同样完整展示，null不丢失', () => {
    const rule = {
      ...proposal,
      action: 'rule' as const,
      targetMemoryId: null,
      expectedRevision: null,
      payload: { name: '代码规则', body: '采用类型导入', enabled: false, workspaceRoot: null },
    };
    const html = renderToStaticMarkup(createElement(MemoryApprovalPayload, { proposal: rule }));
    expect(html).toContain('代码规则');
    expect(html).toContain('采用类型导入');
    expect(html).toContain('&quot;enabled&quot;: false');
    expect(html).toContain('&quot;workspaceRoot&quot;: null');
    expect(html).toContain('新增条目');
  });
});
