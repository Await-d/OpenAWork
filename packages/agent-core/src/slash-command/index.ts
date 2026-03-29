export interface SlashCommand {
  name: string;
  args: string[];
  raw: string;
}

export type SlashCommandHandler = (cmd: SlashCommand) => Promise<string | void>;

export interface SlashCommandRouter {
  register(name: string, handler: SlashCommandHandler): void;
  unregister(name: string): void;
  parse(input: string): SlashCommand | null;
  dispatch(input: string): Promise<string | void | null>;
  listCommands(): string[];
}

const SLASH_PATTERN = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+(.*))?$/s;

function tokenizeSlashArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  const match = SLASH_PATTERN.exec(trimmed);
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const rest = match[2]?.trim() ?? '';
  const args = rest.length > 0 ? tokenizeSlashArgs(rest) : [];
  return { name, args, raw: trimmed };
}

export interface HandoffDocument {
  sessionId: string;
  title: string;
  goal: string;
  summary: string;
  currentState: string[];
  completedItems: string[];
  pendingItems: string[];
  keyFiles: string[];
  keyDecisions: string[];
  explicitConstraints: string[];
  continuationHints: string[];
  nextSteps: string[];
  generatedAt: number;
}

export function buildHandoffDocument(params: {
  sessionId: string;
  title: string;
  goal?: string;
  summary: string;
  currentState?: string[];
  completedItems?: string[];
  pendingItems?: string[];
  keyFiles?: string[];
  keyDecisions?: string[];
  explicitConstraints?: string[];
  continuationHints?: string[];
  nextSteps?: string[];
}): HandoffDocument {
  return {
    sessionId: params.sessionId,
    title: params.title,
    goal: params.goal ?? '继续当前任务并保持上下文连续。',
    summary: params.summary,
    currentState: params.currentState ?? [],
    completedItems: params.completedItems ?? [],
    pendingItems: params.pendingItems ?? [],
    keyFiles: params.keyFiles ?? [],
    keyDecisions: params.keyDecisions ?? [],
    explicitConstraints: params.explicitConstraints ?? [],
    continuationHints: params.continuationHints ?? [],
    nextSteps: params.nextSteps ?? [],
    generatedAt: Date.now(),
  };
}

export function formatHandoffMarkdown(doc: HandoffDocument): string {
  const date = new Date(doc.generatedAt).toISOString();
  const currentState =
    doc.currentState.length > 0 ? doc.currentState : ['当前状态未记录更多结构化摘要。'];
  const completedItems =
    doc.completedItems.length > 0 ? doc.completedItems : ['暂无明确已完成事项。'];
  const pendingItems = doc.pendingItems.length > 0 ? doc.pendingItems : ['暂无明确待完成事项。'];
  const keyFiles = doc.keyFiles.length > 0 ? doc.keyFiles : ['None'];
  const keyDecisions = doc.keyDecisions.length > 0 ? doc.keyDecisions : ['暂无关键决策记录。'];
  const explicitConstraints =
    doc.explicitConstraints.length > 0 ? doc.explicitConstraints : ['None'];
  const nextSteps = doc.nextSteps.length > 0 ? doc.nextSteps : ['继续从当前上下文推进下一步工作。'];
  const continuationHints =
    doc.continuationHints.length > 0
      ? doc.continuationHints
      : ['新开一个会话。', '把这份 handoff 作为第一条消息贴进去。', '补充你的下一步任务要求。'];
  const lines: string[] = [
    '# HANDOFF CONTEXT（交接上下文）',
    '',
    `**Session ID**: ${doc.sessionId}`,
    `**Generated At**: ${date}`,
    '',
    '## GOAL（下一目标）',
    '',
    doc.goal,
    '',
    '## SUMMARY（工作摘要）',
    '',
    doc.summary,
    '',
    '## CURRENT STATE（当前状态）',
    '',
    ...currentState.map((item) => `- ${item}`),
    '',
    '## WORK COMPLETED（已完成事项）',
    '',
    ...completedItems.map((item) => `- ${item}`),
    '',
    '## PENDING TASKS（待完成事项）',
    '',
    ...pendingItems.map((item) => `- ${item}`),
    '',
    '## KEY FILES（关键文件）',
    '',
    ...keyFiles.map((item) => `- ${item}`),
    '',
    '## IMPORTANT DECISIONS（关键决策）',
    '',
    ...keyDecisions.map((item) => `- ${item}`),
    '',
    '## EXPLICIT CONSTRAINTS（明确约束）',
    '',
    ...explicitConstraints.map((item) => `- ${item}`),
    '',
    '## NEXT STEPS（下一步建议）',
    '',
    ...nextSteps.map((item) => `- ${item}`),
    '',
    '## TO CONTINUE（如何继续）',
    '',
    ...continuationHints.map((item, index) => `${index + 1}. ${item}`),
  ];
  return lines.join('\n');
}

export class SlashCommandRouterImpl implements SlashCommandRouter {
  private handlers = new Map<string, SlashCommandHandler>();

  register(name: string, handler: SlashCommandHandler): void {
    this.handlers.set(name.toLowerCase(), handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name.toLowerCase());
  }

  parse(input: string): SlashCommand | null {
    return parseSlashCommand(input);
  }

  async dispatch(input: string): Promise<string | void | null> {
    const cmd = parseSlashCommand(input);
    if (!cmd) return null;
    const handler = this.handlers.get(cmd.name);
    if (!handler) return null;
    return handler(cmd);
  }

  listCommands(): string[] {
    return [...this.handlers.keys()];
  }
}
