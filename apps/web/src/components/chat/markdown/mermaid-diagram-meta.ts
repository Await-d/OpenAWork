/**
 * Mermaid 围栏别名、图表类型识别与 SVG 尺寸/导出处理的纯函数集合。
 */

/**
 * 允许直接触发图表渲染的围栏语言别名。
 *
 * 除了 `mermaid` / `mmd`，模型也常直接把图表类型当语言名写（```mindmap、
 * ```flowchart），这些词都不是真实的高亮语言，认下来只会更贴近用户意图。
 */
const MERMAID_FENCE_LANGUAGES = new Set([
  'mermaid',
  'mmd',
  'mindmap',
  'flowchart',
  'graph',
  'sequence',
  'sequencediagram',
  'classdiagram',
  'statediagram',
  'erdiagram',
  'gantt',
  'pie',
  'journey',
  'gitgraph',
  'timeline',
  'quadrantchart',
  'xychart',
  'sankey',
  'treemap',
  'radar',
  'kanban',
  'block',
  'architecture',
  'requirementdiagram',
]);

export function isMermaidFenceLanguage(language: string | undefined): boolean {
  if (language === undefined) {
    return false;
  }

  return MERMAID_FENCE_LANGUAGES.has(language.trim().toLowerCase());
}

export type MermaidDiagramKind =
  | 'mindmap'
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'entityRelationship'
  | 'gantt'
  | 'pie'
  | 'journey'
  | 'gitGraph'
  | 'timeline'
  | 'quadrant'
  | 'xyChart'
  | 'sankey'
  | 'treemap'
  | 'radar'
  | 'kanban'
  | 'block'
  | 'architecture'
  | 'requirement'
  | 'packet'
  | 'c4'
  | 'unknown';

const KIND_ORDER: Array<{ pattern: RegExp; kind: MermaidDiagramKind }> = [
  { pattern: /^mindmap\b/i, kind: 'mindmap' },
  { pattern: /^(flowchart|graph)\b/i, kind: 'flowchart' },
  { pattern: /^sequenceDiagram\b/i, kind: 'sequence' },
  { pattern: /^classDiagram/i, kind: 'class' },
  { pattern: /^stateDiagram/i, kind: 'state' },
  { pattern: /^erDiagram\b/i, kind: 'entityRelationship' },
  { pattern: /^requirementDiagram\b/i, kind: 'requirement' },
  { pattern: /^gitGraph\b/i, kind: 'gitGraph' },
  { pattern: /^quadrantChart\b/i, kind: 'quadrant' },
  { pattern: /^xychart/i, kind: 'xyChart' },
  { pattern: /^sankey/i, kind: 'sankey' },
  { pattern: /^treemap/i, kind: 'treemap' },
  { pattern: /^radar/i, kind: 'radar' },
  { pattern: /^kanban\b/i, kind: 'kanban' },
  { pattern: /^block/i, kind: 'block' },
  { pattern: /^architecture/i, kind: 'architecture' },
  { pattern: /^packet/i, kind: 'packet' },
  { pattern: /^gantt\b/i, kind: 'gantt' },
  { pattern: /^pie\b/i, kind: 'pie' },
  { pattern: /^journey\b/i, kind: 'journey' },
  { pattern: /^timeline\b/i, kind: 'timeline' },
  { pattern: /^C4(Context|Container|Component|Dynamic|Deployment)\b/, kind: 'c4' },
];

const KIND_LABELS: Record<MermaidDiagramKind, string> = {
  mindmap: '思维导图',
  flowchart: '流程图',
  sequence: '时序图',
  class: '类图',
  state: '状态图',
  entityRelationship: 'ER 图',
  gantt: '甘特图',
  pie: '饼图',
  journey: '旅程图',
  gitGraph: 'Git 图',
  timeline: '时间线',
  quadrant: '象限图',
  xyChart: '坐标图',
  sankey: '桑基图',
  treemap: '矩形树图',
  radar: '雷达图',
  kanban: '看板',
  block: '块图',
  architecture: '架构图',
  requirement: '需求图',
  packet: '报文图',
  c4: 'C4 架构图',
  unknown: '图表',
};

/**
 * 从图表源码里识别图表类型。
 *
 * 只扫开头的若干有意义行：跳过空行、`%%` 注释、`%%{init}%%` 指令与
 * `---` 元信息块，避免把注释里的关键词误判成图表类型。
 */
export function detectMermaidDiagramKind(code: string): MermaidDiagramKind {
  const lines = code.split('\n');
  let inFrontMatter = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      continue;
    }

    if (line === '---') {
      inFrontMatter = !inFrontMatter;
      continue;
    }

    if (inFrontMatter || line.startsWith('%%') || line.startsWith('#')) {
      continue;
    }

    for (const { pattern, kind } of KIND_ORDER) {
      if (pattern.test(line)) {
        return kind;
      }
    }

    // 首条有效语句都无法识别时不再往下找，避免把节点文本里的词误判为图表类型。
    return 'unknown';
  }

  return 'unknown';
}

export function getMermaidDiagramLabel(kind: MermaidDiagramKind): string {
  return KIND_LABELS[kind];
}

export interface SvgIntrinsicSize {
  width: number;
  height: number;
}

/**
 * 解析 mermaid 输出 SVG 的 `viewBox`，拿到图形的固有尺寸。
 *
 * 有了固有尺寸才能做到「适应宽度 / 缩放」都基于真实比例，
 * 而不是靠 CSS 猜测。
 */
export function parseSvgIntrinsicSize(svg: string): SvgIntrinsicSize | null {
  const match = /viewBox\s*=\s*["']([^"']+)["']/iu.exec(svg);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }

  const parts = raw.trim().split(/[\s,]+/);
  if (parts.length < 4) {
    return null;
  }

  const width = Number.parseFloat(parts[2] ?? '');
  const height = Number.parseFloat(parts[3] ?? '');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

/**
 * 补全导出的 SVG：确保命名空间与背景色，使文件单独打开时不是透明底。
 */
export function buildExportableSvg(svg: string, background: string): string {
  let output = svg;

  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/iu.test(output)) {
    output = output.replace(/<svg\b/iu, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  if (!/xmlns:xlink\s*=/iu.test(output)) {
    output = output.replace(/<svg\b/iu, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  if (background !== '') {
    const rect = `<rect width="100%" height="100%" fill="${background}"/>`;
    output = output.replace(/(<svg\b[^>]*>)/iu, `$1${rect}`);
  }

  return output;
}
