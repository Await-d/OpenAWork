/**
 * 会话扩展面板（261101）。
 *
 * `/session-extensions/panel?session=<id>`：一个会话的扩展一览与收窄操作。
 *
 * 为什么单独一页而不是塞进聊天页侧栏：面板要做的都是**低频、有后果**的动作
 * （切继承策略、禁用 / 移除条目、录入凭据），混在对话流里容易误点；确认提案
 * 已经有独立的 `/session-extensions/confirm`，这里保持同一形态。
 *
 * 三条边界（都对应网关侧的强制校验，前端不重复发明规则）：
 *   - **只收窄**：面板能禁用 / 移除，不能启用——启用等于扩权，必须重新走提案确认；
 *   - **凭据只上行**：录入后只显示名字与时间，页面任何位置都不回显明文；
 *   - **渠道默认关闭**：`managementEnabled = false` 时禁用全部写操作并说明原因。
 *
 * 本组件只做组装：取数在 `hooks/session-extension-hooks.ts`，分区渲染在
 * `panel/sections.tsx`（`apps/web/AGENTS.md` 的页面轻量 + 组件提取原则）。
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { SessionExtensionInheritance } from '@openAwork/web-client';
import {
  useSessionExtensionClient,
  useSessionExtensionPanelState,
} from './hooks/session-extension-hooks.js';
import {
  InheritanceSection,
  PendingProposalList,
  SecretEditor,
  SessionEntryList,
  revokeSuccessText,
} from './panel/sections.js';
import { SessionExtensionNotice } from './shared/SessionExtensionNotice.js';
import {
  panelCardStyle,
  panelMutedStyle,
  panelPageStyle,
} from './shared/session-extension-display.js';

export default function SessionExtensionPanelPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session') ?? '';

  const { client, accessToken } = useSessionExtensionClient();
  const { phase, state, pending, busy, feedback, reload, run } =
    useSessionExtensionPanelState(sessionId);

  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!sessionId) {
    return (
      <SessionExtensionNotice variant="panel">
        链接缺少会话参数，请从会话内打开「会话扩展」面板。
      </SessionExtensionNotice>
    );
  }

  if (phase === 'unauthenticated') {
    return (
      <SessionExtensionNotice variant="panel">
        <strong>请先登录</strong>
        <span style={panelMutedStyle}>链接本身不代表授权；面板与确认页都需要登录账号。</span>
      </SessionExtensionNotice>
    );
  }

  if (phase === 'not-found') {
    return (
      <SessionExtensionNotice variant="panel">
        会话不存在，或当前账号无权访问。
      </SessionExtensionNotice>
    );
  }

  if (phase === 'loading' || !state) {
    return <SessionExtensionNotice variant="panel">正在加载会话扩展…</SessionExtensionNotice>;
  }

  const writable = state.managementEnabled;
  const inheritanceBlocked = !writable || state.source === 'channel';
  const token = accessToken ?? '';

  const onSelectInheritance = (mode: SessionExtensionInheritance): void => {
    void run(
      () => client.setInheritance(token, sessionId, mode, state.revision),
      mode === 'explicit'
        ? '已切换为「只用会话条目」，不再继承用户级配置。'
        : '已切换为继承用户级配置。',
    );
  };

  const onRevoke = (kind: 'skill' | 'mcp', resourceRef: string, remove: boolean): void => {
    void run(
      () => client.revoke(token, sessionId, { kind, resourceRef, remove }),
      revokeSuccessText(kind, remove),
    );
  };

  const onSaveSecret = (): void => {
    void run(async () => {
      await client.putSecret(token, sessionId, secretName, secretValue);
      // 明文用完即清：不留在组件状态里，避免误触「重新提交」把旧值又传一遍。
      setSecretName('');
      setSecretValue('');
    }, '凭据已加密保存；引用它的 MCP 会在下次建连时使用。');
  };

  return (
    <div style={panelPageStyle}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>会话扩展</h1>
        <span style={panelMutedStyle}>
          会话 {state.sessionId} · 来源 {state.source} · revision {state.revision}
        </span>
      </header>

      {!writable && (
        <div style={{ ...panelCardStyle, borderColor: 'var(--warning, var(--accent))' }}>
          当前来源未开启会话级扩展管理，面板为只读。
          {state.source === 'channel' ? '渠道默认关闭，需在渠道配置中显式开启。' : ''}
        </div>
      )}

      {feedback && <div style={panelCardStyle}>{feedback}</div>}

      <InheritanceSection
        inheritance={state.inheritance}
        busy={busy}
        blocked={inheritanceBlocked}
        isChannel={state.source === 'channel'}
        onSelect={onSelectInheritance}
      />

      <SessionEntryList
        title="会话技能"
        kind="skill"
        emptyText="暂无会话级技能。"
        entries={state.skills.map((skill) => ({
          resourceRef: skill.resourceRef,
          label: skill.skillId,
          enabled: skill.enabled,
          extra: skill.pinned ? ' · 已固定' : '',
        }))}
        busy={busy}
        writable={writable}
        footer="启用或新增需要重新发起提案并确认：扩权不走一键操作。"
        onRevoke={onRevoke}
      />

      <SessionEntryList
        title="会话 MCP"
        kind="mcp"
        emptyText="暂无会话级 MCP。"
        entries={state.mcpServers.map((server) => ({
          resourceRef: server.resourceRef,
          label: server.displayId,
          enabled: server.enabled,
          extra: server.hasSecret ? ' · 引用凭据' : '',
        }))}
        busy={busy}
        writable={writable}
        onRevoke={onRevoke}
      />

      <SecretEditor
        secrets={state.secrets}
        busy={busy}
        writable={writable}
        name={secretName}
        value={secretValue}
        onNameChange={setSecretName}
        onValueChange={setSecretValue}
        onSave={onSaveSecret}
        onDelete={(name) =>
          void run(
            () => client.deleteSecret(token, sessionId, name),
            `已删除凭据「${name}」，引用它的 MCP 将无法建连。`,
          )
        }
      />

      <PendingProposalList pending={pending} sessionId={sessionId} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void reload()}>
          刷新
        </button>
      </div>
    </div>
  );
}
