/**
 * 错误诊断折叠面板
 *
 * 当团队任务存在失败项时，在主面板顶部展示可折叠的错误诊断简报：
 *   - 默认折叠为单行摘要（"29 个任务失败"）
 *   - 展开后按错误类型分组（API 超时 / 代码生成语法错误 / 工具绑定冲突 等）
 *   - 提供「一键重试失败任务」按钮（断点续传语义）
 *
 * 错误分类策略：
 *   - 从 handoff 的 state='failed' 条目 + session 的 failedStatus 推断
 *   - 根据 handoff 的 failureReason 关键字做粗分类
 */

import { useState, useMemo, useCallback, type CSSProperties } from 'react';
import type { HandoffEntry } from '../../../../../stores/team/team-events.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';

// ─── 样式 ──────────────────────────────────────────────────────────

const PANEL_ROOT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  margin: '0 0 8px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--complement) 35%, transparent)',
  background: 'color-mix(in srgb, var(--complement) 6%, var(--bg-overlay))',
  overflow: 'hidden',
  flexShrink: 0,
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  cursor: 'pointer',
  userSelect: 'none',
};

const HEADER_ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--complement) 16%, transparent)',
  color: 'var(--complement)',
  fontSize: 13,
  fontWeight: 800,
  flexShrink: 0,
};

const HEADER_TITLE_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  flex: 1,
  minWidth: 0,
};

const HEADER_COUNT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 8px',
  borderRadius: 999,
  background: 'var(--complement)',
  color: 'var(--fg-on-accent, #fff)',
  fontSize: 10,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

const CARET_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  transition: 'transform 200ms ease',
  flexShrink: 0,
};

const CONTENT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '0 12px 10px',
  borderTop: '1px solid color-mix(in srgb, var(--complement) 18%, transparent)',
};

const ERROR_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '8px 10px',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
  border:
    '1px solid color-mix(in srgb, var(--border-subtle, var(--border-default)) 50%, transparent)',
};

const ERROR_GROUP_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

const ERROR_GROUP_ICON_STYLE: CSSProperties = {
  fontSize: 12,
  flexShrink: 0,
};

const ERROR_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  fontSize: 11,
  color: 'var(--fg-default)',
  lineHeight: 1.5,
  padding: '2px 0 2px 18px',
};

const ERROR_ITEM_LABEL_STYLE: CSSProperties = {
  flexShrink: 0,
  color: 'var(--fg-muted)',
  fontWeight: 600,
};

const ERROR_ITEM_MSG_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const RETRY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background 120ms ease, transform 120ms ease',
};

// ─── 类型 ──────────────────────────────────────────────────────────

interface ErrorGroup {
  category: ErrorCategory;
  label: string;
  icon: string;
  items: ErrorItem[];
}

interface ErrorItem {
  handoffId: string;
  layer: string;
  message: string;
  sessionId?: string;
}

type ErrorCategory = 'api_timeout' | 'syntax_error' | 'tool_binding' | 'unknown';

// ─── 错误分类逻辑 ──────────────────────────────────────────────────

const LAYER_LABELS: Record<string, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const CATEGORY_META: Record<ErrorCategory, { label: string; icon: string }> = {
  api_timeout: { label: 'API 超时 / 网络异常', icon: '⏱' },
  syntax_error: { label: '代码生成语法错误', icon: '✖' },
  tool_binding: { label: '工具绑定冲突', icon: '🔗' },
  unknown: { label: '其他异常', icon: '⚠' },
};

function classifyError(message: string): ErrorCategory {
  const lower = message.toLowerCase();
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('超时') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('网络')
  ) {
    return 'api_timeout';
  }
  if (
    lower.includes('syntax') ||
    lower.includes('语法') ||
    lower.includes('parse error') ||
    lower.includes('unexpected token') ||
    lower.includes('compilation')
  ) {
    return 'syntax_error';
  }
  if (
    lower.includes('tool') ||
    lower.includes('binding') ||
    lower.includes('工具') ||
    lower.includes('绑定') ||
    lower.includes('command not found') ||
    lower.includes('no such tool')
  ) {
    return 'tool_binding';
  }
  return 'unknown';
}

// ─── 组件 ──────────────────────────────────────────────────────────

export interface ErrorDiagnosticsPanelProps {
  failedHandoffs: HandoffEntry[];
  selectedTeam: AgentTeamsSidebarTeam | null;
  onRetryFailed?: () => void;
  retrying?: boolean;
}

export function ErrorDiagnosticsPanel({
  failedHandoffs,
  selectedTeam,
  onRetryFailed,
  retrying = false,
}: ErrorDiagnosticsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const taskFailedCount = selectedTeam?.taskFailed ?? 0;
  const failedHandoffCount = failedHandoffs.filter((h) => h.state === 'failed').length;
  const totalFailed = Math.max(taskFailedCount, failedHandoffCount);

  const errorGroups = useMemo<ErrorGroup[]>(() => {
    const groups = new Map<ErrorCategory, ErrorItem[]>();

    for (const handoff of failedHandoffs) {
      if (handoff.state !== 'failed') continue;
      const message = handoff.failureReason ?? handoff.summary ?? '未知错误';
      const category = classifyError(message);
      const layer = handoff.toRoleLayer
        ? (LAYER_LABELS[handoff.toRoleLayer] ?? handoff.toRoleLayer)
        : '未知';
      const item: ErrorItem = {
        handoffId: handoff.id,
        layer,
        message,
        sessionId: handoff.sessionId ?? undefined,
      };
      const list = groups.get(category) ?? [];
      list.push(item);
      groups.set(category, list);
    }

    // 如果没有 handoff 级别的失败但 selectedTeam 显示有失败任务，
    // 归入 unknown 类别
    if (groups.size === 0 && totalFailed > 0) {
      groups.set('unknown', [
        {
          handoffId: 'session-level',
          layer: '会话级',
          message: `${totalFailed} 个任务执行失败，详细信息请查看任务看板`,
          sessionId: selectedTeam?.id,
        },
      ]);
    }

    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      label: CATEGORY_META[category].label,
      icon: CATEGORY_META[category].icon,
      items,
    }));
  }, [failedHandoffs, selectedTeam?.id, totalFailed]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  if (totalFailed <= 0) return null;

  return (
    <div
      className="team-error-diagnostics-panel"
      style={PANEL_ROOT_STYLE}
      role="region"
      aria-label="错误诊断简报"
    >
      <div
        style={HEADER_ROW_STYLE}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`错误诊断：${totalFailed} 个任务失败，${expanded ? '点击收起' : '点击展开'}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <span style={HEADER_ICON_STYLE} aria-hidden>
          !
        </span>
        <span style={HEADER_TITLE_STYLE}>错误诊断简报</span>
        <span style={HEADER_COUNT_STYLE}>{totalFailed}</span>
        {onRetryFailed ? (
          <button
            type="button"
            style={{
              ...RETRY_BUTTON_STYLE,
              opacity: retrying ? 0.6 : 1,
              cursor: retrying ? 'not-allowed' : 'pointer',
            }}
            disabled={retrying}
            onClick={(e) => {
              e.stopPropagation();
              onRetryFailed();
            }}
            aria-label="一键重试失败任务"
          >
            {retrying ? '重试中…' : '↻ 一键重试'}
          </button>
        ) : null}
        <span
          aria-hidden
          style={{ ...CARET_STYLE, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </div>

      {expanded ? (
        <div style={CONTENT_STYLE}>
          {errorGroups.map((group) => (
            <div key={group.category} style={ERROR_GROUP_STYLE}>
              <div style={ERROR_GROUP_HEADER_STYLE}>
                <span style={ERROR_GROUP_ICON_STYLE} aria-hidden>
                  {group.icon}
                </span>
                <span>{group.label}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    fontWeight: 600,
                  }}
                >
                  {group.items.length} 项
                </span>
              </div>
              {group.items.slice(0, 5).map((item, index) => (
                <div key={`${group.category}-${item.handoffId}-${index}`} style={ERROR_ITEM_STYLE}>
                  <span style={ERROR_ITEM_LABEL_STYLE}>[{item.layer}]</span>
                  <span style={ERROR_ITEM_MSG_STYLE} title={item.message}>
                    {item.message}
                  </span>
                </div>
              ))}
              {group.items.length > 5 ? (
                <div style={{ ...ERROR_ITEM_STYLE, color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                  …还有 {group.items.length - 5} 项，切换到「任务」标签页查看完整列表
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
