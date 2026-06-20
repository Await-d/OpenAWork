import type { CSSProperties } from 'react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { buildTeamAssistantPresentation } from './team-assistant-presentation.js';

export interface TeamAssistantProcessOutlineProps {
  message: ChatMessage;
}

const SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
};

const LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  color: 'var(--fg-default)',
  fontSize: 12,
  lineHeight: 1.55,
};

const DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  marginTop: 4,
  flexShrink: 0,
  background: 'var(--accent)',
};

const NOTICE_STYLE: CSSProperties = {
  padding: '12px',
  borderRadius: 8,
  border: '1px dashed color-mix(in srgb, var(--border-default) 65%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 72%, var(--bg-base))',
  color: 'var(--fg-muted)',
  fontSize: 12,
  lineHeight: 1.6,
};

/**
 * Returns true when the message carries enough trace data (reasoning
 * blocks, tool calls, or modified files) to render a non-empty process
 * outline.  Used by `TeamAssistantReplyCard` to avoid showing an empty
 * "处理过程（已折叠）" `<details>` when the outline would return null.
 */
export function hasProcessContent(message: ChatMessage): boolean {
  const presentation = buildTeamAssistantPresentation(message);
  return (
    presentation.stats.reasoningCount > 0 ||
    presentation.toolSummaries.length > 0 ||
    presentation.modifiedFiles.length > 0
  );
}

export function TeamAssistantProcessOutline({
  message,
}: TeamAssistantProcessOutlineProps): React.ReactElement | null {
  const presentation = buildTeamAssistantPresentation(message);
  const toolSummaries = presentation.toolSummaries.slice(0, 5);
  const modifiedFiles = presentation.modifiedFiles.slice(0, 4);
  const hiddenToolCount = presentation.toolSummaries.length - toolSummaries.length;
  const hiddenFileCount = presentation.modifiedFiles.length - modifiedFiles.length;

  if (
    presentation.stats.reasoningCount === 0 &&
    toolSummaries.length === 0 &&
    modifiedFiles.length === 0
  ) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {presentation.stats.reasoningCount > 0 ? (
        <section style={SECTION_STYLE}>
          <span style={SECTION_TITLE_STYLE}>内部处理</span>
          <div style={NOTICE_STYLE}>
            该回复在内部完成了 {presentation.stats.reasoningCount}{' '}
            段分析与判断，详细思考过程默认省略， 以避免把技术推理暴露给非专业使用者。
          </div>
        </section>
      ) : null}

      {toolSummaries.length > 0 ? (
        <section style={SECTION_STYLE}>
          <span style={SECTION_TITLE_STYLE}>过程摘要</span>
          <ul style={LIST_STYLE}>
            {toolSummaries.map((item, index) => (
              <li key={`tool-summary-${index}-${item}`} style={ITEM_STYLE}>
                <span style={DOT_STYLE} />
                <span>{item}</span>
              </li>
            ))}
            {hiddenToolCount > 0 ? (
              <li style={{ ...ITEM_STYLE, color: 'var(--fg-muted)' }}>
                <span style={DOT_STYLE} />
                <span>另外还有 {hiddenToolCount} 个处理步骤已省略。</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {modifiedFiles.length > 0 ? (
        <section style={SECTION_STYLE}>
          <span style={SECTION_TITLE_STYLE}>触达文件</span>
          <ul style={LIST_STYLE}>
            {modifiedFiles.map((file, index) => (
              <li key={`modified-file-${index}-${file}`} style={ITEM_STYLE}>
                <span style={DOT_STYLE} />
                <code style={{ fontSize: 11, color: 'var(--fg-default)' }}>{file}</code>
              </li>
            ))}
            {hiddenFileCount > 0 ? (
              <li style={{ ...ITEM_STYLE, color: 'var(--fg-muted)' }}>
                <span style={DOT_STYLE} />
                <span>另外还有 {hiddenFileCount} 个文件已省略。</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
