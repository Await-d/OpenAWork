import type { ModelRouteConfig } from '../provider/model-router.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';

const TITLE_SYSTEM_PROMPT = `你是一个标题生成器。你输出一个会话标题和一个 emoji 图标，仅此而已。

<task>
生成一个简短标题，帮助用户之后能找回这段会话，并选一个最能代表会话主题的单个 emoji。

严格遵守 <rules> 中的所有规则。
阅读 <examples> 以了解什么是合格的标题。
输出必须**正好两行**：
- 第 1 行：标题（4–12 个字符，严格限制，自己仔细数）
- 第 2 行：一个最能代表主题的单个 emoji 字符
- 不要加任何解释
</task>

<rules>
- 必须与用户消息使用相同的语言（用户用中文就输出中文标题，用英文就输出英文标题）
- 标题必须语法正确、读起来自然，不要拼凑词汇
- 标题里绝不出现工具名（如 "read tool"、"bash tool"、"edit tool"）
- 聚焦用户之后想要找回时的主题或问题
- 措辞多样化，避免每次都以同样的词（例如 "Analyzing"、"分析"）开头
- 用户提到文件时，聚焦"用户想对文件做什么"，而非"用户分享了文件"
- 保持原样：技术术语、数字、文件名、HTTP 状态码
- 移除：the、this、my、a、an、"这个"、"我的" 之类的冗词
- 绝不假设技术栈
- 不要调用任何工具
- 绝不回答问题本身，只为会话生成标题
- 生成标题时，标题里不要出现"总结"/"生成"/"summarizing"/"generating" 这类元描述
- 绝不拒绝生成，也不要抱怨输入内容
- 即使输入极少，也要输出有意义的标题
- 如果用户消息是很短或对话性的（如 "hello"、"lol"、"你好"、"在吗"）：
  → 生成反映用户语气/意图的标题（例如 "打招呼"、"闲聊"、"简短问候"、"Greeting"、"Quick check-in" 等）
</rules>

<examples>
"debug 500 errors in production" →
调试生产500错误
🐛

"refactor user service" →
重构用户服务
🔧

"why is app.js failing" →
app.js故障排查
🔍

"implement rate limiting" →
实现限流
⚡

"how do I connect postgres to my API" →
Postgres连API
🗄️

"best practices for React hooks" →
React Hooks实践
⚛️

"@src/auth.ts can you add refresh token support" →
刷新Token支持
🔑

"@App.tsx add dark mode toggle" →
添加暗色模式
🌙
</examples>`;

export interface TitleLlmInput {
  route: ModelRouteConfig;
  userMessage: string;
  sessionId: string;
  userId: string;
}

export async function generateSessionTitleLlm(input: TitleLlmInput): Promise<void> {
  const { titleEmpty, iconEmpty } = getSessionTitleAndIconState(input.sessionId, input.userId);
  // Skip only when both title and icon are already set
  if (!titleEmpty && !iconEmpty) {
    return;
  }

  try {
    const rawOutput = await callTitleLlm(input.route, input.userMessage, input.sessionId);
    if (!rawOutput) return;

    const lines = rawOutput
      .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return;

    const titleLine = lines[0]!;
    const finalTitle = titleLine.length > 12 ? titleLine.substring(0, 12) : titleLine;

    const emojiLine = lines.length >= 2 ? lines[1] : undefined;
    const emoji = emojiLine && isValidEmoji(emojiLine) ? emojiLine : undefined;

    if (titleEmpty && finalTitle.length >= 4) {
      sqliteRun(
        "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND COALESCE(TRIM(title), '') = ''",
        [finalTitle, input.sessionId, input.userId],
      );
    }

    if (iconEmpty && emoji) {
      saveSessionIcon(input.sessionId, input.userId, emoji);
    }
  } catch (error: unknown) {
    console.warn('LLM title generation failed, keeping heuristic title:', error);
  }
}

async function callTitleLlm(
  route: ModelRouteConfig,
  userMessage: string,
  sessionId: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const result = await runUpstreamGenerate({
      providerType: route.providerType ?? 'openai',
      // Forward the resolved upstream protocol so providers configured for
      // `anthropic_messages` / `responses` actually hit their native API
      // surface instead of silently degrading to OpenAI Chat Completions.
      ...(route.upstreamProtocol ? { upstreamProtocol: route.upstreamProtocol } : {}),
      ...(route.apiKey ? { apiKey: route.apiKey } : {}),
      ...(route.apiBaseUrl ? { baseURL: route.apiBaseUrl } : {}),
      ...(route.requestOverrides.headers && Object.keys(route.requestOverrides.headers).length > 0
        ? { headers: route.requestOverrides.headers }
        : {}),
      model: route.model,
      sessionId,
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `请为下面这段会话生成标题：\n${userMessage}`,
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

const EMOJI_REGEX = /^\p{Emoji}[\uFE0F\u20E3]?(?:\u200D\p{Emoji}[\uFE0F]?)*$/u;

function isValidEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 10) return false;
  // Reject bare ASCII/digit/keycap characters that technically carry the Emoji property
  if (/^[0-9*#]$/.test(trimmed)) return false;
  return EMOJI_REGEX.test(trimmed);
}

function saveSessionIcon(sessionId: string, userId: string, icon: string): void {
  try {
    const row = sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId],
    );
    const metadata = row ? parseSessionMetadataJson(row.metadata_json) : {};
    metadata['icon'] = icon;
    sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify(metadata),
      sessionId,
      userId,
    ]);
  } catch (error: unknown) {
    console.warn('Failed to save session icon:', error);
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

function getSessionTitleAndIconState(
  sessionId: string,
  userId: string,
): { titleEmpty: boolean; iconEmpty: boolean } {
  const row = sqliteGet<{ title: string | null; metadata_json: string | null }>(
    'SELECT title, metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );
  const titleEmpty = !row?.title || row.title.trim() === '';
  let iconEmpty = true;
  if (row?.metadata_json) {
    try {
      const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
      const icon = meta['icon'];
      iconEmpty = !icon || typeof icon !== 'string' || icon.trim().length === 0;
    } catch {
      iconEmpty = true;
    }
  }
  return { titleEmpty, iconEmpty };
}

export function isSessionTitleEmpty(sessionId: string, userId: string): boolean {
  return getSessionTitleAndIconState(sessionId, userId).titleEmpty;
}
