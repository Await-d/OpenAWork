/**
 * 确认链接与回执文案（261031）。
 *
 * 为什么渠道场景必须走「链接 + 独立确认」而不是「群里回一句同意」：
 *   - 群会话按 chatId 共享，任何成员都能发言，自然语言「同意」无法绑定到具体的人；
 *   - 审批者必须是网关用户身份（owner 或其授权的管理员），而渠道 senderId 只是
 *     平台侧标识，两者不能互相当作凭据；
 *   - 确认必须携带 nonce 并单次消费，避免重放与并发双击。
 *
 * 因此：渠道里只输出「提案 + 链接」，确认在带鉴权的 Web 端完成。
 *
 * 未配置公开地址时**不伪造链接**，只提示到设置页操作——宁可少一个便利，也不给出
 * 一个点不通或指向错误站点的 URL。
 */

const PUBLIC_WEB_URL_ENV = 'OPENAWORK_PUBLIC_WEB_URL';

export interface ConfirmationMessageInput {
  operationId: string;
  kind: 'skill' | 'mcp';
  /** 展示名（技能 id 或 MCP 显示名）。 */
  targetLabel: string;
  expiresAt: number;
  /** 额外风险提示（声明权限、内嵌 MCP、stdio 等）。 */
  warnings?: readonly string[];
}

/** 读取公开 Web 基址；未配置 / 非法时返回 `null`（调用方须走降级文案）。 */
export function resolveConfirmationBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[PUBLIC_WEB_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** 生成确认页链接（会话 + 操作），确认页自身仍需登录与归属校验。 */
export function buildConfirmationUrl(params: {
  baseUrl: string;
  sessionId: string;
  operationId: string;
}): string {
  const query = new URLSearchParams({
    session: params.sessionId,
    operation: params.operationId,
  });
  return `${params.baseUrl}/session-extensions/confirm?${query.toString()}`;
}

/**
 * 渠道回执文案。
 *
 * 只包含「不点链接也能判断」的信息：目标、范围、有效期、风险；链接只是确认入口，
 * **不是** bearer 凭据（页面仍要登录）。密钥永不进入文案。
 */
export function buildSessionExtensionConfirmationText(params: {
  sessionId: string;
  input: ConfirmationMessageInput;
  baseUrl?: string | null;
}): string {
  const kindLabel = params.input.kind === 'skill' ? '技能' : 'MCP 配置';
  const lines: string[] = [];
  lines.push(`已创建待确认的${kindLabel}提案（尚未生效）：`);
  lines.push(`· 目标：${params.input.targetLabel}`);
  lines.push('· 生效范围：仅当前会话（其他会话与用户级配置不受影响）');
  lines.push('· 生效时间：确认成功后的下一轮对话');
  lines.push(`· 有效至：${new Date(params.input.expiresAt).toLocaleString('zh-CN')}`);

  const warnings = params.input.warnings ?? [];
  if (warnings.length > 0) {
    lines.push('· 风险提示：');
    for (const warning of warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  const baseUrl = params.baseUrl ?? resolveConfirmationBaseUrl();
  if (baseUrl) {
    lines.push('');
    lines.push(
      `请由会话所有者或已授权的管理员登录后确认：${buildConfirmationUrl({
        baseUrl,
        sessionId: params.sessionId,
        operationId: params.input.operationId,
      })}`,
    );
  } else {
    lines.push('');
    lines.push(
      '当前未配置公开访问地址（OPENAWORK_PUBLIC_WEB_URL），请在 Web / 桌面端打开该会话的「会话扩展」面板完成确认。',
    );
  }

  lines.push('在确认完成前，该提案不会写入任何配置；群里的「同意」不构成授权。');
  return lines.join('\n');
}

/** 结果回执文案（确认成功 / 不可用 / 失败 / 过期）。 */
export function buildSessionExtensionResultText(params: {
  kind: 'skill' | 'mcp';
  targetLabel: string;
  status: 'succeeded' | 'configured_unavailable' | 'failed' | 'rejected' | 'expired' | 'cancelled';
  errorMessage?: string | null;
}): string {
  const kindLabel = params.kind === 'skill' ? '技能' : 'MCP 配置';
  switch (params.status) {
    case 'succeeded':
      return `✅ 已为当前会话启用${kindLabel}「${params.targetLabel}」，下一轮对话生效。`;
    case 'configured_unavailable':
      return `⚠️ ${kindLabel}「${params.targetLabel}」配置已保存，但连接探测失败，当前**不可用**：${
        params.errorMessage ?? '未知原因'
      }。请检查配置或凭据后在会话扩展面板重试。`;
    case 'rejected':
      return `已拒绝${kindLabel}「${params.targetLabel}」的提案，未做任何变更。`;
    case 'expired':
      return `${kindLabel}「${params.targetLabel}」的确认请求已过期，未做任何变更；如需安装请重新发起。`;
    case 'cancelled':
      return `${kindLabel}「${params.targetLabel}」的提案已取消，未做任何变更。`;
    case 'failed':
    default:
      return `❌ ${kindLabel}「${params.targetLabel}」安装失败：${
        params.errorMessage ?? '未知原因'
      }。未做任何变更。`;
  }
}
