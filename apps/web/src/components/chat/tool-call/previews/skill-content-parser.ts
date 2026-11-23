export interface SkillContentView {
  content: string;
  name?: string;
  files: string[];
  raw: string;
}

/** 仅完整信封可隐藏参数；混入诊断、缺失闭合标签时保留原始输出。 */
export function extractSkillContent(output: unknown): SkillContentView | null {
  if (typeof output !== 'string') return null;
  const match = /^\s*<skill_content(?:\s+name="([^"]*)")?\s*>([\s\S]*)<\/skill_content>\s*$/i.exec(
    output,
  );
  if (!match) return null;
  let content = (match[2] ?? '').trim();
  if (/<\/?skill_content\b/i.test(content)) return null;
  const files: string[] = [];
  const resources = /\s*<skill_files>([\s\S]*?)<\/skill_files>\s*$/i.exec(content);
  if (resources) {
    const resourceText = resources[1] ?? '';
    if (/<\/?(?:skill_files|file)\b/i.test(resourceText.replace(/<file>[^<>]+<\/file>/gi, '')))
      return null;
    for (const file of (resources[1] ?? '').matchAll(/<file>([^<>]+)<\/file>/gi)) {
      const path = file[1]?.trim();
      if (path) files.push(path);
    }
    content = content.slice(0, resources.index).trim();
  }
  // 不完整的资源包装不能在 Markdown 中被静默吞掉。
  if (/<\/?skill_files\b/i.test(content)) return null;
  const name = match[1]?.trim();
  if (!content && !name && !resources) return null;
  return { content, files, raw: output, ...(name ? { name } : {}) };
}
