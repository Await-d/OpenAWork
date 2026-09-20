import { lazy, memo, Suspense, useMemo } from 'react';
import { splitStreamingMarkdownIntoSegments } from './streaming-markdown-chunks.js';
import { normalizeAssistantMarkdown } from './normalize-markdown.js';
import { FoldDisabledContext } from './fold-policy.js';

const MarkdownCore = lazy(() =>
  import('./markdown-message-content.js').then((m) => ({ default: m.MarkdownCore })),
);

export default function StreamingMarkdownContent({ content }: { content: string }) {
  const normalized = useMemo(() => normalizeAssistantMarkdown(content), [content]);
  const segments = useMemo(() => splitStreamingMarkdownIntoSegments(normalized), [normalized]);
  return (
    <FoldDisabledContext value={true}>
      <div className="chat-markdown" data-streaming="true">
        {segments.stableBlocks.map((block, index) => (
          <MarkdownSegment key={`${index}:${block.length}`} content={block} />
        ))}
        {segments.activeTail.length > 0 && <MarkdownSegment content={segments.activeTail} />}
      </div>
      <span className="assistant-rich-content-cursor" aria-hidden="true" />
    </FoldDisabledContext>
  );
}

const MarkdownSegment = memo(function MarkdownSegment({ content }: { content: string }) {
  return (
    <Suspense fallback={null}>
      <MarkdownCore content={content} />
    </Suspense>
  );
});
