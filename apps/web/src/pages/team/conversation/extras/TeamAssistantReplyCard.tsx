import type { CSSProperties, ReactNode } from 'react';
import MarkdownMessageContent from '../../../../components/chat/markdown/markdown-message-content.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { buildTeamAssistantPresentation } from './team-assistant-presentation.js';
import { hasProcessContent } from './TeamAssistantProcessOutline.js';
import { tryFormatJson, looksLikeJson } from '../../../../utils/format-json.js';

export interface TeamAssistantReplyCardProps {
  message: ChatMessage;
  processContent?: ReactNode;
  layerColor?: string;
}

const CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 10,
  background: 'var(--bg-overlay)',
  transition: 'background 160ms ease',
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
  padding: '2px 9px',
  borderRadius: 999,
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '0.02em',
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-muted)',
  letterSpacing: '0.03em',
};

const DIVIDER_STYLE: CSSProperties = {
  height: 1,
  background: 'color-mix(in srgb, var(--border-subtle) 50%, transparent)',
  margin: '2px 0',
};

const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};

export function TeamAssistantReplyCard({
  message,
  processContent,
  layerColor = 'var(--accent)',
}: TeamAssistantReplyCardProps): React.ReactElement {
  const presentation = buildTeamAssistantPresentation(message);
  const mainContent =
    presentation.detailText || presentation.summaryText || '团队已处理该步骤，技术过程已默认折叠。';

  const cardStyle: CSSProperties = {
    ...CARD_STYLE,
  };

  const chipStyle: CSSProperties = {
    ...CHIP_STYLE,
    color: layerColor,
    background: `color-mix(in srgb, ${layerColor} 8%, var(--bg-overlay))`,
  };

  return (
    <section style={cardStyle} data-team-assistant-reply="true">
      <div style={HEADER_STYLE}>
        <span style={LABEL_STYLE}>结论</span>
        {presentation.processSummary ? (
          <span style={chipStyle}>{presentation.processSummary}</span>
        ) : null}
      </div>

      <div>
        {looksLikeJson(mainContent) ? (
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: 11.5,
              lineHeight: 1.6,
              color: 'var(--fg-default)',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {tryFormatJson(mainContent)}
          </pre>
        ) : (
          <MarkdownMessageContent content={mainContent} />
        )}
      </div>

      {presentation.nextStep ? (
        <>
          <div style={DIVIDER_STYLE} />
          <div style={SECTION_STYLE}>
            <span style={LABEL_STYLE}>下一步</span>
            {looksLikeJson(presentation.nextStep) ? (
              <pre
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'var(--fg-default)',
                  whiteSpace: 'pre',
                  overflowX: 'auto',
                }}
              >
                {tryFormatJson(presentation.nextStep)}
              </pre>
            ) : (
              <MarkdownMessageContent content={presentation.nextStep} />
            )}
          </div>
        </>
      ) : null}

      {processContent && hasProcessContent(message) ? (
        <>
          <div style={DIVIDER_STYLE} />
          <details style={SECTION_STYLE}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 500,
                color: 'var(--fg-muted)',
                outline: 'none',
                userSelect: 'none',
                transition: 'color 120ms ease',
              }}
            >
              处理过程（已折叠）
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {processContent}
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
