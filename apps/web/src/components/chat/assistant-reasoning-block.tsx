import React from 'react';
import {
  buildLocalReasoningBlockKey,
  extractLocalReasoningExcerpt,
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

const reasoningOpenStateCache = new Map<string, boolean>();

export const buildReasoningBlockKey = buildLocalReasoningBlockKey;

export function resetReasoningOpenStateCacheForTests() {
  reasoningOpenStateCache.clear();
}

export function AssistantReasoningBlock({
  content,
  index,
  renderBody,
  stateKey,
  streaming = false,
  total,
}: {
  content: string;
  index: number;
  renderBody: (content: string, streaming: boolean) => React.ReactNode;
  stateKey?: string;
  streaming?: boolean;
  total: number;
}) {
  const contentStateKey = React.useMemo(
    () => buildLocalReasoningBlockKey(content, index),
    [content, index],
  );
  const [open, setOpen] = React.useState(() => {
    if (stateKey && reasoningOpenStateCache.has(stateKey)) {
      return reasoningOpenStateCache.get(stateKey) ?? true;
    }

    return reasoningOpenStateCache.get(contentStateKey) ?? true;
  });
  const heading = React.useMemo(() => extractLocalReasoningHeading(content), [content]);
  const preview = React.useMemo(
    () => heading ?? extractLocalReasoningPreview(content),
    [content, heading],
  );
  const excerpt = React.useMemo(() => extractLocalReasoningExcerpt(content), [content]);
  const charCount = React.useMemo(() => Array.from(content).length, [content]);
  const label = getLocalReasoningLabel({ index, streaming, total });
  const hint = getLocalReasoningHint({ charCount, open, streaming });
  const statusText = streaming ? '持续生成中' : open ? '正文已展开' : '摘要视图';
  const visibleHeading = open ? heading : preview;

  React.useEffect(() => {
    const cachedState =
      (stateKey ? reasoningOpenStateCache.get(stateKey) : undefined) ??
      reasoningOpenStateCache.get(contentStateKey);

    if (cachedState === undefined) {
      return;
    }

    setOpen(cachedState);
  }, [contentStateKey, stateKey]);

  const handleToggle = React.useCallback(() => {
    setOpen((previous) => {
      const next = !previous;
      if (stateKey) {
        reasoningOpenStateCache.set(stateKey, next);
      }
      reasoningOpenStateCache.set(contentStateKey, next);
      return next;
    });
  }, [contentStateKey, stateKey]);

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
        onClick={handleToggle}
      >
        <span
          className="assistant-reasoning-summary-main"
          aria-live={streaming ? 'polite' : undefined}
        >
          <span className="assistant-reasoning-summary-row">
            <span className="assistant-reasoning-summary-head">
              <span className="assistant-reasoning-status-cluster">
                <span className="assistant-reasoning-status-dot" aria-hidden="true" />
                <span className="chat-markdown-thinking-label">{label}</span>
              </span>
              <span className="assistant-reasoning-status-text">{statusText}</span>
            </span>
            <span className="assistant-reasoning-summary-meta">
              <span className="chat-markdown-thinking-hint">{hint}</span>
            </span>
          </span>
          {visibleHeading && <span className="assistant-reasoning-heading">{visibleHeading}</span>}
          {!open && excerpt && excerpt !== preview && (
            <span className="assistant-reasoning-preview">{excerpt}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="chat-markdown-thinking-body assistant-reasoning-body">
          {renderBody(content, streaming)}
        </div>
      )}
    </section>
  );
}
