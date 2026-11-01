/**
 * 会话扩展确认页（261031 / T-17）。
 *
 * 渠道会话里发起的 Skill / MCP 安装只会落一条**待确认提案**；本页是确认入口：
 * `/session-extensions/confirm?session=<id>&operation=<id>`。
 *
 * 为什么必须登录后确认，而不是「群里回一句同意」：
 *   - 群会话按 chatId 共享，任何成员都能发言，自然语言同意无法绑定到具体身份；
 *   - 审批者必须是网关用户（owner 或其授权的管理员），渠道 senderId 不是网关身份。
 * 因此链接只是入口，鉴权与归属校验由网关侧接口完成（本页复用 `useAuthStore` 的令牌）。
 *
 * 页面严格按「不展示密钥」渲染：端点只显示主机名，凭据只显示「已配置引用」。
 *
 * 本组件只做组装：取数在 `hooks/session-extension-hooks.ts`，分区渲染在
 * `confirm/sections.tsx`。
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useSessionExtensionOperation } from './hooks/session-extension-hooks.js';
import { DecisionActions, OperationPreview, SiblingProposals } from './confirm/sections.js';
import { NoticeText, SessionExtensionNotice } from './shared/SessionExtensionNotice.js';
import {
  confirmMutedStyle,
  confirmValueStyle,
  statusLabel,
} from './shared/session-extension-display.js';

export default function SessionExtensionConfirmPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session') ?? '';
  const operationId = searchParams.get('operation') ?? '';

  const { phase, errorText, detail, state, siblings, busy, feedback, reload, decide } =
    useSessionExtensionOperation(sessionId, operationId);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (phase === 'unauthenticated') {
    return (
      <SessionExtensionNotice variant="confirm" title="请先登录">
        <NoticeText>确认操作需要登录账号；链接本身不代表授权。</NoticeText>
      </SessionExtensionNotice>
    );
  }

  if (phase === 'not-found') {
    return (
      <SessionExtensionNotice variant="confirm" title="找不到该提案">
        <NoticeText>{errorText ?? '提案不存在，或当前账号无权访问。'}</NoticeText>
        <NoticeText>若链接来自消息渠道，可能已过期，请回到会话中重新发起。</NoticeText>
      </SessionExtensionNotice>
    );
  }

  if (phase === 'error') {
    return (
      <SessionExtensionNotice variant="confirm" title="加载失败">
        <NoticeText>{errorText ?? '请稍后重试。'}</NoticeText>
      </SessionExtensionNotice>
    );
  }

  if (phase === 'loading' || !detail) {
    return (
      <SessionExtensionNotice variant="confirm" title="正在加载提案…">
        <NoticeText>正在校验会话与操作归属。</NoticeText>
      </SessionExtensionNotice>
    );
  }

  const isPending = detail.status === 'pending_approval';

  return (
    <SessionExtensionNotice
      variant="confirm"
      title={detail.kind === 'skill' ? '确认安装技能（仅当前会话）' : '确认配置 MCP（仅当前会话）'}
    >
      <OperationPreview
        sessionId={sessionId}
        detail={detail}
        inheritance={state?.inheritance ?? null}
      />

      <DecisionActions
        status={detail.status}
        expiresAt={detail.expiresAt}
        hasNonce={Boolean(detail.nonce)}
        busy={busy}
        onDecide={(decision) => void decide(decision)}
      />

      {!isPending ? (
        <p style={confirmMutedStyle}>
          该提案已是终态（{statusLabel(detail.status)}），无需再次确认。
          {detail.errorMessage ? ` 原因：${detail.errorMessage}` : ''}
        </p>
      ) : null}
      {feedback ? <p style={confirmValueStyle}>{feedback}</p> : null}

      <SiblingProposals siblings={siblings} />
    </SessionExtensionNotice>
  );
}
