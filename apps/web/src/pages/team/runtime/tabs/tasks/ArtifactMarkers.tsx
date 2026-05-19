/**
 * 260517-team-phase-c · 产物文本中的 spec-kit 标记高亮
 *
 * Phase C 的 spec/plan/tasks 输出含 3 类标记：
 *   1. [NEEDS CLARIFICATION: ...]：红色徽章，提示用户回答
 *   2. [P]：蓝色徽章，标记可并行任务
 *   3. [US1] / [US2] / ...：绿色徽章，标记 user story 归属
 *
 * 本组件接收一段 Markdown / 纯文本，把这 3 类标记替换为 React 节点，
 * 其余文本保持原样换行渲染。性能要点：
 *   - 单次正则扫描 + 索引切片，避免多趟 replace
 *   - 对未识别字符直接放回 output 数组，最后用 <Fragment> 拼接
 */

import { Fragment, type CSSProperties, type ReactNode } from 'react';

const BADGE_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.02em',
  marginInline: 2,
  verticalAlign: 'baseline',
  lineHeight: '16px',
};

const NEEDS_CLARIFICATION_STYLE: CSSProperties = {
  ...BADGE_BASE,
  background: 'color-mix(in srgb, var(--danger, #d4574e) 14%, transparent)',
  color: 'var(--danger, #d4574e)',
  border: '1px solid color-mix(in srgb, var(--danger, #d4574e) 36%, transparent)',
};

const PARALLEL_STYLE: CSSProperties = {
  ...BADGE_BASE,
  background: 'color-mix(in srgb, var(--aux, var(--aux, #8b9cf5)) 14%, transparent)',
  color: 'var(--aux, var(--aux, #8b9cf5))',
  border: '1px solid color-mix(in srgb, var(--aux, var(--aux, #8b9cf5)) 36%, transparent)',
};

const STORY_STYLE: CSSProperties = {
  ...BADGE_BASE,
  background: 'color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 14%, transparent)',
  color: 'var(--success, var(--success, var(--success, #3dd49a)))',
  border: '1px solid color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 36%, transparent)',
};

interface ArtifactMarkerInfo {
  kind: 'needs-clarification' | 'parallel' | 'story';
  /** 完整匹配文本（含括号），用作 React key。 */
  match: string;
  /** 仅对 needs-clarification 有意义：提取出的问题文本。 */
  question?: string;
  /** 仅对 story 有意义：US1 / US2 等。 */
  storyId?: string;
}

const COMBINED_RE = /\[NEEDS CLARIFICATION:\s*([^\]]+)\]|\[P\]|\[(US\d+)\]/g;

function parseMarker(match: RegExpExecArray): ArtifactMarkerInfo | null {
  const [whole, clarification, story] = match;
  if (clarification) {
    return {
      kind: 'needs-clarification',
      match: whole,
      question: clarification.trim(),
    };
  }
  if (story) {
    return {
      kind: 'story',
      match: whole,
      storyId: story,
    };
  }
  if (whole === '[P]') {
    return { kind: 'parallel', match: whole };
  }
  return null;
}

export interface ArtifactMarkersProps {
  /** 原始文本（可包含换行）。 */
  text: string;
  /** 是否保留换行。默认 true（用 white-space: pre-wrap）。 */
  preserveWhitespace?: boolean;
  /** 当点击 needs-clarification 徽章时回调，可用于聚焦到澄清面板对应项。 */
  onClarificationClick?: (question: string) => void;
}

export function ArtifactMarkers({
  text,
  preserveWhitespace = true,
  onClarificationClick,
}: ArtifactMarkersProps) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  COMBINED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMBINED_RE.exec(text)) !== null) {
    const info = parseMarker(match);
    if (!info) continue;
    if (match.index > cursor) {
      nodes.push(<Fragment key={`t-${key++}`}>{text.slice(cursor, match.index)}</Fragment>);
    }
    nodes.push(
      <Marker key={`m-${key++}`} info={info} onClarificationClick={onClarificationClick} />,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    nodes.push(<Fragment key={`t-${key++}`}>{text.slice(cursor)}</Fragment>);
  }

  return (
    <span
      style={preserveWhitespace ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : undefined}
    >
      {nodes}
    </span>
  );
}

function Marker({
  info,
  onClarificationClick,
}: {
  info: ArtifactMarkerInfo;
  onClarificationClick?: (question: string) => void;
}) {
  if (info.kind === 'needs-clarification') {
    const handleClick = () => {
      if (info.question && onClarificationClick) onClarificationClick(info.question);
    };
    return (
      <button
        type="button"
        onClick={handleClick}
        style={{
          ...NEEDS_CLARIFICATION_STYLE,
          cursor: onClarificationClick ? 'pointer' : 'help',
          background: 'color-mix(in srgb, var(--danger, #d4574e) 14%, transparent)',
        }}
        title={`需要澄清：${info.question ?? ''}`}
      >
        <span aria-hidden style={{ marginRight: 4 }}>
          ❓
        </span>
        NEEDS CLARIFICATION
      </button>
    );
  }
  if (info.kind === 'parallel') {
    return (
      <span style={PARALLEL_STYLE} title="此任务可并行执行">
        ⏵ 并行
      </span>
    );
  }
  return (
    <span style={STORY_STYLE} title={`User Story: ${info.storyId}`}>
      {info.storyId}
    </span>
  );
}

/**
 * 工具函数：判断文本里是否还有 pending 标记（不依赖组件渲染）。
 */
export function hasPendingClarifications(text: string): boolean {
  const re = /\[NEEDS CLARIFICATION:/g;
  return re.test(text);
}
