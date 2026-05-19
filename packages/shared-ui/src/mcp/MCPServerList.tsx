import { color as clr } from '../tokens.js';
import type { CSSProperties } from 'react';

export type MCPServerStatus = {
  id: string;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  toolCount: number;
  authType?: string;
  /**
   * 系统内置 MCP（如 websearch / grep_app）。后端 `/settings/mcp-status`
   * 在合并用户配置与内置项后会标注此字段。前端用它显示"系统内置"
   * 徽章并提示"通过添加同 id 配置可覆盖/禁用"。
   */
  builtin?: boolean;
  /**
   * 最近一次重试连接 / 安装的反馈。`null` 表示用户从未触发过重试，
   * 此时按钮显示默认文案。设置后用于在右侧显示成功/失败的小字
   * 提示（成功几秒后自动消失，失败时展示错误信息直到下次操作）。
   *
   * 此字段由前端在调用 `onRetry` 之后设置，不来自后端轮询。
   */
  retryFeedback?:
    | { kind: 'pending' }
    | { kind: 'ok'; toolCount: number; durationMs: number }
    | { kind: 'fail'; error: string };
};

export interface MCPServerListProps {
  servers: MCPServerStatus[];
  /**
   * 触发"重试连接 / 安装"按钮的回调。`undefined` 时整列按钮不
   * 渲染（兼容只展示状态、不允许操作的 read-only 视图）。
   *
   * 调用方应：
   *   1. 立刻把对应 server 的 `retryFeedback` 置为 `{ kind: 'pending' }`
   *      以驱动 loading UI；
   *   2. POST /settings/mcp-servers/{id}/retry；
   *   3. 把后端返回的 status/toolCount/error 写回 `retryFeedback`
   *      （成功 `{ kind: 'ok', ... }`，失败 `{ kind: 'fail', error }`）。
   */
  onRetry?: (serverId: string) => void;
  style?: CSSProperties;
}

const STATUS_COLOR: Record<MCPServerStatus['status'], string> = {
  connected: clr.success,
  connecting: clr.contrast,
  disconnected: 'var(--fg-muted))',
  error: clr.danger,
};

const STATUS_LABEL: Record<MCPServerStatus['status'], string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '已断开',
  error: '错误',
};

export function MCPServerList({ servers, onRetry, style }: MCPServerListProps) {
  return (
    <div
      style={{
        background: 'var(--bg-overlay))',
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
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--fg-default))' }}>
          MCP 服务器
        </h2>
      </div>

      {servers.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--fg-muted))',
            fontSize: 12,
          }}
        >
          No MCP servers connected.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {servers.map((server, idx) => {
            const color = STATUS_COLOR[server.status];
            const isLast = idx === servers.length - 1;
            return (
              <div
                key={server.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0.75rem 1.5rem',
                  borderBottom: isLast
                    ? 'none'
                    : '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                }}
              >
                <span
                  title={STATUS_LABEL[server.status]}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: color,
                    boxShadow: server.status === 'connected' ? `0 0 6px ${color}` : 'none',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--fg-default))',
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {server.name}
                    </span>
                    {server.builtin ? (
                      <span
                        title="系统内置 MCP — 在 mcp_servers 中添加同 id 配置可覆盖或禁用"
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 8,
                          background: 'rgba(52,211,153,0.12)',
                          color: clr.success,
                          border: '1px solid rgba(52,211,153,0.32)',
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        系统内置
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color,
                      marginTop: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {STATUS_LABEL[server.status]}
                    {server.authType && (
                      <span style={{ color: 'var(--fg-muted))' }}>· {server.authType}</span>
                    )}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: 'rgba(99,102,241,0.15)',
                    color: 'var(--accent))',
                    border: '1px solid rgba(99,102,241,0.25)',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
                </span>
                {onRetry ? (
                  <RetryControl server={server} onClick={() => onRetry(server.id)} />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface RetryControlProps {
  server: MCPServerStatus;
  onClick: () => void;
}

/**
 * "重试连接 / 安装" 按钮 + 反馈条。整块仅在 `onRetry` 存在时由
 * 父组件渲染，所以这里假设 `onClick` 一定有效。
 *
 * 行为说明：
 *   - `pending` → 按钮禁用，显示 "处理中…"，避免连点重发；
 *   - `ok` → 短暂显示 "✓ 已连接 N 个工具" 的绿字，按钮文案重置为
 *     "重试" 以便后续仍可触发；
 *   - `fail` → 按钮文案变 "重试"，下方红字展示 `error` 文本（多行
 *     用 `pre-wrap`，长消息会自然换行）；
 *   - 无 feedback（首次进入页面） → 按钮文案是 "重试" 不带状态。
 *
 * 我们故意 **不** 根据 `server.status` 隐藏按钮 —— 即便当前 `connected`
 * 也允许用户点击重连（如配置改了想立即生效），与 oh-my-opencode
 * doctor 的"任意时候都能跑诊断"哲学一致。
 */
function RetryControl({ server, onClick }: RetryControlProps) {
  const feedback = server.retryFeedback;
  const isPending = feedback?.kind === 'pending';
  const buttonLabel = isPending ? '处理中…' : '重试';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        flexShrink: 0,
        maxWidth: 240,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          background: isPending ? 'rgba(148,163,184,0.15)' : 'rgba(99,102,241,0.15)',
          color: isPending ? 'var(--fg-muted))' : 'var(--accent))',
          cursor: isPending ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}
        title={
          server.builtin
            ? '内置 MCP 通常无需重试；点击会重新建立连接。'
            : '断开当前连接并重新尝试连接 / 安装。stdio 服务器若使用 npx -y 形式会触发依赖按需下载。'
        }
      >
        {buttonLabel}
      </button>
      {feedback?.kind === 'ok' ? (
        <span
          style={{
            fontSize: 10,
            color: clr.success,
            whiteSpace: 'nowrap',
          }}
        >
          ✓ 已连接 · {feedback.toolCount} tools · {feedback.durationMs}ms
        </span>
      ) : null}
      {feedback?.kind === 'fail' ? (
        <span
          style={{
            fontSize: 10,
            color: clr.danger,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'right',
            lineHeight: 1.4,
          }}
          title={feedback.error}
        >
          {feedback.error}
        </span>
      ) : null}
    </div>
  );
}
