/**
 * 260531-team-page · parse-soul-frontmatter
 *
 * 角色 SOUL 文件以 YAML frontmatter（5 维度画像）+ Markdown 正文 组成：
 *
 *   ---
 *   identity: 接待 Agent…
 *   tone: 友好、稳定…
 *   focus:
 *     - 听清用户真正想要的结果
 *     - 把模糊诉求拆成具体目标
 *   boundaries:
 *     - 不直接给实现细节
 *   output_style: 短段落 + 结构化追问
 *   ---
 *
 *   # 接待 Agent SOUL
 *   …正文…
 *
 * chat 的 markdown 渲染器没有 frontmatter 插件，会把开头的 `---` 当成 `<hr>`，
 * 导致 5 维度画像渲染错乱、看起来"很简单"。这里做一个**零依赖**的轻量解析：
 * 拆出 frontmatter 字段（scalar / 字符串数组）与正文，供面板结构化展示。
 *
 * 解析策略保守：只认顶格 `key:` 与其下两空格缩进的 `- item` 列表，
 * 认不出的字段原样塞进 `extra`（保留可见性，绝不丢内容）。
 */

export interface SoulFrontmatterField {
  key: string;
  /** scalar 值（单行）或 null（当它是列表时）。 */
  value: string | null;
  /** 列表值（如 focus / boundaries）。 */
  items: string[];
}

export interface ParsedSoul {
  /** 是否检测到 frontmatter 块。 */
  hasFrontmatter: boolean;
  /** 解析出的 frontmatter 字段（保持原始顺序）。 */
  fields: SoulFrontmatterField[];
  /** frontmatter 之后的 Markdown 正文（已 trim）。 */
  body: string;
}

const FIELD_LABELS: Record<string, string> = {
  identity: '身份定位',
  tone: '语气基调',
  focus: '关注重点',
  boundaries: '边界 / 不做',
  output_style: '输出风格',
};

/** frontmatter 字段 key → 中文标签（未知 key 原样返回）。 */
export function soulFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/**
 * 解析 SOUL 文本。无 frontmatter 时 `hasFrontmatter=false`，整体作为 body 返回。
 */
export function parseSoulFrontmatter(soulMd: string): ParsedSoul {
  const text = soulMd.replace(/\r\n/g, '\n');
  const match = /^\s*---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { hasFrontmatter: false, fields: [], body: text.trim() };
  }

  const [, frontmatterRaw, body] = match;
  const fields = parseFrontmatterBlock(frontmatterRaw ?? '');
  return { hasFrontmatter: true, fields, body: (body ?? '').trim() };
}

function parseFrontmatterBlock(raw: string): SoulFrontmatterField[] {
  const lines = raw.split('\n');
  const fields: SoulFrontmatterField[] = [];
  let current: SoulFrontmatterField | null = null;

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    // 列表项：缩进 + "- "
    const listMatch = /^\s+-\s+(.*)$/.exec(line);
    if (listMatch && current) {
      const item = stripQuotes(listMatch[1] ?? '').trim();
      if (item.length > 0) current.items.push(item);
      continue;
    }

    // 顶层字段：key: value
    const fieldMatch = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (fieldMatch) {
      const key = fieldMatch[1] ?? '';
      const rest = stripQuotes((fieldMatch[2] ?? '').trim());
      current = { key, value: rest.length > 0 ? rest : null, items: [] };
      fields.push(current);
      continue;
    }

    // 续行（多行 scalar）：并入当前字段的 value。
    if (current && current.items.length === 0) {
      const cont = line.trim();
      current.value = current.value ? `${current.value} ${cont}` : cont;
    }
  }

  return fields;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
