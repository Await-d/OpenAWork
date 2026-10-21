/**
 * 待处理问题请求的字段归一化。
 *
 * ## 为什么需要单独一个模块
 *
 * 工具入参里多选标记叫 **`multiSelect`**（见 `AskUserQuestion` 的 `questions[]`，
 * 契约在 `services/agent-gateway/src/tools/question-tools.ts` 的 zod schema），网关把
 * `question_requests.questions_json` 按原始 JSON **原样透传**；而前端模型
 * `PendingQuestionItem` 上的字段名是 **`multiple`**。两者谁也不认识谁。
 *
 * 后果：前端一律按单选渲染与提交，用户却能在题干里看到「可多选」——勾第二个选项时
 * 第一个被顶掉、提交后回显只留一项，看起来就是「多选展示不对」。
 *
 * ## 为什么必须被**所有**读取路径调用
 *
 * `pendingQuestions` 由四条互不知情的链路写入：`listPending`（流式事件回拉）、
 * `/status`（3s 轮询）、`/recovery`（切会话）、共享会话详情。任何一条漏掉归一化，
 * 它写回的原始条目都会覆盖掉已归一化的那份（`preserveEqualList` 深比较不相等 →
 * 替换），表现为「刚打开是可多选、几秒后又变回单选」。因此归一化放在 web-client
 * 的**每个**出参边界上，而不是散落在各调用方。
 *
 * ## 为什么独立成文件而不是留在 `questions.ts`
 *
 * `sessions.ts` 的 `getStatus` / `getRecovery` / `getSharedWithMe` 都要用它，而
 * `questions.ts` 已经依赖 `sessions.js` 的 `HttpError`——放同一文件会形成运行时
 * 循环导入。本模块只做纯函数转换，不依赖任何同包运行时模块（对
 * `./questions.js` 的引用是 `import type`，编译后被擦除），因此可以被两边安全共享。
 */
import type {
  PendingQuestionItem,
  PendingQuestionOption,
  PendingQuestionRequest,
} from './questions.js';

/**
 * 归一化单个问题项的多选标记，两种字段名都认。
 *
 * 顺带兼容字符串形式的布尔值：模型经 JSON 往返时可能出现 `"true"` / `"false"`。
 * 未声明时返回 `undefined`（调用方一律按 `=== true` 判定，等价于单选），
 * 而不是 `false`——保住「没声明」与「显式声明单选」的区分，便于排查。
 *
 * `multiple` 排在 `multiSelect` 前面：本函数会被多条读取路径重复调用，先读
 * 已归一化过的 `multiple` 才能保证幂等（两者同时存在时它一定是上一轮的产物）。
 */
function toQuestionMultiple(raw: Record<string, unknown>): boolean | undefined {
  for (const candidate of [raw['multiple'], raw['multiSelect']]) {
    if (typeof candidate === 'boolean') {
      return candidate;
    }
    if (candidate === 'true') {
      return true;
    }
    if (candidate === 'false') {
      return false;
    }
  }
  return undefined;
}

function normalizePendingQuestionItem(raw: unknown): PendingQuestionItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const options = Array.isArray(record['options']) ? record['options'] : [];
  const multiple = toQuestionMultiple(record);
  return {
    header: typeof record['header'] === 'string' ? record['header'] : '',
    ...(multiple === undefined ? {} : { multiple }),
    options: options as PendingQuestionOption[],
    question: typeof record['question'] === 'string' ? record['question'] : '',
    ...(typeof record['nodeId'] === 'string' ? { nodeId: record['nodeId'] } : {}),
    ...(typeof record['round'] === 'number' ? { round: record['round'] } : {}),
  };
}

/**
 * 归一化整个待处理问题请求（补齐 `multiple`，剔除结构异常的问题项）。
 *
 * 非对象输入返回 `null`，让调用方能区分「这一条不该渲染」与「渲染出来是空壳」。
 */
export function normalizePendingQuestionRequest(raw: unknown): PendingQuestionRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const questionsRaw = Array.isArray(record['questions']) ? record['questions'] : [];
  const questions = questionsRaw
    .map((item) => normalizePendingQuestionItem(item))
    .filter((item): item is PendingQuestionItem => item !== null);
  return {
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : '',
    questions,
    requestId: typeof record['requestId'] === 'string' ? record['requestId'] : '',
    sessionId: typeof record['sessionId'] === 'string' ? record['sessionId'] : '',
    status:
      record['status'] === 'answered' || record['status'] === 'dismissed'
        ? record['status']
        : 'pending',
    title: typeof record['title'] === 'string' ? record['title'] : '',
    toolName: typeof record['toolName'] === 'string' ? record['toolName'] : '',
  };
}

/**
 * 批量归一化：网关所有返回 `PendingQuestionRequest[]` 的端点共用这一个出口。
 *
 * `undefined` / 非数组输入返回空数组——这些端点在上游拿不到数据时给的就是缺省值，
 * 交给调用方再判一次空没有意义。
 */
export function normalizePendingQuestionRequests(value: unknown): PendingQuestionRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizePendingQuestionRequest(item))
    .filter((item): item is PendingQuestionRequest => item !== null);
}
