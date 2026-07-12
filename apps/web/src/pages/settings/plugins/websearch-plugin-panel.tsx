import React from 'react';
import type { CSSProperties } from 'react';
import {
  MCPServerConfig,
  MCPServerList,
  type MCPServerEntry,
  type MCPServerStatus,
} from '@openAwork/shared-ui';
import { WebsearchSection } from '../connection/websearch-section.js';
import type { WebsearchPolicy } from '../connection/use-settings-websearch.js';
import { SS, UV } from '../shared/settings-section-styles.js';

interface WebsearchPluginPanelProps {
  isSaving: boolean;
  policy: WebsearchPolicy;
  savedPolicy: WebsearchPolicy;
  setPolicy: React.Dispatch<React.SetStateAction<WebsearchPolicy>>;
  searchServers: MCPServerEntry[];
  searchStatuses: MCPServerStatus[];
  onRemoveMcp: (id: string) => void;
  onRetryMcp: (serverId: string) => void;
  onSave: () => void;
  onUpdateMcp: (id: string, entry: MCPServerEntry) => void;
}

const HEADER_COPY = {
  title: 'Web 搜索',
  description:
    '统一管理默认搜索 MCP 与原生 Provider 回退策略。默认使用内置免 Key 的 Open WebSearch，Exa 作为可选补充。',
} as const;

// ── KPI 风格统计卡片 ──────────────────────────────────────────

const KPI_CARD: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  background: 'linear-gradient(180deg, var(--bg-overlay), var(--bg-raised))',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  position: 'relative',
};

const KPI_CARD_AFTER: CSSProperties = {
  content: '""',
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  background: 'linear-gradient(90deg, transparent, var(--border-emphasis), transparent)',
  borderRadius: '8px 8px 0 0',
};

const KPI_NUMBER: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.2,
};

const KPI_LABEL: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  fontWeight: 500,
};

const KPI_ICON_WRAP: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// ── 概览信息 ──────────────────────────────────────────────────

const OVERVIEW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
};

const PATH_ITEM: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
};

const PATH_DOT: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
};

const PATH_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const PATH_HINT: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
};

const NOTICE_STYLE: CSSProperties = {
  margin: 0,
  color: 'var(--fg-muted)',
  fontSize: 11,
  lineHeight: 1.5,
};

// ── Section 标题行 ────────────────────────────────────────────

const SECTION_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const SECTION_ICON_WRAP: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const SECTION_TITLE_TEXT: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

function noopAddServer(_entry: MCPServerEntry): void {
  return undefined;
}

export function WebsearchPluginPanel({
  isSaving,
  policy,
  savedPolicy,
  setPolicy,
  searchServers,
  searchStatuses,
  onRemoveMcp,
  onRetryMcp,
  onSave,
  onUpdateMcp,
}: WebsearchPluginPanelProps): React.ReactElement {
  const enabledCount = searchServers.filter((server) => server.enabled !== false).length;
  const connectedCount = searchStatuses.filter((server) => server.status === 'connected').length;
  const totalCount = searchServers.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {/* ── 标题 ── */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-strong)' }}>
          {HEADER_COPY.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.5 }}>
          {HEADER_COPY.description}
        </div>
      </div>

      {/* ── KPI 统计卡片行 ── */}
      <div style={OVERVIEW_STYLE}>
        <div style={KPI_CARD}>
          <span style={{ ...KPI_CARD_AFTER, pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                ...KPI_ICON_WRAP,
                background: 'var(--accent-muted)',
                border: '1px solid var(--accent-border)',
                color: 'var(--accent)',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <path d="M22 4L12 14.01l-3-3" />
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={KPI_NUMBER}>{enabledCount}</div>
              <div style={KPI_LABEL}>已启用 MCP</div>
            </div>
          </div>
        </div>
        <div style={KPI_CARD}>
          <span style={{ ...KPI_CARD_AFTER, pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                ...KPI_ICON_WRAP,
                background: 'color-mix(in oklch, var(--chart-6) 14%, transparent)',
                border: '1px solid color-mix(in oklch, var(--chart-6) 30%, transparent)',
                color: 'var(--chart-6)',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={KPI_NUMBER}>{connectedCount}</div>
              <div style={KPI_LABEL}>已连接</div>
            </div>
          </div>
        </div>
        <div style={KPI_CARD}>
          <span style={{ ...KPI_CARD_AFTER, pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                ...KPI_ICON_WRAP,
                background: 'var(--aux-muted)',
                border: '1px solid var(--aux-border)',
                color: 'var(--aux)',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={KPI_NUMBER}>{totalCount}</div>
              <div style={KPI_LABEL}>搜索 MCP 总数</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 搜索路径概览 ── */}
      <section style={{ ...SS, marginBottom: 0, padding: '12px 16px', gap: '10px' }}>
        <div style={SECTION_HEADER}>
          <span
            style={{
              ...SECTION_ICON_WRAP,
              background: 'var(--accent-muted)',
              border: '1px solid var(--accent-border)',
              color: 'var(--accent)',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </span>
          <span style={SECTION_TITLE_TEXT}>默认搜索路径</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={PATH_ITEM}>
            <span style={{ ...PATH_DOT, background: 'var(--accent)' }} />
            <span style={PATH_LABEL}>默认</span>
            <span style={PATH_HINT}>Open WebSearch</span>
          </span>
          <span style={PATH_ITEM}>
            <span style={{ ...PATH_DOT, background: 'var(--contrast)' }} />
            <span style={PATH_LABEL}>补充</span>
            <span style={PATH_HINT}>Exa Web Search</span>
          </span>
        </div>
        <p style={NOTICE_STYLE}>
          Open WebSearch 由 Gateway 内置，默认启用且免 Key；Exa 作为可选商业搜索补充，原生
          <code> websearch </code> provider 回退策略在下方面板配置。
        </p>
      </section>

      {/* ── 搜索 MCP 配置 ── */}
      <section style={{ ...SS, marginBottom: 0, padding: '12px 16px', gap: '10px' }}>
        <div style={SECTION_HEADER}>
          <span
            style={{
              ...SECTION_ICON_WRAP,
              background: 'var(--aux-muted)',
              border: '1px solid var(--aux-border)',
              color: 'var(--aux)',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </span>
          <span style={SECTION_TITLE_TEXT}>搜索 MCP 配置</span>
        </div>
        <div style={UV}>
          <MCPServerConfig
            title="搜索 MCP 配置"
            showAddForm={false}
            servers={searchServers}
            onAdd={noopAddServer}
            onRemove={onRemoveMcp}
            onUpdate={onUpdateMcp}
          />
        </div>
      </section>

      {/* ── 搜索 MCP 运行状态 ── */}
      <section style={{ ...SS, marginBottom: 0, padding: '12px 16px', gap: '10px' }}>
        <div style={SECTION_HEADER}>
          <span
            style={{
              ...SECTION_ICON_WRAP,
              background: 'color-mix(in oklch, var(--chart-6) 14%, transparent)',
              border: '1px solid color-mix(in oklch, var(--chart-6) 30%, transparent)',
              color: 'var(--chart-6)',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </span>
          <span style={SECTION_TITLE_TEXT}>搜索 MCP 运行状态</span>
        </div>
        <div style={UV}>
          <MCPServerList servers={searchStatuses} onRetry={onRetryMcp} />
        </div>
      </section>

      {/* ── Provider 回退策略 ── */}
      <WebsearchSection
        isSaving={isSaving}
        policy={policy}
        savedPolicy={savedPolicy}
        setPolicy={setPolicy}
        onSave={onSave}
      />
    </div>
  );
}
