/**
 * 260531-team-page · parse-instruction-stack
 *
 * 后端 `buildTeamInstructionStack` 把 7 层注入拼成形如：
 *
 *   <team-instruction layer="architecture-md">
 *   {正文}
 *   </team-instruction>
 *
 *   <team-instruction layer="constitution">…</team-instruction>
 *   …
 *   <team-instruction layer="soul:executor:default">…</team-instruction>
 *   <team-instruction layer="cache-breaker" tag="abc" />
 *   <team-instruction layer="oversize-warning">…</team-instruction>
 *
 * 之前面板把整段 XML 原样塞进 <pre>，可读性差。这里把它拆成结构化片段，
 * 让「指令栈」tab 能按层渲染（含中文标签 / markdown 正文 / 折叠）。
 *
 * 纯字符串解析，零依赖。无法识别为 team-instruction 片段的内容归入一个
 * `kind: 'raw'` 片段，绝不丢内容。
 */

export interface InstructionStackSegment {
  /** layer 属性原值（如 'constitution' / 'soul:executor:default' / 'cache-breaker'）。 */
  layer: string;
  /** 规范化后的分组 key（用于中文标签 / markdown 判定）。 */
  kind:
    | 'architecture-md'
    | 'constitution'
    | 'project-memory'
    | 'lessons-learned'
    | 'user-memory'
    | 'soul'
    | 'cache-breaker'
    | 'oversize-warning'
    | 'raw';
  /** 片段正文（self-closing 标签为空字符串）。 */
  body: string;
  /** cache-breaker 的 tag 值（如有）。 */
  tag?: string;
}

const SEGMENT_LABELS: Record<InstructionStackSegment['kind'], string> = {
  'architecture-md': '架构说明',
  constitution: '团队宪法',
  'project-memory': '项目记忆',
  'lessons-learned': '经验沉淀',
  'user-memory': '个人记忆',
  soul: '角色 SOUL',
  'cache-breaker': '缓存标记',
  'oversize-warning': '超限警告',
  raw: '其它',
};

export function instructionSegmentLabel(kind: InstructionStackSegment['kind']): string {
  return SEGMENT_LABELS[kind] ?? '其它';
}

/** kind 对应的内容是否按 markdown 渲染（宪法 / 记忆 / 经验 / SOUL 是 md）。 */
export function isMarkdownSegment(kind: InstructionStackSegment['kind']): boolean {
  return (
    kind === 'constitution' ||
    kind === 'project-memory' ||
    kind === 'lessons-learned' ||
    kind === 'user-memory' ||
    kind === 'soul'
  );
}

function classifyLayer(layer: string): InstructionStackSegment['kind'] {
  if (layer.startsWith('soul')) return 'soul';
  switch (layer) {
    case 'architecture-md':
      return 'architecture-md';
    case 'constitution':
      return 'constitution';
    case 'project-memory':
      return 'project-memory';
    case 'lessons-learned':
      return 'lessons-learned';
    case 'user-memory':
      return 'user-memory';
    case 'cache-breaker':
      return 'cache-breaker';
    case 'oversize-warning':
      return 'oversize-warning';
    default:
      return 'raw';
  }
}

const SEGMENT_RE =
  /<team-instruction\s+layer="([^"]*)"(?:\s+tag="([^"]*)")?\s*(?:\/>|>([\s\S]*?)<\/team-instruction>)/g;

/**
 * 把 stableBlock 解析成有序片段列表。识别不到任何 team-instruction 标签时，
 * 返回单个 raw 片段（保底，等价于原始全文）。
 */
export function parseInstructionStack(stableBlock: string): InstructionStackSegment[] {
  const text = stableBlock ?? '';
  const segments: InstructionStackSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  SEGMENT_RE.lastIndex = 0;
  while ((match = SEGMENT_RE.exec(text)) !== null) {
    // 标签之间的游离文本（一般是空白）并入 raw 片段，避免丢内容。
    const between = text.slice(lastIndex, match.index).trim();
    if (between.length > 0) {
      segments.push({ layer: 'raw', kind: 'raw', body: between });
    }
    const layer = match[1] ?? '';
    const tag = match[2];
    const body = (match[3] ?? '').trim();
    segments.push({
      layer,
      kind: classifyLayer(layer),
      body,
      ...(tag !== undefined ? { tag } : {}),
    });
    lastIndex = match.index + match[0].length;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail.length > 0) {
    segments.push({ layer: 'raw', kind: 'raw', body: tail });
  }

  if (segments.length === 0 && text.trim().length > 0) {
    return [{ layer: 'raw', kind: 'raw', body: text.trim() }];
  }

  return segments;
}
