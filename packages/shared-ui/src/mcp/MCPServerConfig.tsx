import { color } from '../tokens.js';
import type { CSSProperties, ChangeEvent } from 'react';
import { useState } from 'react';

export interface MCPServerEntry {
  id: string;
  name: string;
  transport?: 'sse' | 'stdio';
  type?: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  required?: boolean;
  builtin?: boolean;
  source?: 'builtin' | 'user';
  enabled?: boolean;
  disabledTools?: string[];
  headers?: Record<string, string>;
  oauth?:
    | false
    | {
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
        scope?: string;
      };
}

export interface MCPServerConfigProps {
  servers: MCPServerEntry[];
  onAdd: (entry: MCPServerEntry) => void;
  onRemove: (id: string) => void;
  onUpdate?: (id: string, entry: MCPServerEntry) => void;
  style?: CSSProperties;
}

const inputBase: CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 6,
  color: 'var(--fg-default)',
  fontSize: 12,
  padding: '0.35rem 0.6rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  marginBottom: 4,
  display: 'block',
};

const badgeStyle: CSSProperties = {
  border: '1px solid var(--accent-border)',
  borderRadius: 999,
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.4,
  padding: '1px 7px',
};

function genId(): string {
  return `mcp-${Date.now().toString(36)}`;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function stringifyJson(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

function parseRecordJson(value: string): Record<string, string> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function readStringField(value: object, key: string): string | undefined {
  const entry = Object.entries(value).find(([field]) => field === key);
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

function parseOAuthJson(value: string): MCPServerEntry['oauth'] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'false') return false;
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const clientId = readStringField(parsed, 'clientId');
  const clientSecret = readStringField(parsed, 'clientSecret');
  const scope = readStringField(parsed, 'scope');
  const redirectUri = readStringField(parsed, 'redirectUri');
  return {
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(scope ? { scope } : {}),
    ...(redirectUri ? { redirectUri } : {}),
  };
}

function serverTransport(server: MCPServerEntry): 'sse' | 'stdio' {
  return server.transport ?? server.type ?? 'sse';
}

export function MCPServerConfig({
  servers,
  onAdd,
  onRemove,
  onUpdate,
  style,
}: MCPServerConfigProps) {
  const [transport, setTransport] = useState<'sse' | 'stdio'>('sse');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [envJson, setEnvJson] = useState('');
  const [required, setRequired] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [disabledTools, setDisabledTools] = useState('');
  const [headersJson, setHeadersJson] = useState('');
  const [oauthJson, setOauthJson] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleAdd() {
    const trimName = name.trim();
    const trimId = id.trim() || genId();
    if (!trimName) return;
    if (enabled && transport === 'sse' && !url.trim()) return;
    if (enabled && transport === 'stdio' && !command.trim()) return;

    let headers: Record<string, string> | undefined;
    let env: Record<string, string> | undefined;
    let oauth: MCPServerEntry['oauth'] | undefined;
    try {
      headers = parseRecordJson(headersJson);
      env = parseRecordJson(envJson);
      oauth = parseOAuthJson(oauthJson);
      setFormError(null);
    } catch {
      setFormError('Headers / Env / OAuth 必须是有效 JSON，OAuth 也可以填 false。');
      return;
    }

    const entry: MCPServerEntry = {
      id: trimId,
      name: trimName,
      transport,
      enabled,
      ...(transport === 'sse'
        ? { url: url.trim() }
        : {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            ...(env ? { env } : {}),
          }),
      ...(required ? { required } : {}),
      ...(disabledTools.trim() ? { disabledTools: splitList(disabledTools) } : {}),
      ...(headers ? { headers } : {}),
      ...(oauth !== undefined ? { oauth } : {}),
    };
    onAdd(entry);
    setId('');
    setName('');
    setUrl('');
    setCommand('');
    setArgs('');
    setCwd('');
    setEnvJson('');
    setRequired(false);
    setEnabled(true);
    setDisabledTools('');
    setHeadersJson('');
    setOauthJson('');
  }

  const canAdd = name.trim() && (!enabled || (transport === 'sse' ? url.trim() : command.trim()));

  return (
    <div
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
          MCP 服务器配置
        </h2>
      </div>

      {servers.length === 0 ? (
        <div style={{ padding: '1.25rem 1.5rem', color: 'var(--fg-muted)', fontSize: 12 }}>
          暂无服务器配置。添加同 id（如 websearch / grep_app）可覆盖或禁用系统内置 MCP。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {servers.map((s, idx) => {
            const currentTransport = serverTransport(s);
            const update = (patch: Partial<MCPServerEntry>) => {
              onUpdate?.(s.id, { ...s, ...patch });
            };
            return (
              <div
                key={`${s.id}-${idx}`}
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: '0.75rem 1.5rem',
                  borderBottom:
                    idx < servers.length - 1 ? '1px solid var(--border-default)' : 'none',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  }}
                >
                  <input
                    aria-label="MCP ID"
                    value={s.id}
                    onChange={(e) => update({ id: e.target.value.trim() })}
                    style={inputBase}
                  />
                  <input
                    aria-label="MCP 名称"
                    value={s.name}
                    onChange={(e) => update({ name: e.target.value })}
                    style={inputBase}
                  />
                  <label style={{ ...labelStyle, marginBottom: 0, alignSelf: 'center' }}>
                    <input
                      checked={s.enabled !== false}
                      onChange={(e) => update({ enabled: e.target.checked })}
                      type="checkbox"
                    />{' '}
                    启用
                  </label>
                  <button
                    type="button"
                    onClick={() => onRemove(s.id)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-default)',
                      borderRadius: 6,
                      color: color.danger,
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: '0.35rem 0.6rem',
                    }}
                  >
                    {s.builtin ? (s.source === 'builtin' ? '禁用' : '恢复默认') : '移除'}
                  </button>
                </div>

                {s.builtin || s.required ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {s.builtin ? (
                      <span style={badgeStyle} title="系统内置 MCP，可通过同 id 用户配置覆盖">
                        系统内置
                      </span>
                    ) : null}
                    {s.required ? (
                      <span style={badgeStyle} title="required=true，启动时应优先保持可用">
                        required
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div
                  style={{
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  }}
                >
                  <select
                    aria-label="MCP transport"
                    value={currentTransport}
                    onChange={(e) => update({ transport: e.target.value as 'sse' | 'stdio' })}
                    style={inputBase}
                  >
                    <option value="sse">SSE</option>
                    <option value="stdio">stdio</option>
                  </select>
                  {currentTransport === 'sse' ? (
                    <input
                      aria-label="MCP URL"
                      placeholder="https://mcp.example.com/sse"
                      value={s.url ?? ''}
                      onChange={(e) => update({ url: e.target.value })}
                      style={inputBase}
                    />
                  ) : (
                    <input
                      aria-label="MCP command"
                      placeholder="npx"
                      value={s.command ?? ''}
                      onChange={(e) => update({ command: e.target.value })}
                      style={inputBase}
                    />
                  )}
                  <input
                    aria-label="禁用工具"
                    placeholder="disabledTools，逗号分隔"
                    value={(s.disabledTools ?? []).join(', ')}
                    onChange={(e) => update({ disabledTools: splitList(e.target.value) })}
                    style={inputBase}
                  />
                </div>

                <details>
                  <summary style={{ color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 12 }}>
                    高级字段
                  </summary>
                  <div
                    style={{
                      display: 'grid',
                      gap: 8,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      marginTop: 8,
                    }}
                  >
                    {currentTransport === 'stdio' ? (
                      <>
                        <input
                          aria-label="MCP args"
                          placeholder="args，空格分隔"
                          value={(s.args ?? []).join(' ')}
                          onChange={(e) =>
                            update({
                              args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [],
                            })
                          }
                          style={inputBase}
                        />
                        <input
                          aria-label="MCP cwd"
                          placeholder="cwd，例如 . 或 /path/to/workspace"
                          value={s.cwd ?? ''}
                          onChange={(e) => update({ cwd: e.target.value.trim() || undefined })}
                          style={inputBase}
                        />
                        <textarea
                          aria-label="MCP env JSON"
                          placeholder={'env JSON，例如 {"NODE_ENV":"production"}'}
                          rows={3}
                          value={stringifyJson(s.env)}
                          onChange={(e) => {
                            try {
                              update({ env: parseRecordJson(e.target.value) });
                              setFormError(null);
                            } catch {
                              setFormError('Env 必须是有效 JSON 对象。');
                            }
                          }}
                          style={inputBase}
                        />
                        <label style={{ ...labelStyle, marginBottom: 0, alignSelf: 'center' }}>
                          <input
                            checked={s.required === true}
                            onChange={(e) => update({ required: e.target.checked })}
                            type="checkbox"
                          />{' '}
                          required
                        </label>
                      </>
                    ) : null}
                    <textarea
                      aria-label="MCP headers JSON"
                      placeholder={'headers JSON，例如 {"x-api-key":"..."}'}
                      rows={3}
                      value={stringifyJson(s.headers)}
                      onChange={(e) => {
                        try {
                          update({ headers: parseRecordJson(e.target.value) });
                          setFormError(null);
                        } catch {
                          setFormError('Headers 必须是有效 JSON 对象。');
                        }
                      }}
                      style={inputBase}
                    />
                    <textarea
                      aria-label="MCP OAuth JSON"
                      placeholder={'oauth JSON 或 false'}
                      rows={3}
                      value={stringifyJson(s.oauth)}
                      onChange={(e) => {
                        try {
                          update({ oauth: parseOAuthJson(e.target.value) });
                          setFormError(null);
                        } catch {
                          setFormError('OAuth 必须是有效 JSON，或 false。');
                        }
                      }}
                      style={inputBase}
                    />
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {(['sse', 'stdio'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTransport(t)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '0.3rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                background: transport === t ? 'var(--accent)' : 'transparent',
                color: transport === t ? color.fgOnAccent : 'var(--fg-muted)',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="mcp-id" style={labelStyle}>
            服务器 ID
          </label>
          <input
            id="mcp-id"
            type="text"
            placeholder="websearch 或自定义 id"
            value={id}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setId(e.target.value)}
            style={inputBase}
          />
        </div>

        <div>
          <label htmlFor="mcp-name" style={labelStyle}>
            服务器名称
          </label>
          <input
            id="mcp-name"
            type="text"
            placeholder="我的 MCP 服务器"
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            style={inputBase}
          />
        </div>

        {transport === 'sse' ? (
          <div>
            <label htmlFor="mcp-url" style={labelStyle}>
              服务器 URL
            </label>
            <input
              id="mcp-url"
              type="text"
              placeholder="https://mcp.example.com/sse"
              value={url}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              style={inputBase}
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="mcp-command" style={labelStyle}>
                命令
              </label>
              <input
                id="mcp-command"
                type="text"
                placeholder="npx mcp-server"
                value={command}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCommand(e.target.value)}
                style={inputBase}
              />
            </div>
            <div>
              <label htmlFor="mcp-args" style={labelStyle}>
                参数（空格分隔）
              </label>
              <input
                id="mcp-args"
                type="text"
                placeholder="--port 3000 --verbose"
                value={args}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setArgs(e.target.value)}
                style={inputBase}
              />
            </div>
            <div>
              <label htmlFor="mcp-cwd" style={labelStyle}>
                工作目录 cwd
              </label>
              <input
                id="mcp-cwd"
                type="text"
                placeholder=". 或 /path/to/workspace"
                value={cwd}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCwd(e.target.value)}
                style={inputBase}
              />
            </div>
          </>
        )}

        <label style={{ ...labelStyle, marginBottom: 0 }}>
          <input
            checked={enabled}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
            type="checkbox"
          />{' '}
          启用此服务器
        </label>

        <label style={{ ...labelStyle, marginBottom: 0 }}>
          <input
            checked={required}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setRequired(e.target.checked)}
            type="checkbox"
          />{' '}
          required（启动时优先保持可用）
        </label>

        <div>
          <label htmlFor="mcp-disabled-tools" style={labelStyle}>
            禁用工具（逗号分隔）
          </label>
          <input
            id="mcp-disabled-tools"
            type="text"
            placeholder="search, create_issue"
            value={disabledTools}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDisabledTools(e.target.value)}
            style={inputBase}
          />
        </div>

        <details>
          <summary style={{ color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 12 }}>
            高级字段
          </summary>
          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              marginTop: 8,
            }}
          >
            <textarea
              aria-label="新增 MCP headers JSON"
              placeholder={'headers JSON，例如 {"x-api-key":"..."}'}
              rows={3}
              value={headersJson}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setHeadersJson(e.target.value)}
              style={inputBase}
            />
            <textarea
              aria-label="新增 MCP OAuth JSON"
              placeholder={'oauth JSON 或 false'}
              rows={3}
              value={oauthJson}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setOauthJson(e.target.value)}
              style={inputBase}
            />
            {transport === 'stdio' ? (
              <textarea
                aria-label="新增 MCP env JSON"
                placeholder={'env JSON，例如 {"NODE_ENV":"production"}'}
                rows={3}
                value={envJson}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEnvJson(e.target.value)}
                style={inputBase}
              />
            ) : null}
          </div>
        </details>

        {formError ? (
          <div style={{ color: color.danger, fontSize: 12, lineHeight: 1.5 }}>{formError}</div>
        ) : null}

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          style={{
            background: canAdd
              ? 'var(--accent)'
              : 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
            color: color.fgOnAccent,
            border: 'none',
            borderRadius: 6,
            padding: '0.4rem 1rem',
            fontSize: 12,
            cursor: canAdd ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            alignSelf: 'flex-start',
          }}
        >
          + 添加服务器
        </button>
      </div>
    </div>
  );
}
