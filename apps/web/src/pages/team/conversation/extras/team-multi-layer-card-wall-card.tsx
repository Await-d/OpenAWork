import { useCallback, useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import { InlinePermissionQuickBar } from '../../../../components/chat/session/ChatPageSections.js';
import type { ResolveInlinePermissionActionsFn } from '../../../../components/chat/session/ChatPageSections.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import {
  getRoleLayerIdentity,
  getRoleLayerIdentityFromAgentId,
  type RoleLayerIdentity,
} from '../../runtime/data/role-layer-identity.js';
import {
  CARD_MAX_WIDTH,
  CARD_WIDTH,
  EXPANDED_MESSAGE_LIMIT,
  STATUS_TONES,
} from './team-multi-layer-card-wall-constants.js';
import {
  buildMessageSignature,
  formatEndedAt,
  hasStreamContent,
  instanceKey,
  resolveCardStatus,
  resolveTerminalStatus,
  selectPendingPermissions,
} from './team-multi-layer-card-wall-model.js';
import {
  BUBBLE_ASSISTANT_STYLE,
  BUBBLE_ROLE_STYLE,
  BUBBLE_TEXT_STYLE,
  BUBBLE_USER_STYLE,
  CARD_ACTION_STYLE,
  CARD_BASE_STYLE,
  CARD_EXPAND_BUTTON_STYLE,
  CARD_FOOTER_STYLE,
  CARD_HEADER_STYLE,
  CARD_NAME_STYLE,
  CARD_SUB_STYLE,
  CARD_TITLE_BUTTON_STYLE,
  CARD_TITLE_TEXT_STYLE,
  COLLAPSED_BODY_STYLE,
  EMPTY_BODY_STYLE,
  ENDED_STRIP_STYLE,
  EXPANDED_BODY_STYLE,
  FAILURE_REASON_STYLE,
  LATEST_MESSAGE_STYLE,
  LATEST_MESSAGE_TEXT_STYLE,
  OMITTED_STYLE,
  PERMISSION_STRIP_STYLE,
  STATUS_DOT_STYLE,
  STATUS_GLYPH_STYLE,
  UPSTREAM_ARROW_STYLE,
  UPSTREAM_STYLE,
} from './team-multi-layer-card-wall-styles.js';
import type { CardPendingPermission } from './team-multi-layer-card-wall-types.js';
import type { LayerMessages } from './team-layer-messages.js';
import { getTeamMessagePreviewText, TeamMessageBody } from './team-message-content.js';
import { TeamRoleTypingIndicator } from './TeamRoleTypingIndicator.js';
import { useStickToBottom } from './use-stick-to-bottom.js';

interface CardMessageProps {
  message: ChatMessage;
  fallbackIdentity: RoleLayerIdentity;
  /** `latest`：折叠态的紧凑单条；`bubble`：展开态的 chat 气泡。 */
  variant: 'latest' | 'bubble';
  streaming: boolean;
}

function CardMessage({
  message,
  fallbackIdentity,
  variant,
  streaming,
}: CardMessageProps): ReactElement {
  const isUser = message.role === 'user';
  // assistant 消息优先按 agentId 反解身份 —— 同一张卡片里的消息也可能来自不同 agent。
  const identity =
    !isUser && message.agentId
      ? getRoleLayerIdentityFromAgentId(message.agentId)
      : fallbackIdentity;
  const roleLabel = isUser ? '用户' : identity.short;

  if (variant === 'latest') {
    return (
      <div
        style={{
          ...LATEST_MESSAGE_STYLE,
          borderLeftColor: isUser
            ? 'color-mix(in srgb, var(--accent) 45%, transparent)'
            : `color-mix(in srgb, ${identity.color} 55%, transparent)`,
        }}
      >
        <span style={LATEST_MESSAGE_TEXT_STYLE}>{getTeamMessagePreviewText(message)}</span>
      </div>
    );
  }

  return (
    <div style={isUser ? BUBBLE_USER_STYLE : BUBBLE_ASSISTANT_STYLE}>
      <span
        style={{
          ...BUBBLE_ROLE_STYLE,
          color: isUser ? 'var(--fg-muted)' : identity.color,
        }}
      >
        {roleLabel}
        {streaming ? ' · 正在生成' : ''}
      </span>
      <TeamMessageBody message={message} textStyle={BUBBLE_TEXT_STYLE} />
    </div>
  );
}

interface LayerRoleCardProps {
  instance: LayerMessages;
  identity: RoleLayerIdentity;
  expanded: boolean;
  onToggleExpanded: (key: string) => void;
  onLayerSelect?: (layer: string) => void;
  /** 该实例自己那条 session 上未处理的权限请求。 */
  pendingPermissions?: readonly CardPendingPermission[];
  resolveInlinePermissionActions?: ResolveInlinePermissionActionsFn;
  onOpenSession?: (sessionId: string) => void;
}

export function LayerRoleCard({
  instance,
  identity,
  expanded,
  onToggleExpanded,
  onLayerSelect,
  pendingPermissions,
  resolveInlinePermissionActions,
  onOpenSession,
}: LayerRoleCardProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 终态实例一律不再显示流式内容：它已经结束了，残留的 streamingMessage（推送丢失时会留下）
  // 只会让人误以为它还在说话。折叠态因此回落到最后一条正式消息，正好是它的「临终留言」。
  const terminalStatus = resolveTerminalStatus(instance);
  const streaming = terminalStatus ? null : (instance.streamingMessage ?? null);
  const streamHasContent = hasStreamContent(streaming);
  const status = resolveCardStatus(instance);
  const tone = STATUS_TONES[status];
  const key = instanceKey(instance);
  const endedLabel = terminalStatus ? formatEndedAt(instance.endedAt) : null;
  const failureReason = terminalStatus === 'failed' ? instance.failureReason?.trim() || null : null;

  // 折叠态不渲染历史消息（只留最新一条）；展开态渲染最近 EXPANDED_MESSAGE_LIMIT 条。
  const visibleMessages = useMemo(
    () => (expanded ? instance.messages.slice(-EXPANDED_MESSAGE_LIMIT) : []),
    [expanded, instance.messages],
  );
  const latestMessage = useMemo(
    () => streaming ?? instance.messages[instance.messages.length - 1] ?? null,
    [instance.messages, streaming],
  );
  const hiddenCount = expanded ? Math.max(0, instance.messages.length - visibleMessages.length) : 0;

  const signature = expanded
    ? buildMessageSignature(visibleMessages, streaming)
    : [
        String(instance.messages.length),
        latestMessage?.id ?? '',
        String(streaming?.content?.length ?? 0),
      ].join('|');
  const hasContent = latestMessage !== null;
  // 折叠态不滚动（只看最新一条），因此只在展开态开启贴底跟随。
  const { pinned, pinToBottom } = useStickToBottom(scrollRef, signature, expanded && hasContent);

  const sourceIdentity = instance.sourceLayer ? getRoleLayerIdentity(instance.sourceLayer) : null;
  const showTypingPlaceholder = streaming !== null && !streamHasContent;

  // 权限请求按实例的 session 归位（见 selectPendingPermissions 注释）。
  const cardPermissions = selectPendingPermissions(pendingPermissions, instance);
  const showPermissionStrip =
    cardPermissions.length > 0 && resolveInlinePermissionActions !== undefined;

  // 主会话卡片不给「打开完整会话」入口 —— 用户此刻就在这个会话里，点了只会触发
  // 一次无意义的重新选中（还会顺带切 middle tab、关掉文件编辑器浮层）。
  const openSessionTarget = instance.isActive ? undefined : instance.sessionIds[0];
  const canOpenSession = Boolean(openSessionTarget && onOpenSession);
  // 「回到底部」只在展开态、有内容、且用户已经上滚离开底部时出现（见 useStickToBottom）。
  const showPinToBottom = expanded && hasContent && !pinned;

  const handleSelect = useCallback(() => {
    onLayerSelect?.(instance.layer);
  }, [instance.layer, onLayerSelect]);

  const handleToggle = useCallback(() => {
    onToggleExpanded(key);
  }, [key, onToggleExpanded]);

  const handleOpenSession = useCallback(() => {
    if (openSessionTarget) {
      onOpenSession?.(openSessionTarget);
    }
  }, [onOpenSession, openSessionTarget]);

  const cardStyle: CSSProperties = {
    ...CARD_BASE_STYLE,
    // 基准宽度 + 等分剩余空间（上限 CARD_MAX_WIDTH）：面板越宽，卡片越舒展。
    flex: `1 1 ${String(CARD_WIDTH)}px`,
    maxWidth: CARD_MAX_WIDTH,
    // 主会话卡片：底色按角色色轻微染色 + 一圈内描边做「当前窗口」的高亮。
    // 内描边走 boxShadow 而不是 border：它不参与布局，高亮切换时卡片不会跳 1px。
    ...(instance.isActive
      ? {
          background: `color-mix(in srgb, ${identity.color} 6%, var(--bg-overlay))`,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${identity.color} 26%, transparent), var(--shadow-sm)`,
        }
      : null),
    // 终态：底色按状态色轻微染色 + 状态色内描边，和「活着」的卡片区分开。
    // 刻意不降低不透明度 —— 已结束的实例仍要被阅读，弱化到发灰就本末倒置了；
    // 也不再用虚线边框 —— 没有 borderWidth 的 dashed 会渲染成浏览器默认的 3px 粗虚线。
    ...(terminalStatus
      ? {
          background: `color-mix(in srgb, ${tone.color} 5%, var(--bg-overlay))`,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone.color} 20%, transparent), var(--shadow-sm)`,
        }
      : null),
  };

  return (
    <section style={cardStyle} aria-label={`${instance.displayName ?? identity.label} 的对话窗口`}>
      <header style={CARD_HEADER_STYLE}>
        <button
          type="button"
          style={CARD_TITLE_BUTTON_STYLE}
          onClick={handleSelect}
          title={`聚焦${identity.label}`}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 20,
              height: 20,
              borderRadius: '50%',
              flexShrink: 0,
              fontSize: 10.5,
              fontWeight: 800,
              color: identity.color,
              background: `color-mix(in srgb, ${identity.color} 18%, var(--bg-surface))`,
            }}
          >
            {identity.initials}
          </span>
          <span style={CARD_TITLE_TEXT_STYLE}>
            <span style={CARD_NAME_STYLE}>{instance.displayName ?? identity.label}</span>
            <span style={CARD_SUB_STYLE}>
              {identity.code ? `${identity.code} · ` : ''}
              {identity.label} · {instance.messages.length} 条
            </span>
          </span>
        </button>
        <button
          type="button"
          className="team-v2-control team-v2-control--surface"
          style={CARD_EXPAND_BUTTON_STYLE}
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}${instance.displayName ?? identity.label}的对话`}
          title={expanded ? '收起为最新一条' : '展开为对话详情'}
        >
          {expanded ? '▴' : '▾'}
        </button>
        {terminalStatus ? (
          // 终态：色点换成图标徽章。一眼能分出「还在跑」的脉冲点和「已经结束」的图标。
          <span
            role="img"
            aria-label={tone.label}
            title={endedLabel ? `${tone.label} · ${endedLabel}` : tone.label}
            style={{
              ...STATUS_GLYPH_STYLE,
              color: tone.color,
              background: `color-mix(in srgb, ${tone.color} 12%, transparent)`,
            }}
          >
            {tone.glyph}
          </span>
        ) : (
          <span
            role="img"
            aria-label={tone.label}
            title={tone.label}
            style={{
              ...STATUS_DOT_STYLE,
              background: tone.color,
              ...(tone.pulse
                ? {
                    animation: 'team-flow-node-pulse 1.8s ease-in-out infinite',
                    // team-flow-node-pulse 读取这两个变量（见 team-runtime-flow-animations.css）。
                    ['--team-flow-glow' as string]: `color-mix(in srgb, ${identity.color} 45%, transparent)`,
                    ['--team-flow-glow-mid' as string]: identity.color,
                  }
                : null),
            }}
          />
        )}
      </header>

      {/* 上游来源 —— 层级对话的上下关系在这里落地（细字一行，不做徽章条） */}
      <div style={UPSTREAM_STYLE}>
        <span
          aria-hidden
          style={{
            ...UPSTREAM_ARROW_STYLE,
            ...(sourceIdentity ? { color: sourceIdentity.color } : null),
          }}
        >
          ↳
        </span>
        {sourceIdentity ? (
          <>
            <span style={{ color: sourceIdentity.color, fontWeight: 600, flexShrink: 0 }}>
              上游 {sourceIdentity.short}
            </span>
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={instance.sourceDisplayName ?? undefined}
            >
              {instance.sourceDisplayName ?? sourceIdentity.label}
            </span>
          </>
        ) : (
          <span>顶层入口</span>
        )}
      </div>

      {/* 待处理权限 —— 放在消息区之外，折叠态也不会被裁掉（见 PERMISSION_STRIP_STYLE） */}
      {showPermissionStrip && resolveInlinePermissionActions ? (
        <div style={PERMISSION_STRIP_STYLE}>
          <InlinePermissionQuickBar
            dense
            permissions={cardPermissions}
            resolveActions={resolveInlinePermissionActions}
          />
        </div>
      ) : null}

      <div ref={scrollRef} style={expanded ? EXPANDED_BODY_STYLE : COLLAPSED_BODY_STYLE}>
        {hiddenCount > 0 ? <div style={OMITTED_STYLE}>更早 {hiddenCount} 条已折叠</div> : null}

        {expanded ? (
          <>
            {visibleMessages.length === 0 && !showTypingPlaceholder ? (
              <div style={EMPTY_BODY_STYLE}>该角色暂无消息。</div>
            ) : null}
            {visibleMessages.map((message) => (
              <CardMessage
                key={message.id}
                message={message}
                fallbackIdentity={identity}
                variant="bubble"
                streaming={false}
              />
            ))}
            {streaming && streamHasContent ? (
              <CardMessage
                message={streaming}
                fallbackIdentity={identity}
                variant="bubble"
                streaming
              />
            ) : null}
            {showTypingPlaceholder ? (
              <TeamRoleTypingIndicator roleLayer={instance.layer} visible />
            ) : null}
          </>
        ) : (
          <>
            {latestMessage && !showTypingPlaceholder ? (
              <CardMessage
                message={latestMessage}
                fallbackIdentity={identity}
                variant="latest"
                streaming={streaming !== null}
              />
            ) : null}
            {showTypingPlaceholder ? (
              <TeamRoleTypingIndicator roleLayer={instance.layer} visible />
            ) : null}
            {latestMessage === null ? <div style={EMPTY_BODY_STYLE}>该角色暂无消息。</div> : null}
          </>
        )}
      </div>

      {/* 终态标识条 —— 折叠 / 展开两态都显示：实例关掉了，但它的对话仍可查阅。 */}
      {terminalStatus ? (
        <div
          style={{
            ...ENDED_STRIP_STYLE,
            color: tone.color,
            background: `color-mix(in srgb, ${tone.color} 7%, transparent)`,
          }}
        >
          <span aria-hidden>{tone.glyph}</span>
          <span>{tone.label}</span>
          {endedLabel ? (
            <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>· {endedLabel}</span>
          ) : null}
        </div>
      ) : null}

      {failureReason ? (
        <div style={FAILURE_REASON_STYLE} title={failureReason}>
          {failureReason}
        </div>
      ) : null}

      {/*
        底栏只在真的有动作时出现：折叠态的「展开」已经在身份头右侧给了一个按钮，
        底栏再放一个同名按钮只是把同一个动作说两遍，还白白占掉一行高度。
      */}
      {showPinToBottom || canOpenSession ? (
        <footer style={CARD_FOOTER_STYLE}>
          {showPinToBottom ? (
            <button
              type="button"
              className="team-v2-control team-v2-control--surface"
              style={CARD_ACTION_STYLE}
              onClick={pinToBottom}
            >
              回到底部
            </button>
          ) : null}
          {canOpenSession ? (
            <button
              type="button"
              className="team-v2-control team-v2-control--surface"
              style={CARD_ACTION_STYLE}
              onClick={handleOpenSession}
              title="在底部面板打开该角色的完整会话"
              aria-label={`打开${instance.displayName ?? identity.label}的完整会话`}
            >
              完整会话
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
