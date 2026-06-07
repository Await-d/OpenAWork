import type { CSSProperties, ReactNode } from 'react';
import MarkdownMessageContent from '../../../../components/chat/markdown/markdown-message-content.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { buildTeamAssistantPresentation } from './team-assistant-presentation.js';

export interface TeamAssistantReplyCardProps {
  message: ChatMessage;
  processContent?: ReactNode;
}

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 90%, transparent), color-mix(in srgb, var(--bg-base) 96%, transparent))',
  boxShadow: 'var(--shadow-sm)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 12px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 700,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
};

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 72%, var(--bg-base))',
};

export function TeamAssistantReplyCard({
  message,
  processContent,
}: TeamAssistantReplyCardProps): React.ReactElement {
  const presentation = buildTeamAssistantPresentation(message);
  const mainContent =
    presentation.detailText || presentation.summaryText || '团队已处理该步骤，技术过程已默认折叠。';

  return (
    <section style={CARD_STYLE} data-team-assistant-reply="true">
      <div style={HEADER_STYLE}>
        <span style={LABEL_STYLE}>结论</span>
        {presentation.processSummary ? (
          <span style={CHIP_STYLE}>{presentation.processSummary}</span>
        ) : null}
      </div>

      <div>
        <MarkdownMessageContent content={mainContent} />
      </div>

      {presentation.nextStep ? (
        <div style={PANEL_STYLE}>
          <span style={LABEL_STYLE}>下一步</span>
          <MarkdownMessageContent content={presentation.nextStep} />
        </div>
      ) : null}

      {processContent ? (
        <details
          style={{
            ...PANEL_STYLE,
            gap: 8,
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--fg-default)',
              outline: 'none',
            }}
          >
            处理过程（已折叠）
          </summary>
          <div style={{ display: 'grid', gap: 10 }}>{processContent}</div>
        </details>
      ) : null}
    </section>
  );
}
