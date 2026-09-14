import { ExpandableOutput } from '../shared/expandable-output.js';

/**
 * The `skill` tool returns its payload wrapped in a `<skill_content
 * name="…">…</skill_content>` envelope (see the gateway's skill tool). Showing
 * the raw wrapper leaks implementation tags into the UI, so we peel it off and
 * surface just the skill name + body.
 */
export interface SkillContentView {
  content: string;
  name?: string;
}

const SKILL_CONTENT_RE = /<skill_content(?:\s+name="([^"]*)")?\s*>([\s\S]*?)<\/skill_content>/i;

export function extractSkillContent(output: unknown): SkillContentView | null {
  const text = typeof output === 'string' ? output : null;
  if (!text) return null;
  const match = text.match(SKILL_CONTENT_RE);
  if (!match) return null;
  const name = match[1]?.trim();
  const content = (match[2] ?? '').trim();
  if (content.length === 0 && !name) return null;
  return { content, ...(name ? { name } : {}) };
}

export function SkillContentPreview({ data }: { data: SkillContentView }) {
  return (
    <div className="skill-content-preview">
      <div className="skill-content-header">
        <span className="skill-content-label">技能内容</span>
        {data.name && <span className="skill-content-name">{data.name}</span>}
      </div>
      {data.content.length > 0 ? (
        <ExpandableOutput text={data.content} maxChars={600} maxLines={18} />
      ) : (
        <div className="skill-content-empty">（无内容）</div>
      )}
    </div>
  );
}
