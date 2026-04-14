import type { MessageContent } from '@openAwork/shared';
import type { ToolStateCompleted, ToolStateError } from '../message-v2-schema.js';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../db.js';
import {
  appendSessionMessageV2,
  appendSnapshotPart,
  appendPatchPart,
  emitSessionCreated,
  listSessionMessagesV2,
} from '../message-v2-adapter.js';
import {
  getMessage,
  getPart,
  listMessages,
  listPartsForMessage,
  listMessagesWithParts,
  getMessageWithParts,
  toModelMessages,
  filterCompacted,
  findToolPartByCallID,
} from '../message-store-v2.js';
import { replayEventsForAggregate } from '../sync-event.js';
import type { TextPart } from '../message-v2-schema.js';
import { resolveModelRoute, resolveModelRouteFromProvider } from '../model-router.js';
import { getProviderConfigForSelection } from '../provider-config.js';
import { sqliteGet } from '../db.js';
import { buildUpstreamRequestBody } from '../routes/upstream-request.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

const USER_TURNS = [
  'My name is Alice. Remember it. Just confirm briefly.',
  'What is my name? Answer in one sentence.',
  'I work as a software engineer in Tokyo. Remember this. Just confirm.',
  'What is my name and where do I work? Answer in one sentence.',
  'I have a cat named Mochi. Remember this. Just confirm.',
  // Tool-use turns — LLM should decide to call bash
  'Use bash to list the files in the current directory, then tell me what you found.',
  'Run a bash command to show the current date and time.',
  'Use bash to check how much disk space is available on this system.',
  'My favorite color is blue. Remember it. Just confirm.',
  'Now tell me everything you know about me — name, work, pet, hobby, color. Be thorough.',
  'Final test: write a short poem that includes all the facts you know about me.',
];

// Assistant turns are now generated dynamically via real API calls
const ASSISTANT_TURNS: string[] = [];

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((content) => content.type === 'text' && typeof content.text === 'string')
    .map((content) => content.text ?? '')
    .join('\n')
    .trim();
}

// Reconstruct {role, content} from production listMessagesWithParts
function reconstructHistory(
  sessionId: string,
  userId: string,
): Array<{ role: string; content: string }> {
  const messagesWithParts = listMessagesWithParts({ sessionId, userId, limit: 200 });
  const result: Array<{ role: string; content: string }> = [];

  // Build a queue of completed/errored tool parts to match with tool messages
  const toolPartQueue = messagesWithParts
    .filter((m) => m.info.role === 'assistant')
    .flatMap((m) => m.parts)
    .filter(
      (p) => p.type === 'tool' && (p.state.status === 'completed' || p.state.status === 'error'),
    )
    .sort((a, b) => {
      const aTime =
        a.type === 'tool' && a.state && 'time' in a.state
          ? (a.state as { time: { start: number } }).time.start
          : 0;
      const bTime =
        b.type === 'tool' && b.state && 'time' in b.state
          ? (b.state as { time: { start: number } }).time.start
          : 0;
      return aTime - bTime;
    });

  let toolPartIndex = 0;

  for (const msg of messagesWithParts) {
    if (msg.info.role === 'user') {
      const textParts = msg.parts.filter((p) => p.type === 'text' && !('ignored' in p));
      const content = textParts.map((p) => ('text' in p ? p.text : '')).join('');
      result.push({ role: 'user', content });
    } else if (msg.info.role === 'assistant') {
      const textParts = msg.parts.filter((p) => p.type === 'text');
      const content = textParts.map((p) => ('text' in p ? p.text : '')).join('');
      result.push({ role: 'assistant', content });
    } else if (msg.info.role === 'tool') {
      // Tool messages have 0 parts in V2 — content comes from the completed/errored ToolPart
      const tp = toolPartQueue[toolPartIndex];
      toolPartIndex += 1;
      if (tp && tp.type === 'tool') {
        const state = tp.state as { status: string; output?: string; error?: string };
        const content = state.status === 'completed' ? (state.output ?? '') : (state.error ?? '');
        result.push({ role: 'tool', content });
      }
    }
  }
  return result;
}

/// Resolve provider route from DB config or env fallback
async function _resolveRouteForTest(_userId: string) {
  // Try DB config first
  const providersRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [_userId],
  );
  const selectionRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [_userId],
  );
  const providerConfig = await getProviderConfigForSelection(
    providersRow?.value ? JSON.parse(providersRow.value) : undefined,
    selectionRow?.value ? JSON.parse(selectionRow.value) : undefined,
  );
  if (providerConfig) {
    return resolveModelRouteFromProvider(providerConfig.provider, providerConfig.modelId, {
      maxTokens: 256,
      temperature: 0.3,
      systemPrompt:
        'You are a helpful assistant. Keep responses brief (1-2 sentences). Always remember facts the user tells you. Respond in the same language the user uses.',
    });
  }
  return resolveModelRoute({
    model: 'default',
    maxTokens: 256,
    temperature: 0.3,
    systemPrompt:
      'You are a helpful assistant. Keep responses brief (1-2 sentences). Always remember facts the user tells you. Respond in the same language the user uses.',
  });
}

/// Build a route config for a custom upstream endpoint
function buildCustomRoute(
  baseUrl: string,
  apiKey: string,
  model: string,
): ReturnType<typeof resolveModelRoute> {
  return {
    model,
    apiBaseUrl: baseUrl,
    apiKey,
    providerType: 'openai' as const,
    upstreamProtocol: 'responses' as const,
    maxTokens: 1024,
    temperature: 1,
    requestOverrides: {},
    systemPrompt:
      'Be brief, 1-2 sentences. Always remember facts the user tells you. Respond in the same language the user uses.',
    supportsThinking: true,
  };
}

type UpstreamChatMessage = {
  role: 'assistant' | 'system' | 'tool' | 'user';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

type UpstreamFunctionToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
};

const BASH_TOOL: UpstreamFunctionToolDefinition = {
  type: 'function',
  function: {
    name: 'bash',
    description:
      'Execute a bash command and return the output. Use for file operations, system info, and any shell commands.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
      },
      required: ['command'],
    },
  },
};

/// Execute a bash command safely and return stdout/stderr
function executeBash(command: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.slice(0, 4096), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? '').slice(0, 4096),
      stderr: (e.stderr ?? '').slice(0, 1024),
      exitCode: e.status ?? 1,
    };
  }
}

/// Result of an agentic upstream call — includes text and any tool calls made
interface AgenticCallResult {
  finalText: string;
  toolCalls: Array<{
    callId: string;
    toolName: string;
    arguments: string;
    result: string;
    isError: boolean;
  }>;
}

/// Send an agentic upstream request with tool support.
/// When the API returns tool_calls, executes bash and sends results back.
/// Loops until the model returns a final text response (no more tool calls).
/// Uses production buildUpstreamRequestBody to avoid drift from actual code paths.
async function callUpstreamWithTools(
  route: ReturnType<typeof resolveModelRoute>,
  messages: UpstreamChatMessage[],
  tools: UpstreamFunctionToolDefinition[] = [],
): Promise<AgenticCallResult> {
  const protocol = route.upstreamProtocol;
  const upstreamPath = protocol === 'responses' ? '/responses' : '/chat/completions';
  const url = `${route.apiBaseUrl}${upstreamPath}`;

  // Build headers — same logic as compaction-llm.ts and stream-model-round.ts
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(route.requestOverrides?.headers ?? {}),
  };
  if (route.apiKey) {
    if (route.providerType === 'anthropic') {
      headers['x-api-key'] = route.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${route.apiKey}`;
    }
  }

  const allToolCalls: AgenticCallResult['toolCalls'] = [];
  let currentMessages = [...messages];
  const maxRounds = 8; // prevent infinite loops
  let emptyRetries = 0; // track empty response retries

  for (let round = 0; round < maxRounds; round += 1) {
    // Build body using production function
    const body = {
      ...buildUpstreamRequestBody({
        protocol,
        model: route.model,
        maxTokens: route.maxTokens,
        temperature: route.temperature ?? 0.3,
        messages: currentMessages,
        tools,
        requestOverrides: route.requestOverrides,
        thinking: route.supportsThinking
          ? {
              enabled: true,
              effort: 'low',
              providerType: route.providerType,
              supportsThinking: true,
            }
          : undefined,
      }),
      stream: false,
    };

    console.log(
      `  [API] POST ${url} model=${route.model} protocol=${protocol} round=${round} msgs=${currentMessages.length} tools=${tools.length}`,
    );

    // Retry transient errors
    let response: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (
        response.ok ||
        (response.status !== 429 && response.status !== 502 && response.status !== 503)
      )
        break;
      const delayMs = (attempt + 1) * 3000;
      console.log(`  [API] Retry ${attempt + 1}/5 after ${delayMs}ms (status ${response.status})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (!response!.ok) {
      const errorText = await response!.text().catch(() => 'Unknown error');
      throw new Error(`Upstream API call failed (${response!.status}): ${errorText.slice(0, 500)}`);
    }

    const json = (await response!.json()) as Record<string, unknown>;

    if (protocol === 'responses') {
      const output = json['output'] as Array<Record<string, unknown>> | undefined;
      let text = '';
      const roundToolCalls: Array<{ callId: string; name: string; arguments: string }> = [];

      for (const item of output ?? []) {
        if (item['type'] === 'message') {
          const content = item['content'] as Array<Record<string, unknown>> | undefined;
          for (const part of content ?? []) {
            if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
              text += part['text'];
            }
          }
        }
        if (item['type'] === 'function_call') {
          roundToolCalls.push({
            callId: String(typeof item['call_id'] === 'string' ? item['call_id'] : ''),
            name: String(typeof item['name'] === 'string' ? item['name'] : ''),
            arguments: String(typeof item['arguments'] === 'string' ? item['arguments'] : '{}'),
          });
        }
      }

      // If no tool calls, return final text (with empty-response retry)
      if (roundToolCalls.length === 0) {
        if (!text.trim() && emptyRetries < 3) {
          emptyRetries += 1;
          console.log(`  [API] Empty response on round ${round}, retry ${emptyRetries}/3...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          round -= 1; // retry same round
          continue;
        }
        return { finalText: text.trim(), toolCalls: allToolCalls };
      }

      // Execute tool calls and add results to conversation
      console.log(
        `  [Tool] Round ${round}: ${roundToolCalls.length} tool call(s) — ${roundToolCalls.map((tc) => tc.name).join(', ')}`,
      );
      emptyRetries = 0; // reset on successful tool call

      // Add assistant message with tool_calls to conversation
      currentMessages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: roundToolCalls.map((tc) => ({
          id: tc.callId,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call and add result
      for (const tc of roundToolCalls) {
        let result: string;
        let isError = false;

        if (tc.name === 'bash') {
          try {
            const args = JSON.parse(tc.arguments) as { command?: string };
            const cmd = args.command ?? '';
            console.log(`  [Tool] Executing bash: ${cmd.slice(0, 80)}`);
            const execResult = executeBash(cmd);
            result =
              execResult.exitCode === 0
                ? execResult.stdout.trim()
                : `Exit code ${execResult.exitCode}: ${execResult.stderr.trim() || execResult.stdout.trim()}`;
            isError = execResult.exitCode !== 0;
          } catch (parseErr) {
            result = `Error parsing arguments: ${String(parseErr)}`;
            isError = true;
          }
        } else {
          result = `Unknown tool: ${tc.name}`;
          isError = true;
        }

        allToolCalls.push({
          callId: tc.callId,
          toolName: tc.name,
          arguments: tc.arguments,
          result: result.slice(0, 2048),
          isError,
        });
        console.log(
          `  [Tool] Result (${isError ? 'ERROR' : 'OK'}): ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`,
        );

        // Add tool result to conversation
        currentMessages.push({
          role: 'tool',
          content: result.slice(0, 2048),
          tool_call_id: tc.callId,
        });
      }
    } else {
      // chat_completions protocol
      const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
      const message = choices?.[0]?.['message'] as Record<string, unknown> | undefined;
      const content = message?.['content'];
      const toolCallsRaw = message?.['tool_calls'] as Array<Record<string, unknown>> | undefined;
      const text = typeof content === 'string' ? content.trim() : '';

      // If no tool calls, return final text
      if (!toolCallsRaw || toolCallsRaw.length === 0) {
        return { finalText: text, toolCalls: allToolCalls };
      }

      // Execute tool calls
      const roundToolCalls = toolCallsRaw.map((tc) => {
        const fn = tc['function'] as Record<string, unknown>;
        return {
          callId: String(typeof tc['id'] === 'string' ? tc['id'] : ''),
          name: String(typeof fn?.['name'] === 'string' ? fn['name'] : ''),
          arguments: String(typeof fn?.['arguments'] === 'string' ? fn['arguments'] : '{}'),
        };
      });

      console.log(
        `  [Tool] Round ${round}: ${roundToolCalls.length} tool call(s) — ${roundToolCalls.map((tc) => tc.name).join(', ')}`,
      );

      currentMessages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: roundToolCalls.map((tc) => ({
          id: tc.callId,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of roundToolCalls) {
        let result: string;
        let isError = false;

        if (tc.name === 'bash') {
          try {
            const args = JSON.parse(tc.arguments) as { command?: string };
            const cmd = args.command ?? '';
            console.log(`  [Tool] Executing bash: ${cmd.slice(0, 80)}`);
            const execResult = executeBash(cmd);
            result =
              execResult.exitCode === 0
                ? execResult.stdout.trim()
                : `Exit code ${execResult.exitCode}: ${execResult.stderr.trim() || execResult.stdout.trim()}`;
            isError = execResult.exitCode !== 0;
          } catch (parseErr) {
            result = `Error parsing arguments: ${String(parseErr)}`;
            isError = true;
          }
        } else {
          result = `Unknown tool: ${tc.name}`;
          isError = true;
        }

        allToolCalls.push({
          callId: tc.callId,
          toolName: tc.name,
          arguments: tc.arguments,
          result: result.slice(0, 2048),
          isError,
        });
        console.log(
          `  [Tool] Result (${isError ? 'ERROR' : 'OK'}): ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`,
        );

        currentMessages.push({
          role: 'tool',
          content: result.slice(0, 2048),
          tool_call_id: tc.callId,
        });
      }
    }
  }

  throw new Error(`Agentic loop exceeded ${maxRounds} rounds without final text response`);
}

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();

    try {
      const createdAt = Date.now();
      const sessionId = `session-deep-conv-${randomUUID()}`;
      const userId = `user-deep-conv-${randomUUID()}`;
      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        `message-v2-deep-${userId}@openawork.local`,
        'hash',
      ]);
      emitSessionCreated({
        sessionID: sessionId,
        info: {
          id: sessionId,
          userID: userId,
          title: 'Message V2 Deep Conversation',
          time: { created: createdAt, updated: createdAt },
        },
      });

      // ─── Phase 1: Build conversation with real API calls ───

      const expectedHistory: Array<{ role: string; content: string }> = [];
      const historySnapshots: Array<{
        turn: number;
        history: Array<{ role: string; content: string }>;
      }> = [];

      // Resolve provider route for real API calls
      // API credentials must be provided via env vars (never hardcoded)
      const customBaseUrl = process.env.DEEP_CONVERSATION_API_BASE;
      const customApiKey = process.env.DEEP_CONVERSATION_API_KEY;
      const customModel = process.env.DEEP_CONVERSATION_MODEL ?? 'gpt-5.4';
      assert(customBaseUrl, 'DEEP_CONVERSATION_API_BASE env var is required for real API test');
      assert(customApiKey, 'DEEP_CONVERSATION_API_KEY env var is required for real API test');
      const route = buildCustomRoute(customBaseUrl, customApiKey, customModel);
      console.log(
        `  [Phase 1] Route: provider=${route.providerType} model=${route.model} baseUrl=${route.apiBaseUrl} protocol=${route.upstreamProtocol}`,
      );

      // Track all tool calls across the conversation for V2 message store
      const allV2ToolCalls: Array<{
        callId: string;
        toolName: string;
        arguments: string;
        result: string;
        isError: boolean;
        turnIndex: number;
      }> = [];
      let v2Timestamp = createdAt;

      for (let index = 0; index < USER_TURNS.length; index += 1) {
        // Insert user message
        v2Timestamp += 1;
        appendSessionMessageV2({
          sessionId,
          userId,
          role: 'user',
          content: [{ type: 'text', text: USER_TURNS[index] ?? '' }],
          createdAt: v2Timestamp,
          clientRequestId: `req-message-v2-deep:user:${index + 1}`,
        });
        expectedHistory.push({ role: 'user', content: USER_TURNS[index] ?? '' });

        // Call upstream API with tool support — LLM decides whether to call tools
        const chatMessages: UpstreamChatMessage[] = [
          {
            role: 'system',
            content:
              'You are a helpful assistant. Keep responses brief (1-2 sentences). Always remember facts the user tells you. Respond in the same language the user uses. When the user asks you to run a command, use the bash tool to execute it.',
          },
          ...expectedHistory.map((e) => ({
            role: e.role as 'user' | 'assistant' | 'tool',
            content: e.content,
          })),
        ];
        const result = await callUpstreamWithTools(route, chatMessages, [BASH_TOOL]);
        assert(
          result.finalText.length > 0,
          `Turn ${index + 1}: upstream API should return non-empty response`,
        );
        ASSISTANT_TURNS.push(result.finalText);

        // Record tool calls into V2 message store
        if (result.toolCalls.length > 0) {
          console.log(
            `  [Phase 1] Turn ${index + 1}: ${result.toolCalls.length} tool call(s) by LLM`,
          );

          // Insert assistant message with tool_call parts
          const assistantContent: Array<Record<string, unknown>> = [
            { type: 'text', text: result.finalText },
          ];
          for (const tc of result.toolCalls) {
            assistantContent.push({
              type: 'tool_call',
              toolCallId: tc.callId,
              toolName: tc.toolName,
              input: JSON.parse(tc.arguments) as Record<string, unknown>,
              rawArguments: tc.arguments,
            });
          }

          v2Timestamp += 1;
          appendSessionMessageV2({
            sessionId,
            userId,
            role: 'assistant',
            content: assistantContent as unknown as MessageContent[],
            createdAt: v2Timestamp,
            clientRequestId: `req-message-v2-deep:assistant:${index + 1}`,
          });
          expectedHistory.push({ role: 'assistant', content: result.finalText });

          // Insert tool result messages
          for (const tc of result.toolCalls) {
            v2Timestamp += 1;
            appendSessionMessageV2({
              sessionId,
              userId,
              role: 'tool',
              content: [
                {
                  type: 'tool_result',
                  toolCallId: tc.callId,
                  toolName: tc.toolName,
                  output: tc.result,
                  isError: tc.isError,
                },
              ],
              createdAt: v2Timestamp,
              clientRequestId: `req-message-v2-deep:tool:${tc.callId}`,
            });
            expectedHistory.push({ role: 'tool', content: tc.result });

            allV2ToolCalls.push({
              callId: tc.callId,
              toolName: tc.toolName,
              arguments: tc.arguments,
              result: tc.result,
              isError: tc.isError,
              turnIndex: index,
            });
          }
        } else {
          // No tool calls — simple assistant response
          v2Timestamp += 1;
          appendSessionMessageV2({
            sessionId,
            userId,
            role: 'assistant',
            content: [{ type: 'text', text: result.finalText }],
            createdAt: v2Timestamp,
            clientRequestId: `req-message-v2-deep:assistant:${index + 1}`,
          });
          expectedHistory.push({ role: 'assistant', content: result.finalText });
        }

        // Snapshot history after each turn for consistency check
        historySnapshots.push({
          turn: index + 1,
          history: JSON.parse(JSON.stringify(expectedHistory)),
        });
      }

      console.log(`  [Phase 1] Total tool calls across conversation: ${allV2ToolCalls.length}`);
      console.log(
        `  [Phase 1] Tool calls by turn: ${allV2ToolCalls.map((tc) => `t${tc.turnIndex + 1}:${tc.toolName}`).join(', ') || 'none'}`,
      );

      // ─── Phase 2: V1 transcript bridge ───

      const transcript = listSessionMessagesV2({ sessionId, userId });
      // Dynamic count: each tool call adds 1 tool msg; assistant msgs with tool_calls are already counted
      const toolMsgCount = allV2ToolCalls.length;
      const expectedMessageCount = USER_TURNS.length * 2 + toolMsgCount;
      assert(
        transcript.length === expectedMessageCount,
        `deep conversation transcript should expose every message, expected ${expectedMessageCount}, got ${transcript.length}`,
      );
      assert(
        extractText(transcript[0] ?? { content: [] }) === USER_TURNS[0],
        'first user turn should remain readable through the V1 transcript bridge',
      );

      const finalAssistantText = extractText(transcript[transcript.length - 1] ?? { content: [] });
      // Context retention checks — real API should remember key facts
      const retainedFacts = ['Alice', 'Tokyo', 'Mochi', 'blue'];
      const retained = retainedFacts.filter((fact) => finalAssistantText.includes(fact));
      console.log(
        `  [Phase 2] Final assistant text: "${finalAssistantText.slice(0, 100)}${finalAssistantText.length > 100 ? '…' : ''}"`,
      );
      console.log(
        `  [Phase 2] Retained facts: ${retained.join(', ')} (${retained.length}/${retainedFacts.length})`,
      );
      assert(
        retained.length >= 2,
        `Final assistant reply should retain at least 2 key facts, got ${retained.length}: ${retained.join(', ')}`,
      );

      // ─── Phase 3: Raw DB counts ───

      const messageCount = sqliteAll<{ count: number }>(
        'SELECT COUNT(*) as count FROM message_v2 WHERE session_id = ?',
        [sessionId],
      )[0]?.count;
      const partCount = sqliteAll<{ count: number }>(
        'SELECT COUNT(*) as count FROM part_v2 WHERE session_id = ?',
        [sessionId],
      )[0]?.count;
      assert(
        messageCount === expectedMessageCount,
        `message_v2 should retain every conversation turn, expected ${expectedMessageCount}, got ${messageCount}`,
      );
      // Parts: text parts = user msgs + assistant msgs; tool parts = tool calls from assistant msgs
      // Tool messages update existing tool parts (PartUpdated), not create new ones
      const allParts = sqliteAll<{ type: string; count: number }>(
        "SELECT json_extract(data, '$.type') as type, COUNT(*) as count FROM part_v2 WHERE session_id = ? GROUP BY json_extract(data, '$.type')",
        [sessionId],
      );
      console.log(
        `  [Phase 3] Part breakdown: ${allParts.map((r) => `${r.type}=${r.count}`).join(', ')}`,
      );
      // text parts = USER_TURNS.length (user) + asstMessages.length (assistant text)
      // tool parts = allV2ToolCalls.length (one tool_call part per tool call in assistant msgs)
      // + 2 for snapshot/patch added in Phase 9
      const asstMessageCount = USER_TURNS.length; // one assistant msg per user turn
      const expectedTextParts = USER_TURNS.length + asstMessageCount;
      const expectedToolParts = allV2ToolCalls.length;
      const expectedPartCount = expectedTextParts + expectedToolParts;
      assert(
        (partCount ?? 0) >= expectedPartCount,
        `part_v2 should have at least ${expectedPartCount} parts (text+tool), got ${partCount}`,
      );

      // ─── Phase 4: Production listMessagesWithParts ───

      const history = listMessagesWithParts({ sessionId, userId });
      assert(
        history.length === expectedMessageCount,
        `message history should preserve every V2 message, expected ${expectedMessageCount}, got ${history.length}`,
      );
      // Not all messages are text-only now — tool messages have tool parts
      assert(
        history[1]?.info.role === 'assistant' && history[2]?.info.role === 'user',
        'conversation ordering should start user/assistant alternating',
      );
      // Verify tool messages exist in history
      const toolMessages = history.filter((m) => m.info.role === 'tool');
      assert(
        toolMessages.length === toolMsgCount,
        `should have ${toolMsgCount} tool messages, got ${toolMessages.length}`,
      );

      // ─── Phase 4b: Structural consistency across turns ───
      // Verify that same-role messages have identical field sets (no structural drift)

      const userMessages = history.filter((m) => m.info.role === 'user');
      const asstMessages = history.filter((m) => m.info.role === 'assistant');

      // User messages: all should have the same set of top-level keys
      const userKeySets = userMessages.map((m) => Object.keys(m.info).sort().join(','));
      const uniqueUserKeySets = new Set(userKeySets);
      console.log(
        `  [Phase 4b] User info keys:   ${[...uniqueUserKeySets].join(' | ')} (${userMessages.length} msgs, ${uniqueUserKeySets.size} variant(s))`,
      );
      assert(
        uniqueUserKeySets.size === 1,
        `All user messages should share the same info structure, got ${uniqueUserKeySets.size} variants: ${[...uniqueUserKeySets].join(' | ')}`,
      );

      // Assistant messages: all should have the same set of top-level keys
      const asstKeySets = asstMessages.map((m) => Object.keys(m.info).sort().join(','));
      const uniqueAsstKeySets = new Set(asstKeySets);
      console.log(
        `  [Phase 4b] Asst info keys:   ${[...uniqueAsstKeySets].join(' | ')} (${asstMessages.length} msgs, ${uniqueAsstKeySets.size} variant(s))`,
      );
      assert(
        uniqueAsstKeySets.size === 1,
        `All assistant messages should share the same info structure, got ${uniqueAsstKeySets.size} variants: ${[...uniqueAsstKeySets].join(' | ')}`,
      );

      // User parts: all text parts should have the same structure
      const userPartKeySets = userMessages.map((m) => Object.keys(m.parts[0]!).sort().join(','));
      const uniqueUserPartKeySets = new Set(userPartKeySets);
      console.log(
        `  [Phase 4b] User part keys:   ${[...uniqueUserPartKeySets].join(' | ')} (${uniqueUserPartKeySets.size} variant(s))`,
      );
      assert(
        uniqueUserPartKeySets.size === 1,
        `All user text parts should share the same structure, got ${uniqueUserPartKeySets.size} variants`,
      );

      // Assistant parts: some have only text, some have text+tool — verify text parts are consistent
      const asstTextParts = asstMessages
        .map((m) => m.parts.find((p) => p.type === 'text'))
        .filter((p): p is TextPart => p !== undefined);
      const asstTextPartKeySets = asstTextParts.map((p) => Object.keys(p).sort().join(','));
      const uniqueAsstTextPartKeySets = new Set(asstTextPartKeySets);
      console.log(
        `  [Phase 4b] Asst text part keys: ${[...uniqueAsstTextPartKeySets].join(' | ')} (${uniqueAsstTextPartKeySets.size} variant(s))`,
      );
      assert(
        uniqueAsstTextPartKeySets.size === 1,
        `All assistant text parts should share the same structure, got ${uniqueAsstTextPartKeySets.size} variants`,
      );

      // Tool messages: all should have the same info structure
      const toolKeySets = toolMessages.map((m) => Object.keys(m.info).sort().join(','));
      const uniqueToolKeySets = new Set(toolKeySets);
      console.log(
        `  [Phase 4b] Tool info keys:   ${[...uniqueToolKeySets].join(' | ')} (${toolMessages.length} msgs, ${uniqueToolKeySets.size} variant(s))`,
      );
      assert(
        uniqueToolKeySets.size === 1,
        `All tool messages should share the same info structure, got ${uniqueToolKeySets.size} variants: ${[...uniqueToolKeySets].join(' | ')}`,
      );

      // Tool messages in V2 have 0 parts — tool_result updates the existing ToolPart in the assistant message
      // The tool part lives in the assistant message that created the tool_call
      for (const tm of toolMessages) {
        assert(
          tm.parts.length === 0,
          `Tool message should have 0 parts in V2 (tool state is in assistant msg), got ${tm.parts.length}`,
        );
      }
      console.log(
        `  [Phase 4b] Tool messages: ${toolMessages.length} msgs, all with 0 parts (V2 pattern)`,
      );

      // Instead, verify tool parts are in the assistant messages
      const asstWithToolParts = asstMessages.filter((m) => m.parts.some((p) => p.type === 'tool'));
      // Count how many turns had tool calls
      const turnsWithTools = new Set(allV2ToolCalls.map((tc) => tc.turnIndex));
      assert(
        asstWithToolParts.length === turnsWithTools.size,
        `${turnsWithTools.size} assistant messages should have tool parts, got ${asstWithToolParts.length}`,
      );
      for (const am of asstWithToolParts) {
        const toolParts = am.parts.filter((p) => p.type === 'tool');
        assert(
          toolParts.length >= 1,
          `Assistant message should have at least 1 tool part, got ${toolParts.length}`,
        );
      }
      const toolPartKeySets = asstWithToolParts.map((m) => {
        const tp = m.parts.find((p) => p.type === 'tool')!;
        return Object.keys(tp).sort().join(',');
      });
      const uniqueToolPartKeySets = new Set(toolPartKeySets);
      console.log(
        `  [Phase 4b] Tool part keys (in asst msgs): ${[...uniqueToolPartKeySets].join(' | ')} (${uniqueToolPartKeySets.size} variant(s))`,
      );
      assert(
        uniqueToolPartKeySets.size === 1,
        `All tool parts should share the same structure, got ${uniqueToolPartKeySets.size} variants`,
      );

      // Verify specific fields exist for each role
      const firstUserInfo = userMessages[0]!.info;
      assert(
        'id' in firstUserInfo &&
          'sessionID' in firstUserInfo &&
          'role' in firstUserInfo &&
          'time' in firstUserInfo,
        'UserMessage should have id, sessionID, role, time fields',
      );

      const firstAsstInfo = asstMessages[0]!.info;
      assert(
        'id' in firstAsstInfo &&
          'sessionID' in firstAsstInfo &&
          'role' in firstAsstInfo &&
          'time' in firstAsstInfo,
        'AssistantMessage should have id, sessionID, role, time fields',
      );
      assert(
        'cost' in firstAsstInfo && 'tokens' in firstAsstInfo,
        'AssistantMessage should have cost and tokens fields (user messages should not)',
      );
      assert(
        !('cost' in firstUserInfo) && !('tokens' in firstUserInfo),
        'UserMessage should NOT have cost/tokens fields',
      );
      console.log(
        `  [Phase 4b] User fields: {${Object.keys(firstUserInfo).sort().join(', ')}} — no cost/tokens`,
      );
      console.log(
        `  [Phase 4b] Asst fields: {${Object.keys(firstAsstInfo).sort().join(', ')}} — has cost+tokens`,
      );

      // Verify time.created is a number and monotonically increasing
      for (let i = 1; i < history.length; i += 1) {
        const prev = history[i - 1]!.info.time.created;
        const curr = history[i]!.info.time.created;
        assert(
          curr >= prev,
          `Message time.created should be monotonically increasing: msg[${i - 1}]=${prev} > msg[${i}]=${curr}`,
        );
      }
      console.log(
        `  [Phase 4b] Time monotonic: ✓ ${history[0]!.info.time.created} → ${history[history.length - 1]!.info.time.created}`,
      );

      // Verify text part.text is always a string for user/assistant messages
      for (const msg of [...userMessages, ...asstMessages]) {
        const textPart = msg.parts.find((p) => p.type === 'text');
        assert(textPart !== undefined, `Message ${msg.info.id} should have a text part`);
        assert(
          typeof textPart.text === 'string',
          `TextPart.text should be string, got ${typeof textPart.text}`,
        );
      }

      // ─── Phase 5: Per-turn history consistency (no data drift) ───

      const v2History = reconstructHistory(sessionId, userId);
      console.log(`  [Phase 5] Reconstructed ${v2History.length} history entries from V2 DB`);
      console.log(`  [Phase 5] Roles sequence: ${v2History.map((e) => e.role.charAt(0)).join('')}`);
      console.log(
        `  [Phase 5] Expected roles:  ${expectedHistory.map((e) => e.role.charAt(0)).join('')}`,
      );

      for (const snap of historySnapshots) {
        const v2Slice = v2History.slice(0, snap.history.length);
        assert(
          v2Slice.length === snap.history.length,
          `Turn ${snap.turn}: history length should match (expected ${snap.history.length}, got ${v2Slice.length})`,
        );
        for (let i = 0; i < snap.history.length; i += 1) {
          const orig = snap.history[i] ?? { role: '', content: '' };
          const fromDb = v2Slice[i] ?? { role: '', content: '' };
          assert(
            orig.role === fromDb.role,
            `Turn ${snap.turn} msg[${i}]: role should match ("${orig.role}" vs "${fromDb.role}")`,
          );
          assert(
            orig.content === fromDb.content,
            `Turn ${snap.turn} msg[${i}]: content should match exactly (no data drift)`,
          );
        }
      }
      console.log(`  [Phase 5] ${historySnapshots.length} turn snapshots verified — no data drift`);

      // Final history should match completely
      const finalFromDb = v2History.slice(0, expectedHistory.length);
      assert(
        finalFromDb.length === expectedHistory.length,
        `Final history length should match (${finalFromDb.length} vs ${expectedHistory.length})`,
      );
      for (let i = 0; i < expectedHistory.length; i += 1) {
        assert(
          expectedHistory[i]?.role === finalFromDb[i]?.role &&
            expectedHistory[i]?.content === finalFromDb[i]?.content,
          `Final msg[${i}]: content should match exactly`,
        );
      }

      // ─── Phase 5b: Content verification — print and verify each message ───

      console.log(`  [Phase 5b] Verifying conversation content (${v2History.length} messages):`);
      for (let i = 0; i < v2History.length; i += 1) {
        const entry = v2History[i]!;
        const turnNum = Math.floor(i / 2) + 1;
        const isUser = entry.role === 'user';
        const label = isUser ? `Turn ${turnNum} user` : `Turn ${turnNum} asst`;
        const preview =
          entry.content.length > 50 ? `${entry.content.slice(0, 50)}…` : entry.content;
        console.log(`    [${i}] ${label}: "${preview}"`);

        // Verify against expected content
        const expected = expectedHistory[i];
        assert(
          entry.role === expected?.role,
          `msg[${i}] role mismatch: expected "${expected?.role}", got "${entry.role}"`,
        );
        assert(
          entry.content === expected?.content,
          `msg[${i}] content mismatch:\n    expected: "${expected?.content}"\n    got:      "${entry.content}"`,
        );
      }

      // Cross-check: every USER_TURNS entry must appear in the reconstructed history user messages
      const v2UserEntries = v2History.filter((e) => e.role === 'user');
      for (let t = 0; t < USER_TURNS.length; t += 1) {
        assert(
          v2UserEntries[t]?.content === USER_TURNS[t],
          `Turn ${t + 1} user content should match USER_TURNS[${t}], got "${v2UserEntries[t]?.content}"`,
        );
      }
      console.log(
        `  [Phase 5b] All ${USER_TURNS.length} turns content verified against original input`,
      );

      // ─── Phase 6: toModelMessages produces valid upstream format ───

      const uiMessages = toModelMessages(history);
      // toModelMessages skips tool-role messages but includes assistant messages with tool parts
      const expectedUIMessageCount = USER_TURNS.length + asstMessages.length;
      assert(
        uiMessages.length === expectedUIMessageCount,
        `toModelMessages should produce ${expectedUIMessageCount} UIMessages, got ${uiMessages.length}`,
      );
      // Verify roles — user messages should be user, assistant should be assistant
      // (Not strictly alternating since tool messages are skipped)
      const uiUserMsgs = uiMessages.filter((m) => m.role === 'user');
      const uiAsstMsgs = uiMessages.filter((m) => m.role === 'assistant');
      assert(
        uiUserMsgs.length === USER_TURNS.length,
        `toModelMessages should have ${USER_TURNS.length} user UIMessages, got ${uiUserMsgs.length}`,
      );
      assert(
        uiAsstMsgs.length === asstMessages.length,
        `toModelMessages should have ${asstMessages.length} assistant UIMessages, got ${uiAsstMsgs.length}`,
      );
      // Verify first user message content matches
      const firstUserPart = uiMessages[0]?.parts.find((p) => p.type === 'text');
      assert(
        firstUserPart?.text === USER_TURNS[0],
        `First UIMessage text should match original user input`,
      );

      // ─── Phase 6b: toModelMessages structural consistency ───
      // Verify same-role UIMessages have identical part structure across all turns

      const userUIMessages = uiMessages.filter((m) => m.role === 'user');
      const asstUIMessages = uiMessages.filter((m) => m.role === 'assistant');

      // User UIMessages: all should have exactly 1 text part
      for (const uim of userUIMessages) {
        assert(
          uim.parts.length === 1,
          `User UIMessage should have exactly 1 part, got ${uim.parts.length}`,
        );
        assert(uim.parts[0]?.type === 'text', `User UIMessage part should be text type`);
      }
      const userUIPartKeySets = userUIMessages.map((m) =>
        Object.keys(m.parts[0]!).sort().join(','),
      );
      const uniqueUserUIPartKeySets = new Set(userUIPartKeySets);
      assert(
        uniqueUserUIPartKeySets.size === 1,
        `All user UIMessage parts should share the same structure, got ${uniqueUserUIPartKeySets.size} variants: ${[...uniqueUserUIPartKeySets].join(' | ')}`,
      );

      // Assistant UIMessages: text-only ones have 1 part, tool-call ones have text+tool parts
      const asstTextOnlyUI = asstUIMessages.filter((m) => m.parts.every((p) => p.type === 'text'));
      const asstWithToolUI = asstUIMessages.filter((m) => m.parts.some((p) => p.type !== 'text'));
      console.log(
        `  [Phase 6b] Asst UIMessages: ${asstTextOnlyUI.length} text-only, ${asstWithToolUI.length} with tool parts`,
      );

      // Text-only assistant UIMessages should have exactly 1 text part
      for (const uim of asstTextOnlyUI) {
        assert(
          uim.parts.length === 1,
          `Text-only assistant UIMessage should have exactly 1 part, got ${uim.parts.length}`,
        );
        assert(
          uim.parts[0]?.type === 'text',
          `Text-only assistant UIMessage part should be text type`,
        );
      }

      // Tool-call assistant UIMessages should have text + tool parts
      for (const uim of asstWithToolUI) {
        const textParts = uim.parts.filter((p) => p.type === 'text');
        const toolParts = uim.parts.filter(
          (p) => p.type !== 'text' && p.type !== 'providerMetadata',
        );
        assert(textParts.length >= 1, `Tool assistant UIMessage should have at least 1 text part`);
        assert(
          toolParts.length >= 1,
          `Tool assistant UIMessage should have at least 1 tool part, got types: ${uim.parts.map((p) => p.type).join(',')}`,
        );
      }

      // UIMessage top-level keys should be consistent per role
      const userUITopKeys = userUIMessages.map((m) => Object.keys(m).sort().join(','));
      const uniqueUserUITopKeys = new Set(userUITopKeys);
      assert(
        uniqueUserUITopKeys.size === 1,
        `All user UIMessages should share the same top-level structure, got ${uniqueUserUITopKeys.size} variants`,
      );

      const asstUITopKeys = asstUIMessages.map((m) => Object.keys(m).sort().join(','));
      const uniqueAsstUITopKeys = new Set(asstUITopKeys);
      assert(
        uniqueAsstUITopKeys.size === 1,
        `All assistant UIMessages should share the same top-level structure, got ${uniqueAsstUITopKeys.size} variants`,
      );

      console.log(
        `  [Phase 6b] UIMessage user  top-level: ${[...uniqueUserUITopKeys].join(' | ')} — part keys: ${[...uniqueUserUIPartKeySets].join(' | ')}`,
      );
      console.log(
        `  [Phase 6b] UIMessage asst  top-level: ${[...uniqueAsstUITopKeys].join(' | ')} — ${asstTextOnlyUI.length} text-only, ${asstWithToolUI.length} with tool`,
      );

      // ─── Phase 7: Individual read API verification ───

      const messages = listMessages({ sessionId, userId, limit: 200 });
      for (const msg of messages) {
        // getMessage
        const retrieved = getMessage({ sessionId, messageId: msg.id });
        assert(retrieved !== undefined, `getMessage should find message ${msg.id}`);
        assert(retrieved.id === msg.id, `getMessage id should match`);
        assert(retrieved.role === msg.role, `getMessage role should match`);

        // listPartsForMessage
        const parts = listPartsForMessage({ sessionId, messageId: msg.id });
        // Tool messages have 0 parts in V2 (tool state lives in assistant message's ToolPart)
        if (msg.role === 'tool') {
          assert(
            parts.length === 0,
            `Tool message ${msg.id} should have 0 parts in V2, got ${parts.length}`,
          );
          continue;
        }
        assert(
          parts.length >= 1,
          `message ${msg.id} should have at least 1 part, got ${parts.length}`,
        );

        // getPart — verify each part is retrievable
        for (const p of parts) {
          const part = getPart({ sessionId, messageId: msg.id, partId: p.id });
          assert(part !== undefined, `getPart should find part ${p.id}`);
          assert(
            part.type === p.type,
            `getPart type should match: expected ${p.type}, got ${part.type}`,
          );
        }

        // getMessageWithParts
        const msgWithParts = getMessageWithParts({ sessionID: sessionId, messageID: msg.id });
        assert(msgWithParts !== null, `getMessageWithParts should find message ${msg.id}`);
        assert(
          msgWithParts.parts.length === parts.length,
          `getMessageWithParts should have ${parts.length} parts, got ${msgWithParts.parts.length}`,
        );
      }

      // ─── Phase 8: filterCompacted ───

      const filtered = filterCompacted(history);
      assert(
        filtered.length === history.length,
        `filterCompacted should not remove any messages (no compaction in this test)`,
      );

      // ─── Phase 9: Snapshot/Patch parts via production adapter ───

      // Find an assistant message to attach snapshot/patch
      const asstMessage = messages.find((m) => m.role === 'assistant');
      assert(asstMessage !== undefined, 'should have an assistant message for snapshot test');

      const snapshotRef = `req:deep-conv-step-${randomUUID()}`;
      appendSnapshotPart({
        sessionId,
        messageId: asstMessage.id,
        snapshotRef,
      });
      appendPatchPart({
        sessionId,
        messageId: asstMessage.id,
        hash: snapshotRef,
        files: ['/src/config.ts', '/src/utils.ts'],
      });

      // Verify snapshot/patch via production read
      const asstParts = listPartsForMessage({ sessionId, messageId: asstMessage.id });
      const snapPart = asstParts.find((p) => p.type === 'snapshot');
      const patchPart = asstParts.find((p) => p.type === 'patch');
      assert(snapPart !== undefined, 'snapshot part should exist after appendSnapshotPart');
      assert(patchPart !== undefined, 'patch part should exist after appendPatchPart');
      assert(
        'snapshot' in snapPart && snapPart.snapshot === snapshotRef,
        'snapshot ref should match',
      );
      assert('files' in patchPart && patchPart.files.length === 2, 'patch should have 2 files');

      // ─── Phase 10: Event log integrity ───

      const replayedEvents = replayEventsForAggregate(sessionId);
      // Events:
      //   1 session.created
      //   turns 1-4: 4 turns * 4 events (user msg + user part + asst msg + asst part) = 16
      //   turn 5: user msg + user part + asst msg(text+tool part) + tool msg(tool part updated) +
      //           asst msg(text+tool part) + transitionToRunning(part updated) + tool msg(tool part updated) +
      //           asst msg(text+tool part) + tool msg(tool part updated)
      //   turns 6-11: 6 turns * 4 events = 24
      //   + 2 snapshot/patch parts
      // Total: 1 + 16 + (1+1+1+2+1+1+1+2+1+1+2+1) + 24 + 2 = need to count carefully
      // Simpler: just count actual events and verify key properties
      assert(replayedEvents.length > 0, 'event log should not be empty');
      assert(
        replayedEvents[0]?.type === 'session.created',
        'event stream should start with session.created',
      );
      const msgCreatedEvents = replayedEvents.filter(
        (e: { type: string }) => e.type === 'message.created',
      );
      const partCreatedEvents = replayedEvents.filter(
        (e: { type: string }) => e.type === 'message.part.created',
      );
      const partUpdatedEvents = replayedEvents.filter(
        (e: { type: string }) => e.type === 'message.part.updated',
      );
      console.log(
        `  [Phase 10] Events: ${replayedEvents.length} total — ${msgCreatedEvents.length} msg.created, ${partCreatedEvents.length} part.created, ${partUpdatedEvents.length} part.updated`,
      );
      assert(
        msgCreatedEvents.length === expectedMessageCount,
        `Should have ${expectedMessageCount} message.created events, got ${msgCreatedEvents.length}`,
      );
      assert(
        partCreatedEvents.length >= expectedPartCount,
        `Should have at least ${expectedPartCount} part.created events, got ${partCreatedEvents.length}`,
      );
      // Tool state transitions produce part.updated events (one per tool_result)
      assert(
        partUpdatedEvents.length >= allV2ToolCalls.length,
        `Tool transitions should produce at least ${allV2ToolCalls.length} part.updated events, got ${partUpdatedEvents.length}`,
      );

      // ─── Phase 11: Tool-specific verification via production APIs ───

      // findToolPartByCallID — verify each tool call from the agentic flow
      for (let ti = 0; ti < allV2ToolCalls.length; ti += 1) {
        const tc = allV2ToolCalls[ti]!;
        const toolPart = findToolPartByCallID({ sessionId, callID: tc.callId });
        assert(
          toolPart !== undefined,
          `findToolPartByCallID should find tool part for ${tc.callId}`,
        );
        assert(toolPart.type === 'tool', `Found part should be tool type`);
        assert(
          toolPart.tool === tc.toolName,
          `Tool name should be ${tc.toolName}, got ${toolPart.tool}`,
        );
        const expectedStatus = tc.isError ? 'error' : 'completed';
        assert(
          toolPart.state.status === expectedStatus,
          `Tool ${ti + 1} should be ${expectedStatus}, got ${toolPart.state.status}`,
        );
        console.log(
          `  [Phase 11] Tool ${ti + 1} (${tc.toolName}): status=${toolPart.state.status}, callID=${tc.callId.slice(0, 24)}…`,
        );

        // Verify tool output/error matches
        if (tc.isError) {
          const errored = toolPart.state as ToolStateError;
          assert(errored.error === tc.result, `Tool ${ti + 1} error should match`);
          console.log(`  [Phase 11] Tool ${ti + 1} error: "${errored.error.slice(0, 80)}"`);
        } else {
          const completed = toolPart.state as ToolStateCompleted;
          assert(completed.output === tc.result, `Tool ${ti + 1} output should match`);
          console.log(`  [Phase 11] Tool ${ti + 1} output: "${completed.output.slice(0, 80)}"`);
        }
      }

      // Verify tool parts in V1 transcript bridge
      const toolTranscriptEntries = transcript.filter((m: { content: Array<{ type: string }> }) =>
        m.content.some((c: { type: string }) => c.type === 'tool_call' || c.type === 'tool_result'),
      );
      assert(
        toolTranscriptEntries.length >= allV2ToolCalls.length,
        `V1 transcript should have at least ${allV2ToolCalls.length} entries with tool content, got ${toolTranscriptEntries.length}`,
      );
      console.log(`  [Phase 11] V1 transcript tool entries: ${toolTranscriptEntries.length}`);
      console.log(`  [Phase 11] Total agentic tool calls verified: ${allV2ToolCalls.length}`);

      console.log('verify-message-v2-deep-conversation: ok');
    } finally {
      await closeDb();
    }
  });
}

void main().catch((error) => {
  console.error('verify-message-v2-deep-conversation: failed');
  console.error(error);
  process.exitCode = 1;
});
