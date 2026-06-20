import { describe, expect, it } from 'vitest';
import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';
import type { HandoffEntry, LayerNode } from '../../../../../stores/team/team-events.js';
import {
  buildLayerConversationRows,
  canPreviewTeamLayerPrompt,
  filterLayerConversationRows,
  resolveLayerConversationRootId,
} from './layered-conversation-model.js';

function session(
  id: string,
  parentSessionId: string | null,
  roleLayer: string | null,
): TeamRuntimeSessionRecord {
  return {
    id,
    metadataJson: '{}',
    parentSessionId,
    roleLayer,
    stateStatus: 'completed',
    title: id,
    updatedAt: `2026-06-06T10:0${Math.min(id.length, 9)}:00.000Z`,
    workspacePath: '/work',
  };
}

function handoff(id: string, fromSessionId: string, toSessionId: string): HandoffEntry {
  return {
    fromRoleLayer: 'pm1',
    fromSessionId,
    id,
    sessionId: toSessionId,
    state: 'completed',
    toRoleLayer: 'executor',
    toSessionId,
    updatedAt: Date.parse('2026-06-06T10:20:00.000Z'),
  };
}

function node(
  sessionId: string,
  parentSessionId: string | null,
  roleLayer: LayerNode['roleLayer'],
): LayerNode {
  return {
    parentSessionId,
    roleLayer,
    sessionId,
    state: 'completed',
  };
}

describe('layered-conversation-model', () => {
  it('选中子层级时解析到根会话，并展示整棵历史子树', () => {
    const sessions = [
      session('root', null, 'reception'),
      session('pm1', 'root', 'pm1'),
      session('executor-a', 'pm1', 'executor'),
      session('reviewer-a', 'pm1', 'reviewer'),
      session('other-root', null, 'reception'),
    ];

    expect(
      resolveLayerConversationRootId({ nodes: [], selectedSessionId: 'executor-a', sessions }),
    ).toBe('root');

    const rows = buildLayerConversationRows({
      handoffs: [handoff('handoff-exec', 'pm1', 'executor-a')],
      nodes: [],
      selectedSessionId: 'executor-a',
      sessions,
    });

    expect(rows.map((row) => row.sessionId)).toEqual(['root', 'pm1', 'executor-a', 'reviewer-a']);
    expect(rows.some((row) => row.sessionId === 'other-root')).toBe(false);
  });

  it('按层级筛选时命中 session fallback 行', () => {
    const rows = buildLayerConversationRows({
      handoffs: [],
      nodes: [],
      selectedSessionId: 'root',
      sessions: [session('root', null, 'reception'), session('pm1', 'root', 'pm1')],
    });

    expect(filterLayerConversationRows(rows, 'pm1').map((row) => row.sessionId)).toEqual(['pm1']);
  });

  it('runtime 快照缺少父级时，使用 layer node 父级关系回溯根会话', () => {
    const sessions = [
      session('root', null, 'reception'),
      session('pm1', null, 'pm1'),
      session('executor-a', null, 'executor'),
      session('other-root', null, 'reception'),
    ];

    const nodes = [node('pm1', 'root', 'pm1'), node('executor-a', 'pm1', 'executor')];

    expect(
      resolveLayerConversationRootId({ nodes, selectedSessionId: 'executor-a', sessions }),
    ).toBe('root');

    const rows = buildLayerConversationRows({
      handoffs: [],
      nodes,
      selectedSessionId: 'executor-a',
      sessions,
    });

    expect(rows.map((row) => row.sessionId)).toEqual(['root', 'pm1', 'executor-a']);
    expect(rows.some((row) => row.sessionId === 'other-root')).toBe(false);
  });

  it('handoff 缺少 toSessionId 且 sessionId 指向上游时，反查目标层子会话', () => {
    const rows = buildLayerConversationRows({
      handoffs: [
        {
          fromRoleLayer: 'reception',
          fromSessionId: 'root',
          id: 'handoff-with-upstream-session',
          sessionId: 'root',
          state: 'completed',
          summary: '接待交给 PM1',
          toRoleLayer: 'pm1',
          updatedAt: Date.parse('2026-06-06T10:20:00.000Z'),
        },
      ],
      nodes: [],
      selectedSessionId: 'root',
      sessions: [session('root', null, 'reception'), session('pm1', 'root', 'pm1')],
    });

    const pm1Row = rows.find((row) => row.roleLayer === 'pm1');
    expect(pm1Row?.sessionId).toBe('pm1');
    expect(pm1Row?.source).toBe('handoff');
    expect(pm1Row?.detail).toBe('接待交给 PM1');
  });

  it('同一 session 被多轮 handoff 复用时，累计 handoffCount', () => {
    const rows = buildLayerConversationRows({
      handoffs: [
        {
          fromRoleLayer: 'reception',
          fromSessionId: 'root',
          id: 'handoff-round-1',
          sessionId: 'pm1',
          state: 'completed',
          summary: '第一轮',
          toRoleLayer: 'pm1',
          toSessionId: 'pm1',
          updatedAt: Date.parse('2026-06-06T10:10:00.000Z'),
        },
        {
          fromRoleLayer: 'reception',
          fromSessionId: 'root',
          id: 'handoff-round-2',
          sessionId: 'pm1',
          state: 'completed',
          summary: '第二轮',
          toRoleLayer: 'pm1',
          toSessionId: 'pm1',
          updatedAt: Date.parse('2026-06-06T10:20:00.000Z'),
        },
      ],
      nodes: [],
      selectedSessionId: 'root',
      sessions: [session('root', null, 'reception'), session('pm1', 'root', 'pm1')],
    });

    const pm1Row = rows.find((row) => row.sessionId === 'pm1');
    expect(pm1Row?.handoffCount).toBe(2);
    expect(pm1Row?.detail).toBe('第二轮');
  });

  it('只为有独立 SOUL 的层级提供角色提示词预览', () => {
    expect(canPreviewTeamLayerPrompt('reception')).toBe(true);
    expect(canPreviewTeamLayerPrompt('pm1')).toBe(true);
    expect(canPreviewTeamLayerPrompt('pm2')).toBe(true);
    expect(canPreviewTeamLayerPrompt('executor')).toBe(true);
    expect(canPreviewTeamLayerPrompt('reviewer')).toBe(true);
    expect(canPreviewTeamLayerPrompt('user')).toBe(false);
    expect(canPreviewTeamLayerPrompt('tester')).toBe(false);
  });
});
