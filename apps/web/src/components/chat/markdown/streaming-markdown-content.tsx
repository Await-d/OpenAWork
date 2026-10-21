import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { splitStreamingMarkdownIntoSegments } from './streaming-markdown-chunks.js';
import { normalizeAssistantMarkdown } from './normalize-markdown.js';
import { FoldDisabledContext } from './fold-policy.js';

const MarkdownCore = lazy(() =>
  import('./markdown-message-content.js').then((m) => ({ default: m.MarkdownCore })),
);

/**
 * 流式 Markdown 的重解析节流参数。
 *
 * 背景：流式文本每增长一次，「活动尾块」就要整篇重走 remark → rehype → 语法高亮。
 * 实测（bun 基准，含 GFM / KaTeX / highlight.js）单次成本：8KB ≈ 22ms、
 * 27KB ≈ 25ms、40KB ≈ 58ms。逐帧（≤16ms 一次）重解析会把主线程占满——会话运行时
 * 滚动、输入、点击审批按钮都会明显迟滞，权限弹窗出现时（此时模型刚输出完大段
 * 文本 / 代码块，且用户开始交互）尤为明显。
 *
 * 短文本解析便宜，保持逐帧跟随以保留逐字显示手感；文本越长单次成本越高，按长度
 * 分档降频（60ms ≈ 16fps，120ms ≈ 8fps）。稳定块由 `MarkdownSegment` 的 memo 挡住，
 * 降频只作用于不断变化的活动尾块，不影响已落定内容的稳定性。
 */
const STREAM_RENDER_DIRECT_MAX_CHARS = 2_000;
const STREAM_RENDER_THROTTLE_MS = 60;
const STREAM_RENDER_HEAVY_CHARS = 20_000;
const STREAM_RENDER_HEAVY_THROTTLE_MS = 120;

/**
 * 活动尾块的语法高亮上限。
 *
 * 高亮是单次解析里最贵的一段（27KB 未闭合围栏：纯解析 5ms，带高亮 25ms）。超长
 * 尾块在流式期间放弃高亮，落定后由静态管线（`MarkdownMessageContent`）恢复——代价
 * 是代码块颜色在落定瞬间补上，收益是流式期间每帧少 20ms 左右的主线程占用。
 */
const STREAM_TAIL_HIGHLIGHT_MAX_CHARS = 12_000;

function resolveStreamRenderThrottleMs(length: number): number {
  if (length <= STREAM_RENDER_DIRECT_MAX_CHARS) {
    return 0;
  }
  return length >= STREAM_RENDER_HEAVY_CHARS
    ? STREAM_RENDER_HEAVY_THROTTLE_MS
    : STREAM_RENDER_THROTTLE_MS;
}

/**
 * 把「上游逐帧增长的内容」降频成「按档位提交的内容」。
 *
 * 语义要点：
 * - 短文本（≤2k）直接返回入参，不引入任何额外 state / 定时器，逐字显示手感不变；
 * - 进入节流区间后，`displayed` 由定时器驱动，最多每 60/120ms 追一次最新值；
 * - 定时器**只按节流档位调度、不被每个 token 重置**：delta 每 20ms 到达时若重启
 *   定时器，它会永远等不到触发（经典 debounce 死锁）；
 * - 落后过多（例如刚从短文本档跨进节流档，state 还停在很早的版本）时先直接用
 *   入参渲染，避免闪回旧内容；下一次提交后自然回到节流节奏。
 */
export function useThrottledStreamingContent(content: string): string {
  const [displayed, setDisplayed] = useState(content);
  const latestContentRef = useRef(content);
  const timerRef = useRef<number | null>(null);
  const lastCommitAtRef = useRef(0);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  const throttleMs = resolveStreamRenderThrottleMs(content.length);
  const needsThrottle = throttleMs > 0;
  const synced = displayed === content;
  // 非前缀关系只可能来自「换了一段内容」（会话切换 / 重试 / 重新生成）：此时旧基线
  // 必须立刻让位，不能等节流窗口，否则切换后的头几帧仍会走全量解析。
  const contentRestarted = !content.startsWith(displayed);

  useEffect(() => {
    if (!needsThrottle || synced) {
      return;
    }
    if (timerRef.current !== null) {
      return;
    }
    const wait = contentRestarted
      ? 0
      : Math.max(0, throttleMs - (Date.now() - lastCommitAtRef.current));
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastCommitAtRef.current = Date.now();
      setDisplayed(latestContentRef.current);
    }, wait);
  }, [contentRestarted, needsThrottle, synced, throttleMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  if (!needsThrottle) {
    return content;
  }
  // 内容被重置 / 替换（会话切换、重试、重新生成）时 `displayed` 还停在上一条输出上。
  // 追加式增长才允许复用旧值；一旦不再是前缀关系就必须立即跟随，否则会把上一会话
  // 的尾部文本显示到新会话里（`displayed` 更长时连「落后一半」兜底也救不回来）。
  if (contentRestarted) {
    return content;
  }
  // 落后超过一半（通常是刚跨档）说明 state 还停在很早的版本，先用最新内容渲染。
  if (displayed.length * 2 < content.length) {
    return content;
  }
  return displayed;
}

export default function StreamingMarkdownContent({ content }: { content: string }) {
  const displayContent = useThrottledStreamingContent(content);
  const normalized = useMemo(() => normalizeAssistantMarkdown(displayContent), [displayContent]);
  const segments = useMemo(() => splitStreamingMarkdownIntoSegments(normalized), [normalized]);
  const disableTailHighlight = segments.activeTail.length > STREAM_TAIL_HIGHLIGHT_MAX_CHARS;
  return (
    <FoldDisabledContext value={true}>
      <div className="chat-markdown" data-streaming="true">
        {segments.stableBlocks.map((block, index) => (
          <MarkdownSegment key={`${index}:${block.length}`} content={block} />
        ))}
        {segments.activeTail.length > 0 && (
          <MarkdownSegment content={segments.activeTail} disableHighlight={disableTailHighlight} />
        )}
      </div>
      <span className="assistant-rich-content-cursor" aria-hidden="true" />
    </FoldDisabledContext>
  );
}

const MarkdownSegment = memo(function MarkdownSegment({
  content,
  disableHighlight = false,
}: {
  content: string;
  disableHighlight?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <MarkdownCore content={content} disableHighlight={disableHighlight} />
    </Suspense>
  );
});
