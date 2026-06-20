import { useEffect, useState, type CSSProperties } from 'react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type { MultiLayerViewMode } from './TeamViewModeToggle.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';
import { buildTeamAssistantPresentation } from './team-assistant-presentation.js';
import { tryFormatJson, looksLikeJson } from '../../../../utils/format-json.js';

export interface LayerMessages {
  layer: string;
  messages: ChatMessage[];
  sessionIds: string[];
  isActive: boolean;
  /** 该层角色实例的显示名称（如"前端开发者"），同层多角色时取第一个 */
  displayName?: string | null;
  /**
   * 当前正在流式生成的消息（仅活跃层在流式时存在）。
   * 前端通过 attach/startStream 接收 text_delta 实时累积的内容，
   * 在消息汇总面板中以"正在输入"样式渲染，流式结束后被正式 messages 条目取代。
   */
  streamingMessage?: ChatMessage | null;
}

export interface TeamMultiLayerPanelProps {
  activeLayer?: string | null;
  currentSessionId?: string | null;
  layers: LayerMessages[];
  viewMode: MultiLayerViewMode;
  onLayerSelect?: (layer: string) => void;
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--bg-base)',
  borderLeft: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--spacing-2, 8px)',
  padding: 'var(--spacing-3, 12px)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base)), var(--bg-base))',
  flexShrink: 0,
};

const HEADER_TOP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2, 8px)',
};

const HEADER_TITLE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0,
};

const METRIC_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2, 8px)',
  flexWrap: 'wrap',
};

const METRIC_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-1, 4px)',
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill, 9999px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 38%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 68%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  padding: '0 8px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  background: 'var(--bg-overlay)',
  flexShrink: 0,
  overflowX: 'auto',
};

const TAB_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-muted)',
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 2,
  borderLeftWidth: 1,
  borderStyle: 'solid',
  borderTopColor: 'transparent',
  borderRightColor: 'transparent',
  borderBottomColor: 'transparent',
  borderLeftColor: 'transparent',
  cursor: 'pointer',
  transition: 'all 150ms ease',
  whiteSpace: 'nowrap',
  background: 'transparent',
};

const TAB_ACTIVE_STYLE: CSSProperties = {
  ...TAB_STYLE,
  color: 'var(--fg-strong)',
  borderBottomColor: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
};

const CONTENT_STYLE: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 8,
};

const LAYER_DETAIL_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2, 8px)',
  marginBottom: 'var(--spacing-2, 8px)',
  padding: 'var(--spacing-2, 8px) var(--spacing-3, 12px)',
  borderRadius: 'var(--radius-md, 8px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 62%, transparent)',
};

const WATERFALL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  height: '100%',
  overflow: 'auto',
};

const LAYER_CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  background: 'var(--bg-overlay)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 20%, transparent)',
};

const LAYER_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const LAYER_DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
};

const LAYER_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

const LAYER_CODE_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: 4,
  fontVariantNumeric: 'tabular-nums',
};

const MESSAGE_SUMMARY_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--fg-default)',
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

const MESSAGE_DETAIL_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: 'var(--fg-default)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

/** JSON 内容专用样式 */
const MESSAGE_JSON_DETAIL_STYLE: CSSProperties = {
  ...MESSAGE_DETAIL_STYLE,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 11,
  whiteSpace: 'pre',
  overflowX: 'auto',
};

const MESSAGE_TIME_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-subtle)',
  fontVariantNumeric: 'tabular-nums',
};

const TIMELINE_CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};

const TIMELINE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  padding: '6px 8px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  background: 'var(--bg-overlay)',
  flexShrink: 0,
};

const TIMELINE_LANE_LABEL_STYLE: CSSProperties = {
  width: 80,
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 8px',
  textAlign: 'right',
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
};

const TIMELINE_BODY_STYLE: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 8,
};

const TIMELINE_LANE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  marginBottom: 8,
  minHeight: 40,
};

const TIMELINE_LANE_CONTENT_STYLE: CSSProperties = {
  flex: 1,
  display: 'flex',
  gap: 6,
  overflowX: 'auto',
  padding: '2px 0',
};

const TIMELINE_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  borderRadius: 6,
  background: 'var(--bg-overlay)',
  minWidth: 120,
  maxWidth: 180,
  flexShrink: 0,
};

const EMPTY_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--fg-subtle)',
  fontSize: 12,
};

function formatTime(ts: number | string | undefined): string {
  if (!ts) return '';
  const d = new Date(typeof ts === 'string' ? parseInt(ts, 10) : ts);
  if (isNaN(d.getTime())) return '';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getMessageSummary(message: ChatMessage): string {
  const presentation = buildTeamAssistantPresentation(message);
  if (presentation.summaryText) {
    return presentation.summaryText.slice(0, 100);
  }
  return message.content.slice(0, 100) || '（空消息）';
}

function getMessageDetailText(message: ChatMessage): string {
  if (message.role === 'user') {
    return message.content || '（空消息）';
  }
  const presentation = buildTeamAssistantPresentation(message);
  const raw = presentation.detailText || presentation.summaryText || message.content || '（空消息）';
  // 如果内容是 JSON 字符串，自动格式化
  return tryFormatJson(raw);
}

function LayerDetailHeader({ layer }: { layer: LayerMessages }) {
  const id = getRoleLayerIdentity(layer.layer);

  return (
    <div style={LAYER_DETAIL_HEADER_STYLE}>
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>{id.label}历史</strong>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
          {layer.messages.length} 条消息 · {layer.sessionIds.length} 个会话
        </span>
      </span>
    </div>
  );
}

function TabView({
  activeLayer: externalActiveLayer,
  layers,
  onLayerSelect,
}: {
  activeLayer?: string | null;
  layers: LayerMessages[];
  onLayerSelect?: (layer: string) => void;
}) {
  const [activeTab, setActiveTab] = useState(externalActiveLayer ?? layers[0]?.layer ?? '');

  useEffect(() => {
    const nextLayer =
      externalActiveLayer && layers.some((layer) => layer.layer === externalActiveLayer)
        ? externalActiveLayer
        : layers.some((layer) => layer.layer === activeTab)
          ? activeTab
          : (layers[0]?.layer ?? '');
    if (nextLayer !== activeTab) {
      setActiveTab(nextLayer);
    }
  }, [activeTab, externalActiveLayer, layers]);

  const activeLayer = layers.find((l) => l.layer === activeTab);

  const handleTabClick = (layer: string) => {
    setActiveTab(layer);
    onLayerSelect?.(layer);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={TAB_BAR_STYLE}>
        {layers.map((layer) => {
          const id = getRoleLayerIdentity(layer.layer);
          const isActive = layer.layer === activeTab;
          return (
            <button
              key={layer.layer}
              type="button"
              className="team-v2-control"
              style={{
                ...(isActive ? TAB_ACTIVE_STYLE : TAB_STYLE),
                borderBottomColor: isActive ? id.color : 'transparent',
              }}
              onClick={() => handleTabClick(layer.layer)}
            >
              <span style={{ fontSize: 14 }}>{id.icon}</span>
              <span>{id.short}</span>
              {layer.messages.length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: isActive
                      ? `color-mix(in srgb, ${id.color} 15%, transparent)`
                      : 'var(--bg-surface)',
                    color: isActive ? id.color : 'var(--fg-subtle)',
                  }}
                >
                  {layer.messages.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={CONTENT_STYLE}>
        {activeLayer ? <LayerDetailHeader layer={activeLayer} /> : null}
        {activeLayer && activeLayer.messages.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeLayer.messages.map((msg) => {
              const detailText = getMessageDetailText(msg);
              const isJson = msg.role !== 'user' && looksLikeJson(detailText);
              return (
              <div
                key={msg.id}
                style={{
                  ...LAYER_CARD_STYLE,
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span style={MESSAGE_TIME_STYLE}>{formatTime(msg.createdAt)}</span>
                </div>
                <div style={isJson ? MESSAGE_JSON_DETAIL_STYLE : MESSAGE_DETAIL_STYLE}>{detailText}</div>
              </div>
              );
            })}
          </div>
        ) : (
          <div style={EMPTY_STYLE}>该层暂无消息</div>
        )}
      </div>
    </div>
  );
}

function WaterfallView({
function WaterfallView({ layers }: { layers: LayerMessages[] }) {
  return (
    <div style={WATERFALL_STYLE}>
      {layers.map((layer) => {
        const id = getRoleLayerIdentity(layer.layer);
        return (
          <div
            key={layer.layer}
            style={{
              ...LAYER_CARD_STYLE,
            }}
          >
            <div style={LAYER_HEADER_STYLE}>
              <span style={{ ...LAYER_DOT_STYLE, background: id.color }} />
              <span style={LAYER_LABEL_STYLE}>{id.short}</span>
              {id.code && (
                <span
                  style={{
                    ...LAYER_CODE_STYLE,
                    color: id.color,
                    background: `color-mix(in srgb, ${id.color} 12%, transparent)`,
                  }}
                >
                  {id.code}
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--fg-subtle)', marginLeft: 'auto' }}>
                {layer.messages.length}
              </span>
            </div>
            {layer.messages.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {layer.messages.slice(-3).map((msg) => (
                  <div key={msg.id} style={MESSAGE_SUMMARY_STYLE}>
                    {getMessageSummary(msg)}
                  </div>
                ))}
                {layer.messages.length > 3 && (
                  <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
                    +{layer.messages.length - 3}
                  </span>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>暂无消息</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ layers }: { layers: LayerMessages[] }) {
  const allMessages = layers.flatMap((l) => l.messages.map((m) => ({ ...m, _layer: l.layer })));
  allMessages.sort((a, b) => {
    const aTime = typeof a.createdAt === 'string' ? parseInt(a.createdAt, 10) : (a.createdAt ?? 0);
    const bTime = typeof b.createdAt === 'string' ? parseInt(b.createdAt, 10) : (b.createdAt ?? 0);
    return aTime - bTime;
  });

  const timeSlots = new Map<string, typeof allMessages>();
  for (const msg of allMessages) {
    const key = formatTime(msg.createdAt);
    if (!timeSlots.has(key)) timeSlots.set(key, []);
    timeSlots.get(key)!.push(msg);
  }

  return (
    <div style={TIMELINE_CONTAINER_STYLE}>
      <div style={TIMELINE_HEADER_STYLE}>
        <div style={TIMELINE_LANE_LABEL_STYLE}>时间</div>
        {layers.map((layer) => {
          const id = getRoleLayerIdentity(layer.layer);
          return (
            <div
              key={layer.layer}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                fontSize: 11,
                fontWeight: 700,
                color: id.color,
              }}
            >
              <span style={{ fontSize: 12 }}>{id.icon}</span>
              <span>{id.short}</span>
            </div>
          );
        })}
      </div>
      <div style={TIMELINE_BODY_STYLE}>
        {Array.from(timeSlots.entries()).map(([time, msgs]) => (
          <div key={time} style={TIMELINE_LANE_STYLE}>
            <div style={TIMELINE_LANE_LABEL_STYLE}>{time}</div>
            <div style={TIMELINE_LANE_CONTENT_STYLE}>
              {layers.map((layer) => {
                const layerMsgs = msgs.filter((m) => m._layer === layer.layer);
                const id = getRoleLayerIdentity(layer.layer);
                return (
                  <div
                    key={layer.layer}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {layerMsgs.map((msg) => (
                      <div
                        key={msg.id}
                        style={{
                          ...TIMELINE_ITEM_STYLE,
                        }}
                      >
                        <div style={MESSAGE_SUMMARY_STYLE}>{getMessageSummary(msg)}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamMultiLayerPanel({
  activeLayer,
  currentSessionId: _currentSessionId,
  layers,
  viewMode,
  onLayerSelect,
}: TeamMultiLayerPanelProps) {
  if (layers.length === 0) {
    return (
      <div style={PANEL_STYLE}>
        <div style={EMPTY_STYLE}>暂无层级数据</div>
      </div>
    );
  }

  const activeLayerCount = layers.filter((layer) => layer.messages.length > 0).length;
  const totalMessageCount = layers.reduce((sum, layer) => sum + layer.messages.length, 0);
  const totalSessionCount = layers.reduce((sum, layer) => sum + layer.sessionIds.length, 0);

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <div style={HEADER_TOP_STYLE}>
          <span style={HEADER_TITLE_STYLE}>
            <strong style={{ color: 'var(--fg-strong)', fontSize: 13 }}>团队分层流程</strong>
            <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
              旁路查看其它层级的真实会话消息，不打断当前主对话。
            </span>
          </span>
        </div>
        <div style={METRIC_ROW_STYLE} aria-label="团队分层流程摘要">
          <span style={METRIC_PILL_STYLE}>
            <span>有消息层级</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{activeLayerCount}</strong>
          </span>
          <span style={METRIC_PILL_STYLE}>
            <span>会话</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{totalSessionCount}</strong>
          </span>
          <span style={METRIC_PILL_STYLE}>
            <span>消息</span>
            <strong style={{ color: 'var(--fg-strong)' }}>{totalMessageCount}</strong>
          </span>
        </div>
      </div>
      {viewMode === 'tab' && (
        <TabView activeLayer={activeLayer} layers={layers} onLayerSelect={onLayerSelect} />
      )}
      {viewMode === 'waterfall' && <WaterfallView layers={layers} />}
      {viewMode === 'timeline' && <TimelineView layers={layers} />}
    </div>
  );
}
