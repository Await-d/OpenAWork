export function looksLikeAssistantErrorContent(content: string): boolean {
  return /^\[错误:\s*[A-Z0-9_]+\]/.test(content.trim());
}

function parseAssistantErrorContent(content: string): {
  code?: string;
  detail?: string;
  headline: string;
} {
  const normalized = content.trim();
  const bracketMatch = normalized.match(/^\[错误:\s*([A-Z0-9_]+)\]\s*(.*)$/s);
  const baseMessage = bracketMatch?.[2]?.trim() || normalized;
  const code = bracketMatch?.[1]?.trim() || undefined;
  const separatorIndex = baseMessage.indexOf(': ');

  if (separatorIndex === -1) {
    return {
      code,
      headline: baseMessage,
    };
  }

  return {
    code,
    headline: baseMessage.slice(0, separatorIndex),
    detail: baseMessage.slice(separatorIndex + 2).trim() || undefined,
  };
}

export function AssistantErrorContent({ content }: { content: string }) {
  const parsed = parseAssistantErrorContent(content);

  return (
    <div className="chat-message-error-banner" data-testid="chat-message-error-banner" role="alert">
      <div className="chat-message-error-head">
        {parsed.code && <span className="chat-message-error-label">{parsed.code}</span>}
        <span className="chat-message-error-title">{parsed.headline || '请求失败'}</span>
      </div>
      {parsed.detail && <div className="chat-message-error-detail">{parsed.detail}</div>}
    </div>
  );
}
