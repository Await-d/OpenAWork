import type { ModelRouteConfig } from './model-router.js';
import { sqliteGet, sqliteRun } from './db.js';
import { runUpstreamGenerate } from './v2-runtime/upstream/index.js';

const TITLE_SYSTEM_PROMPT = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- 4–12 characters (strictly enforced, count carefully)
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → 调试生产500错误
"refactor user service" → 重构用户服务
"why is app.js failing" → app.js故障排查
"implement rate limiting" → 实现限流
"how do I connect postgres to my API" → Postgres连API
"best practices for React hooks" → React Hooks实践
"@src/auth.ts can you add refresh token support" → 刷新Token支持
"@utils/parser.ts this is broken" → 修复Parser
"look at @config.json" → 查看配置文件
"@App.tsx add dark mode toggle" → 添加暗色模式
</examples>`;

export interface TitleLlmInput {
  route: ModelRouteConfig;
  userMessage: string;
  sessionId: string;
  userId: string;
}

export async function generateSessionTitleLlm(input: TitleLlmInput): Promise<void> {
  if (!isSessionTitleEmpty(input.sessionId, input.userId)) {
    return;
  }

  try {
    const title = await callTitleLlm(input.route, input.userMessage);
    if (!title) return;

    const cleaned = title
      .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!cleaned) return;

    const finalTitle = cleaned.length > 12 ? cleaned.substring(0, 12) : cleaned;
    if (finalTitle.length < 4) return;

    sqliteRun(
      "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND COALESCE(TRIM(title), '') = ''",
      [finalTitle, input.sessionId, input.userId],
    );
  } catch (error: unknown) {
    console.warn('LLM title generation failed, keeping heuristic title:', error);
  }
}

async function callTitleLlm(route: ModelRouteConfig, userMessage: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const result = await runUpstreamGenerate({
      providerType: route.providerType ?? 'openai',
      ...(route.apiKey ? { apiKey: route.apiKey } : {}),
      ...(route.apiBaseUrl ? { baseURL: route.apiBaseUrl } : {}),
      ...(route.requestOverrides.headers && Object.keys(route.requestOverrides.headers).length > 0
        ? { headers: route.requestOverrides.headers }
        : {}),
      model: route.model,
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Generate a title for this conversation:\n${userMessage}`,
        },
      ],
      maxOutputTokens: 100,
      temperature: 0.5,
      requestOverrides: route.requestOverrides,
      signal: controller.signal,
    });
    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function isFirstUserMessage(sessionId: string, userId: string): boolean {
  const count =
    sqliteGet<{ count: number }>(
      "SELECT COUNT(1) AS count FROM message_v2 WHERE session_id = ? AND user_id = ? AND json_extract(data, '$.role') = 'user'",
      [sessionId, userId],
    )?.count ?? 0;
  return count === 1;
}

export function isSessionTitleEmpty(sessionId: string, userId: string): boolean {
  const row = sqliteGet<{ title: string | null }>(
    'SELECT title FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );
  return !row?.title || row.title.trim() === '';
}
