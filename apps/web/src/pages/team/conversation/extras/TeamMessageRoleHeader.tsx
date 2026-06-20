/**
 * TeamMessageRoleHeader · 团队消息「角色身份头」
 *
 * 背景：team 对话流复用 chat 的 MessageRow，assistant 消息的作者只显示模型名
 * （如「claude-sonnet」），完全看不出「这是接待层 / 规划层 / 执行层在说话」，
 * 和普通 chat 没区别。本组件在每个 assistant 消息组的首条前注入一行紧凑的角色
 * 身份标识：彩色头像点 + 层级名 + 字母代号，配色取自共享的 role-layer-identity。
 *
 * 设计：
 *   - 只在「消息组首条」渲染（相邻同层消息不重复刷身份头），由调用方控制。
 *   - 用层级主配色描边/底色，与顶部 substate 进度条、状态栏视觉统一。
 *   - 紧贴在消息内容上方，作为 renderContent 的前缀注入，不改 MessageRow 结构。
 */

import type { CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';

export interface TeamMessageRoleHeaderProps {
  /** 该消息所属会话的 role_layer。null/reception 时由调用方决定是否渲染。 */
  roleLayer: string | null | undefined;
}

const ROW_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
  padding: '3px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const DOT_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 18,
  height: 18,
  borderRadius: '50%',
  fontSize: 10,
  fontWeight: 800,
  flexShrink: 0,
};

const CODE_STYLE: CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  borderRadius: 4,
  fontSize: 9,
  fontWeight: 800,
  fontVariantNumeric: 'tabular-nums',
  textTransform: 'uppercase',
  lineHeight: 1,
};

export function TeamMessageRoleHeader({ roleLayer }: TeamMessageRoleHeaderProps) {
  const id = getRoleLayerIdentity(roleLayer);
  return (
    <div
      style={{
        ...ROW_STYLE,
        color: id.color,
        background: `color-mix(in srgb, ${id.color} 8%, transparent)`,
      }}
      aria-label={`来自${id.label}`}
    >
      <span
        aria-hidden
        style={{
          ...DOT_STYLE,
          background: `color-mix(in srgb, ${id.color} 22%, var(--bg-overlay))`,
          color: id.color,
          border: `1px solid color-mix(in srgb, ${id.color} 45%, transparent)`,
        }}
      >
        {id.icon}
      </span>
      <span>{id.label}</span>
      {id.code ? (
        <span
          style={{
            ...CODE_STYLE,
            color: id.color,
            background: `color-mix(in srgb, ${id.color} 16%, transparent)`,
            border: `1px solid color-mix(in srgb, ${id.color} 34%, transparent)`,
          }}
        >
          {id.code}
        </span>
      ) : null}
    </div>
  );
}
