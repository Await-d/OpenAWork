import React from 'react';
import {
  buildLocalReasoningBlockKey,
  extractLocalReasoningHeading,
  extractLocalReasoningPreview,
  getLocalReasoningHint,
  getLocalReasoningLabel,
  LOCAL_REASONING_UI_TOKENS,
} from './assistant-reasoning-block.helpers.js';

type ReasoningCssVariables = React.CSSProperties & {
  '--reasoning-block-margin-bottom': string;
  '--reasoning-block-radius': string;
  '--reasoning-summary-gap': string;
  '--reasoning-summary-main-gap': string;
  '--reasoning-summary-padding-x': string;
  '--reasoning-summary-padding-y': string;
  '--reasoning-label-font-size': string;
  '--reasoning-label-letter-spacing': string;
  '--reasoning-label-badge-height': string;
  '--reasoning-label-badge-padding-x': string;
  '--reasoning-label-badge-radius': string;
  '--reasoning-heading-font-size': string;
  '--reasoning-heading-line-height': string;
  '--reasoning-hint-font-size': string;
  '--reasoning-hint-line-height': string;
  '--reasoning-body-padding-x': string;
  '--reasoning-body-padding-bottom': string;
};

const REASONING_CSS_VARIABLES: ReasoningCssVariables = {
  '--reasoning-block-margin-bottom': `${LOCAL_REASONING_UI_TOKENS.blockMarginBottomPx}px`,
  '--reasoning-block-radius': `${LOCAL_REASONING_UI_TOKENS.blockRadiusPx}px`,
  '--reasoning-summary-gap': `${LOCAL_REASONING_UI_TOKENS.summaryGapPx}px`,
  '--reasoning-summary-main-gap': `${LOCAL_REASONING_UI_TOKENS.summaryMainGapPx}px`,
  '--reasoning-summary-padding-x': `${LOCAL_REASONING_UI_TOKENS.summaryPaddingXPx}px`,
  '--reasoning-summary-padding-y': `${LOCAL_REASONING_UI_TOKENS.summaryPaddingYPx}px`,
  '--reasoning-label-font-size': `${LOCAL_REASONING_UI_TOKENS.labelFontSizePx}px`,
  '--reasoning-label-letter-spacing': `${LOCAL_REASONING_UI_TOKENS.labelLetterSpacingPx}px`,
  '--reasoning-label-badge-height': `${LOCAL_REASONING_UI_TOKENS.labelBadgeHeightPx}px`,
  '--reasoning-label-badge-padding-x': `${LOCAL_REASONING_UI_TOKENS.labelBadgePaddingXPx}px`,
  '--reasoning-label-badge-radius': `${LOCAL_REASONING_UI_TOKENS.labelBadgeRadiusPx}px`,
  '--reasoning-heading-font-size': `${LOCAL_REASONING_UI_TOKENS.headingFontSizePx}px`,
  '--reasoning-heading-line-height': `${LOCAL_REASONING_UI_TOKENS.headingLineHeightPx}px`,
  '--reasoning-hint-font-size': `${LOCAL_REASONING_UI_TOKENS.hintFontSizePx}px`,
  '--reasoning-hint-line-height': `${LOCAL_REASONING_UI_TOKENS.hintLineHeightPx}px`,
  '--reasoning-body-padding-x': `${LOCAL_REASONING_UI_TOKENS.bodyPaddingXPx}px`,
  '--reasoning-body-padding-bottom': `${LOCAL_REASONING_UI_TOKENS.bodyPaddingBottomPx}px`,
};

export const buildReasoningBlockKey = buildLocalReasoningBlockKey;

export function AssistantReasoningBlock({
  content,
  index,
  renderBody,
  streaming = false,
  total,
}: {
  content: string;
  index: number;
  renderBody: (content: string, streaming: boolean) => React.ReactNode;
  streaming?: boolean;
  total: number;
}) {
  const [open, setOpen] = React.useState(false);
  const heading = React.useMemo(() => extractLocalReasoningHeading(content), [content]);
  const preview = React.useMemo(
    () => heading ?? extractLocalReasoningPreview(content),
    [content, heading],
  );
  const charCount = React.useMemo(() => Array.from(content).length, [content]);
  const label = getLocalReasoningLabel({ index, streaming, total });
  const hint = getLocalReasoningHint({ charCount, open, streaming });

  return (
    <section
      className="chat-markdown-thinking-block assistant-reasoning-block"
      data-open={open ? 'true' : 'false'}
      data-streaming={streaming ? 'true' : 'false'}
      style={REASONING_CSS_VARIABLES}
    >
      <button
        type="button"
        className="chat-markdown-thinking-summary assistant-reasoning-summary"
        data-testid="chat-markdown-thinking-summary"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="assistant-reasoning-summary-main">
          <span className="chat-markdown-thinking-label">{label}</span>
          {preview && <span className="assistant-reasoning-heading">{preview}</span>}
        </span>
        <span className="chat-markdown-thinking-hint">{hint}</span>
      </button>
      {open && (
        <div className="chat-markdown-thinking-body assistant-reasoning-body">
          {renderBody(content, streaming)}
        </div>
      )}
    </section>
  );
}
