/**
 * TeamRoleTypingIndicator · 团队 AI 角色「正在输入」指示
 *
 * team 对话发送后、首个 token 到达前（streaming=true 但 visibleStreaming=false），
 * 或后端 session 处于 running 但本地未在流式渲染时，显示一个带角色身份的 typing
 * 占位：彩色头像点 + 「X 层 正在思考…」+ 三点跳动动画。让用户明确知道「AI 正在
 * 干活」，而不是卡住了。
 *
 * 与 chat 的 ChatRemoteStreamPlaceholder 区别：这里带 team 的角色身份（取自
 * role-layer-identity），措辞按层级定制，视觉与消息角色头一致。
 */

import type { CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';

export interface TeamRoleTypingIndicatorProps {
  /** 当前会话层级，决定头像/配色/文案。 */
  roleLayer: string | null | undefined;
  /** 是否显示。 */
  visible: boolean;
}

const ROW_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  margin: '8px 0',
  padding: '5px 14px 5px 5px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  width: 'fit-content',
};

const DOT_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  fontSize: 12,
  flexShrink: 0,
};

export function TeamRoleTypingIndicator({ roleLayer, visible }: TeamRoleTypingIndicatorProps) {
  if (!visible) return null;
  const id = getRoleLayerIdentity(roleLayer);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${id.label}正在生成回复`}
      style={{
        ...ROW_STYLE,
        color: id.color,
        background: `color-mix(in srgb, ${id.color} 10%, var(--bg-overlay))`,
        border: `1px solid color-mix(in srgb, ${id.color} 28%, transparent)`,
      }}
    >
      <span
        aria-hidden
        style={{
          ...DOT_STYLE,
          background: `color-mix(in srgb, ${id.color} 20%, var(--bg-overlay))`,
          border: `1px solid color-mix(in srgb, ${id.color} 45%, transparent)`,
          animation: 'team-flow-node-pulse 1.8s ease-in-out infinite',
          // team-flow-node-pulse 读这两个 CSS 变量（见 team-runtime.css）。
          ['--team-flow-glow' as string]: `color-mix(in srgb, ${id.color} 45%, transparent)`,
          ['--team-flow-glow-mid' as string]: id.color,
        }}
      >
        {id.icon}
      </span>
      <span>{id.short} 正在思考</span>
      <span aria-hidden style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
        <Dot color={id.color} delay="0s" />
        <Dot color={id.color} delay="0.2s" />
        <Dot color={id.color} delay="0.4s" />
      </span>
    </div>
  );
}

function Dot({ color, delay }: { color: string; delay: string }) {
  return (
    <span
      style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: color,
        animation: 'team-typing-bounce 1.2s ease-in-out infinite',
        animationDelay: delay,
      }}
    />
  );
}
