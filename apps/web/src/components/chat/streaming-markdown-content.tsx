import { lazy, memo, Suspense, useMemo } from 'react';
import { splitStreamingMarkdownIntoSegments } from './streaming-markdown-chunks.js';

const MarkdownMessageContent = lazy(() => import('./markdown-message-content.js'));
const STREAMING_PLAIN_TAIL_THRESHOLD = 280;

export default function StreamingMarkdownContent({ content }: { content: string }) {
  const segments = useMemo(() => splitStreamingMarkdownIntoSegments(content), [content]);
  const shouldRenderPlainTail = useMemo(() => {
    return shouldRenderStreamingTailAsPlainText(segments.activeTail);
  }, [segments.activeTail]);

  return (
    <>
      {segments.stableBlocks.map((block, index) => (
        <StableMarkdownBlock key={`${index}:${block.length}`} content={block} />
      ))}
      {segments.activeTail.length > 0 &&
        (shouldRenderPlainTail ? (
          <div className="chat-markdown-streaming">{segments.activeTail}</div>
        ) : (
          <Suspense fallback={<div className="chat-markdown-streaming">{segments.activeTail}</div>}>
            <MarkdownMessageContent content={segments.activeTail} streaming />
          </Suspense>
        ))}
      <span className="assistant-rich-content-cursor" />
    </>
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

  const lines = content.split('\n');
  if (lines.some((line) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/u.test(line.trim()))) {
    return false;
  }

  return true;
}
