import { lazy, memo, Suspense, useMemo } from 'react';
import { splitStreamingMarkdownIntoSegments } from './streaming-markdown-chunks.js';
import { normalizeMathMarkdown } from './normalize-math-markdown.js';
import { transformInlineReasoningTags } from './transform-inline-reasoning-tags.js';
import { FoldDisabledContext } from './fold-policy.js';

const MarkdownMessageContent = lazy(() => import('./markdown-message-content.js'));
const STREAMING_PLAIN_TAIL_THRESHOLD = 280;

export default function StreamingMarkdownContent({ content }: { content: string }) {
  const normalizedContent = useMemo(
    () => normalizeMathMarkdown(transformInlineReasoningTags(content)),
    [content],
  );
  const segments = useMemo(
    () => splitStreamingMarkdownIntoSegments(normalizedContent),
    [normalizedContent],
  );
  const shouldRenderPlainTail = useMemo(() => {
    return shouldRenderStreamingTailAsPlainText(segments.activeTail);
  }, [segments.activeTail]);

  // 流式期间禁用围栏块折叠：stableBlocks 分支渲染时同样不带 streaming prop，
  // 若只靠该 prop 判断，「已闭合的围栏块」仍会在流式过程中被钳住高度。
  // 因此整个返回树（stableBlocks + activeTail）统一包进 context。
  return (
    <FoldDisabledContext value={true}>
      <>
        {segments.stableBlocks.map((block, index) => (
          <StableMarkdownBlock key={`${index}:${block.length}`} content={block} />
        ))}
        {segments.activeTail.length > 0 &&
          (shouldRenderPlainTail ? (
            <div className="chat-markdown-streaming">{segments.activeTail}</div>
          ) : (
            <Suspense
              fallback={<div className="chat-markdown-streaming">{segments.activeTail}</div>}
            >
              <MarkdownMessageContent content={segments.activeTail} streaming />
            </Suspense>
          ))}
        <span className="assistant-rich-content-cursor" />
      </>
    </FoldDisabledContext>
  );
}

const StableMarkdownBlock = memo(function StableMarkdownBlock({ content }: { content: string }) {
  return (
    <Suspense fallback={<div className="chat-markdown-streaming">{content}</div>}>
      <MarkdownMessageContent content={content} />
    </Suspense>
  );
});

function shouldRenderStreamingTailAsPlainText(content: string): boolean {
  if (content.length < STREAMING_PLAIN_TAIL_THRESHOLD) {
    return false;
  }

  if (/(```|~~~)/u.test(content)) {
    return false;
  }

  if (/[*_`\[\]!]/u.test(content)) {
    return false;
  }

  if (/(?:\\[a-zA-Z]+|[=<>^_])/u.test(content)) {
    return false;
  }

  const lines = content.split('\n');
  if (lines.some((line) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/u.test(line.trim()))) {
    return false;
  }

  return true;
}
