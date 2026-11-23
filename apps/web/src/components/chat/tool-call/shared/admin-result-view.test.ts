import { describe, expect, it } from 'vitest';

import {
  buildAdminResultView,
  extractAdminEnvelope,
  type AdminEnvelope,
} from './admin-result-view.js';

function envelopeOf(value: unknown): AdminEnvelope {
  const envelope = extractAdminEnvelope(value);
  if (!envelope) throw new Error('未识别为管理类信封');
  return envelope;
}

describe('extractAdminEnvelope', () => {
  it('识别统一信封并记下列表字段', () => {
    const envelope = envelopeOf({
      ok: true,
      action: 'list',
      count: 2,
      skills: [{ skillId: 'a' }, { skillId: 'b' }],
    });

    expect(envelope.action).toBe('list');
    expect(envelope.listKey).toBe('skills');
    expect(envelope.declaredCount).toBe(2);
    expect(envelope.items).toHaveLength(2);
  });

  it('mcp_manage_servers 没有 count 也能识别', () => {
    const envelope = envelopeOf({ ok: true, action: 'list', servers: [{ id: 'a' }] });

    expect(envelope.listKey).toBe('servers');
    expect(envelope.declaredCount).toBeUndefined();
  });

  it('换 action 就换列表字段名（skills → results）', () => {
    const envelope = envelopeOf({
      ok: true,
      action: 'search',
      count: 1,
      results: [{ title: 'x', url: 'https://example.com' }],
    });

    expect(envelope.listKey).toBe('results');
  });

  it('memory_manage 的待确认提议不会退化成「空列表」', () => {
    const envelope = envelopeOf({
      ok: false,
      action: 'add',
      status: 'pending_confirmation',
      pendingConfirmation: true,
      outcome: 'created',
      proposalId: 'prop_1',
      message: '已提交待用户确认',
    });

    expect(envelope.listKey).toBeUndefined();
    expect(envelope.proposal).toMatchObject({
      status: 'pending_confirmation',
      proposalId: 'prop_1',
    });
  });

  it('单实体结果（enable / disable 返回 `{ skill }`）', () => {
    const envelope = envelopeOf({
      ok: true,
      action: 'enable',
      skill: { skillId: 'pdf', enabled: true },
    });

    expect(envelope.singleKey).toBe('skill');
  });

  it('connect 这类非实体对象不会被当成结果', () => {
    expect(
      extractAdminEnvelope({
        ok: true,
        action: 'add',
        serverId: 'x',
        connect: { status: 'ok', toolCount: 3 },
      }),
    ).toBeNull();
  });

  it('非管理类输出不命中', () => {
    expect(extractAdminEnvelope({ ok: true })).toBeNull();
    expect(extractAdminEnvelope({ content: [] })).toBeNull();
    expect(extractAdminEnvelope('一段文本')).toBeNull();
  });
});

describe('buildAdminResultView', () => {
  it('列表 → 行卡，并把停用项提前说清楚', () => {
    const view = buildAdminResultView(
      envelopeOf({
        ok: true,
        action: 'list',
        count: 2,
        skills: [
          { skillId: 'pdf-tools', displayName: 'PDF 工具箱', enabled: true, version: '1.2.0' },
          { skillId: 'old-log', displayName: '老版日志', enabled: false },
        ],
      }),
    );

    expect(view?.note).toBe('1 个已停用');
    const rows = view?.groups?.[0]?.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.title).toBe('PDF 工具箱');
    expect(rows[0]?.badges?.map((badge) => badge.label)).toEqual(['已启用', 'v1.2.0']);
    expect(rows[1]?.badges?.map((badge) => badge.label)).toEqual(['已停用']);
  });

  it('定时任务走表格（列对齐才便于横向比较）', () => {
    const view = buildAdminResultView(
      envelopeOf({
        ok: true,
        action: 'list',
        count: 1,
        jobs: [
          {
            id: 'j1',
            name: '每日站会',
            scheduleKind: 'cron',
            scheduleExpr: '0 9 * * 1-5',
            enabled: true,
            fireCount: 12,
            nextFireAt: '2026-01-03T01:00:00.000Z',
          },
        ],
      }),
    );

    expect(view?.table?.columns[0]).toBe('任务');
    expect(view?.table?.rows[0]?.[0]?.text).toBe('每日站会');
    expect(view?.table?.rows[0]?.[2]?.text).toBe('0 9 * * 1-5');
    expect(view?.table?.rows[0]?.[4]?.text).toBe('12');
  });

  it('待确认提议渲染成确认条而不是空列表', () => {
    const view = buildAdminResultView(
      envelopeOf({
        ok: false,
        action: 'update',
        status: 'not_created',
        pendingConfirmation: true,
        outcome: 'not_created',
        proposalId: 'prop_9',
        message: '等待用户确认',
      }),
    );

    const row = view?.groups?.[0]?.rows[0];
    expect(row?.title).toBe('未创建');
    expect(row?.description).toBe('等待用户确认');
    expect(row?.meta?.[0]).toBe('prop_9');
  });

  it('插件状态徽章是中文，不回显 active / disabled 这类英文状态词', () => {
    const badgesOf = (state: string) =>
      buildAdminResultView(
        envelopeOf({
          ok: true,
          action: 'list',
          count: 1,
          plugins: [{ id: 'p1', name: '某插件', state }],
        }),
      )?.groups?.[0]?.rows[0]?.badges;

    // `plugin_manage` 的信封用 `state`（取值 active / disabled / failed，且不带 `enabled`）
    expect(badgesOf('active')?.map((badge) => badge.label)).toEqual(['已加载']);
    expect(badgesOf('disabled')?.map((badge) => badge.label)).toEqual(['已停用']);
    expect(badgesOf('failed')?.map((badge) => badge.label)).toEqual(['加载失败']);

    // 认不出的状态不挂徽章，更不回显原始英文值
    expect(badgesOf('weird_state')).toBeUndefined();
  });

  it('提议的动作标签一律中文，不回显网关的英文动作名', () => {
    const actions = ['add', 'archive', 'create', 'delete', 'update', 'enable', 'unknown_action'];
    for (const action of actions) {
      const view = buildAdminResultView(
        envelopeOf({
          ok: false,
          action,
          status: 'not_created',
          pendingConfirmation: true,
          outcome: 'not_created',
        }),
      );
      const label = view?.groups?.[0]?.rows[0]?.badges?.[0]?.label ?? '';
      expect(label).not.toMatch(/[A-Za-z_]/);
    }

    // `memory_manage` 的 delete 会回填 `archive`（「归档即删除」是它的用户可见语义），
    // 标签必须译出来，而不是把 archive 直接显示给用户。
    const archiveView = buildAdminResultView(
      envelopeOf({
        ok: false,
        action: 'archive',
        status: 'not_created',
        pendingConfirmation: true,
        outcome: 'not_created',
      }),
    );
    expect(archiveView?.groups?.[0]?.rows[0]?.badges?.[0]?.label).toBe('归档');
  });

  it('提议创建成功时标题与 ok 保持一致', () => {
    const view = buildAdminResultView(
      envelopeOf({
        ok: true,
        action: 'add',
        status: 'pending_confirmation',
        pendingConfirmation: true,
        outcome: 'created',
        proposalId: 'prop_10',
      }),
    );

    expect(view?.groups?.[0]?.rows[0]?.title).toBe('已提交待确认');
  });

  it('空列表明确说明「没有条目」，并带上网关给的提示', () => {
    const view = buildAdminResultView(
      envelopeOf({
        ok: true,
        action: 'list',
        count: 0,
        plugins: [],
        hint: '当前没有已安装的插件',
      }),
    );

    expect(view?.note).toBe('没有条目');
    expect(view?.groups?.[0]?.rows).toHaveLength(0);
    expect(view?.footnote).toBe('当前没有已安装的插件');
  });
});
