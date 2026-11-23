import { useCallback, useEffect, useRef, useState } from 'react';
import { createMemoriesClient } from '@openAwork/web-client';
import type { MemoryRuleEntry, MemoryScope, MemoryScopeType } from '@openAwork/web-client';
import { SS, ST } from '../shared/settings-section-styles.js';
import { MemoryRuleForm } from './memory-rule-form.js';

function tokenOwner(token: string): string | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const data: unknown = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
    );
    if (!data || typeof data !== 'object' || !('sub' in data)) return null;
    return typeof data.sub === 'string' && data.sub.trim() ? data.sub : null;
  } catch {
    return null;
  }
}

/** 与后端 `isScopeOwnedByUser` 对 `channel_chat` 的判定对齐：`channel:` 前缀且含 `:chat:`。 */
function isChannelChatScopeId(scopeId: string): boolean {
  return scopeId.startsWith('channel:') && scopeId.includes(':chat:');
}

const LABELS: Record<MemoryScopeType, string> = {
  user: '个人',
  workspace: '项目',
  team: '团队',
  channel_chat: '渠道对话',
};

export function MemoryRulesPanel(props: {
  gatewayUrl: string;
  token: string;
  onProposed?: () => void;
  refreshKey?: number;
}) {
  return <RulesEditor key={`${props.gatewayUrl}:${props.token}`} {...props} />;
}

function RulesEditor({
  gatewayUrl,
  token,
  onProposed,
  refreshKey,
}: {
  gatewayUrl: string;
  token: string;
  onProposed?: () => void;
  refreshKey?: number;
}) {
  const owner = tokenOwner(token);
  const [rules, setRules] = useState<MemoryRuleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryRuleEntry | null>(null);
  const [scopeType, setScopeType] = useState<MemoryScopeType>('user');
  const [scopeId, setScopeId] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const alive = useRef(true);
  const request = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const next = await createMemoriesClient(gatewayUrl).listRules(token);
      if (alive.current && request.current === id) setRules(next);
    } catch (cause) {
      if (alive.current && request.current === id)
        setError(cause instanceof Error ? cause.message : '读取规则失败');
    } finally {
      if (alive.current && request.current === id) setLoading(false);
    }
  }, [gatewayUrl, token]);
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const act = async (work: () => Promise<string>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await work();
      if (!alive.current) return;
      setMessage(result);
      await refresh();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败，未应用变更');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const submit = () => {
    const scope: MemoryScope = editing?.scope ?? {
      type: scopeType,
      id: scopeType === 'user' ? (owner ?? '') : scopeId.trim(),
    };
    if (!scope.id || !name.trim() || !body.trim()) {
      setError('请填写名称、正文和作用域');
      return;
    }
    // 与后端 `isScopeOwnedByUser` 的 `channel_chat` 前缀规则保持一致：后端只接受形如
    // `channel:<id>:chat:<id>` 的作用域标识，其他形式一律 403。这里前置校验，避免用户
    // 提交后才看到一个无从解释的 403。
    if (scope.type === 'channel_chat' && !isChannelChatScopeId(scope.id)) {
      setError(
        '渠道对话作用域标识需形如 channel:<渠道ID>:chat:<会话ID>，例如 channel:telegram:chat:123',
      );
      return;
    }
    void act(async () => {
      const result = await createMemoriesClient(gatewayUrl).proposeRule(token, {
        scope,
        name: name.trim(),
        body: body.trim(),
        expectedRevision: editing?.revision ?? 0,
      });
      if (result.status !== 'pending_confirmation') throw new Error('未生成待确认规则');
      if (alive.current) onProposed?.();
      return '已提交待确认；确认前不会修改规则。请在待确认列表查看具体内容后批准。';
    });
  };
  return (
    <section style={SS} aria-label="结构化规则管理">
      <h3 style={ST}>结构化规则</h3>
      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
        新增和编辑需确认后生效；停用立即收窄影响。此处不修改 AGENTS.md 等文件。
      </p>
      {error && <div role="alert">{error}</div>}
      {message && <div role="status">{message}</div>}
      <MemoryRuleForm
        busy={busy}
        editing={editing !== null}
        canSubmit={Boolean(owner && name.trim() && body.trim())}
        scopeType={editing?.scope.type ?? scopeType}
        scopeId={editing?.scope.id ?? scopeId}
        name={name}
        body={body}
        setScopeType={setScopeType}
        setScopeId={setScopeId}
        setName={setName}
        setBody={setBody}
        submit={submit}
        cancel={() => {
          setEditing(null);
          setName('');
          setBody('');
        }}
      />
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        刷新规则
      </button>
      {loading ? <p>规则加载中…</p> : !error && rules.length === 0 ? <p>暂无已确认规则</p> : null}
      {rules.map((rule) => (
        <article
          key={rule.id}
          aria-label={`规则 ${rule.name}`}
          style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 0' }}
        >
          <strong>{rule.name}</strong> · {LABELS[rule.scope.type]} · 版本 {rule.revision} ·{' '}
          {rule.enabled ? '已生效' : '已停用'}
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{rule.body}</pre>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(rule);
              setName(rule.name);
              setBody(rule.body);
              setMessage(null);
            }}
          >
            编辑并重新提议
          </button>
          {rule.enabled && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await createMemoriesClient(gatewayUrl).disableRule(token, rule.id);
                  if (!result.ok) throw new Error('规则停用失败');
                  return '规则已停用';
                })
              }
            >
              停用
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`确认删除规则“${rule.name}”？`)) return;
              void act(async () => {
                const result = await createMemoriesClient(gatewayUrl).deleteRule(token, rule.id);
                if (!result.ok) throw new Error('规则删除失败');
                return '规则已删除';
              });
            }}
          >
            删除规则
          </button>
        </article>
      ))}
    </section>
  );
}
