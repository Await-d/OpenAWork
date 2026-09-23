/**
 * 子代理工具名的**前端单一事实来源**。
 *
 * 与网关 `services/agent-gateway/src/task/task-tools.ts` 的运行期判定
 * （`TASK_TOOL_NAME` / `TASK_TOOL_LEGACY_NAME`）保持同一语义，并覆盖前端
 * 需要识别的历史名与上游兼容名：
 *
 * - `subagent`：规范名（对齐上游 opencode）
 * - `task`：历史别名（存量会话 / 历史 tool_call 仍在用）
 * - `agent`：Claude Code / OpenAI functions 的呈现名
 * - `call_omo_agent`：内置子代理直调（同步 / 后台）
 * - `delegate_task`：编排器委派
 *
 * 判定与提取逻辑集中在此处，避免「消息流路由 / 右栏工具面板 / shared-ui
 * 卡片解析」各自维护一份名单后互相漂移（历史缺陷：`subagent`、`call_omo_agent`
 * 在部分入口不被识别为子代理卡片，点击无法打开预览）。
 */
export const SUBAGENT_TOOL_NAMES = [
  'subagent',
  'task',
  'agent',
  'call_omo_agent',
  'delegate_task',
] as const;

export type SubagentToolName = (typeof SUBAGENT_TOOL_NAMES)[number];

const SUBAGENT_TOOL_NAME_SET: ReadonlySet<string> = new Set(SUBAGENT_TOOL_NAMES);

/** 是否为子代理工具（大小写 / 空白不敏感）。 */
export function isSubagentToolName(toolName: string): boolean {
  return SUBAGENT_TOOL_NAME_SET.has(toolName.trim().toLowerCase());
}

/**
 * 子会话 id 的文本形态模式。
 *
 * 网关对同步 / 后台子代理的输出是**文本**（`z.string()`），常见形态：
 * - 同步：`<subagent sessionID="ses_x" state="completed">…</subagent>`
 * - 后台：`会话 ID：ses_x`
 * - 兼容 JSON 文本：`"sessionID":"ses_x"` / `"sessionId":"ses_x"`
 */
const SESSION_ID_TEXT_PATTERNS: readonly RegExp[] = [
  /<subagent\b[^>]*\bsessionID\s*=\s*"([^"]+)"/i,
  /<subagent\b[^>]*\bsessionID\s*=\s*'([^']+)'/i,
  /"sessionID"\s*:\s*"([^"]+)"/i,
  /"sessionId"\s*:\s*"([^"]+)"/i,
  /会话\s*ID\s*[：:]\s*([A-Za-z0-9_.:-]+)/,
];

/** 从自由文本中提取子会话 id；提取不到返回 `undefined`。 */
export function extractSubagentSessionIdFromText(text: string): string | undefined {
  for (const pattern of SESSION_ID_TEXT_PATTERNS) {
    const candidate = pattern.exec(text)?.[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * 从对象记录里读取子会话 id（覆盖 `sessionId` / `session_id` / `sessionID` 三种键名）。
 */
function readSessionIdFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of ['sessionId', 'session_id', 'sessionID'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

/**
 * 从工具结果（对象或文本）中解析子会话 id。
 *
 * 文本形态覆盖网关的两种子代理输出（`<subagent sessionID="…">` 包裹 /
 * 「会话 ID：…」行）以及**历史消息里被 JSON.stringify 存储的对象输出**
 * （与 `ToolCallCard` 的 diff envelope 恢复同一场景）。
 */
export function resolveSubagentSessionIdFromToolOutput(output: unknown): string | undefined {
  if (typeof output === 'string') {
    const direct = extractSubagentSessionIdFromText(output);
    if (direct) {
      return direct;
    }

    const trimmed = output.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return readSessionIdFromRecord(parsed as Record<string, unknown>);
        }
      } catch {
        // 非法 JSON 文本：没有可恢复的对象结构，按「无子会话 id」处理。
      }
    }

    return undefined;
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return readSessionIdFromRecord(output as Record<string, unknown>);
  }

  return undefined;
}
