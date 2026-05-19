/**
 * 260518 · L1.2 b.router 实现
 *
 * b 层拆分为 router + companion + scheduler（L1.2.2）。
 * 本模块是 b.router：意图识别（直答 / 走 c / 紧急直派）+ 路由决策。
 *
 * 路由规则（规则代码优先，LLM 兜底）：
 *   1. 规则判断：关键词 / 长度 / 格式匹配
 *   2. LLM 兜底：规则无法判断时调轻量 LLM 做分类
 *
 * 路由结果：
 *   - 'direct'：简单问题，b.companion 直接回答（走 stream）
 *   - 'orchestrate'：复杂任务，走 c→d→e/f/g 链路（走 orchestration）
 *   - 'clarify'：意图不清，b.companion 追问用户
 *
 * 强制约束（L1.2.3）：
 *   - 每次路由决策必须可被 audit log 解释
 *   - decision_source: 'rule' | 'llm'
 */

export type RouteDecision = 'direct' | 'orchestrate' | 'clarify';

export interface RouteResult {
  decision: RouteDecision;
  /** 决策来源：规则代码 or LLM 兜底 */
  decisionSource: 'rule' | 'llm';
  /** 人类可读的决策理由（写入 audit log） */
  reason: string;
  /** LLM 分类的原始输出（仅 decisionSource='llm' 时有值） */
  llmRawOutput?: string;
}

// ─── 规则引擎（优先级高于 LLM） ─────────────────────────────────────────────

/** 直答关键词：匹配到这些模式的输入直接由 companion 回答 */
const DIRECT_ANSWER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^(你好|hi|hello|hey|嗨|早上好|晚上好|下午好)/i, reason: '问候语' },
  { pattern: /^(谢谢|感谢|thanks|thank you)/i, reason: '感谢语' },
  { pattern: /^(什么是|解释一下|告诉我|介绍|说说)/i, reason: '知识查询' },
  { pattern: /^(怎么|如何|how to|how do)/i, reason: '操作指南查询' },
  { pattern: /^(为什么|why|原因)/i, reason: '原因解释查询' },
  { pattern: /^(对比|区别|difference|vs|比较)/i, reason: '对比分析查询' },
  { pattern: /^(那个|之前的|上次|刚才).*(怎么样|进度|状态)/i, reason: '进度查询' },
  { pattern: /^(帮我查|查一下|搜索|找一下|look up)/i, reason: '信息检索' },
];

/** 编排关键词：匹配到这些模式的输入走 c→d→e 链路 */
const ORCHESTRATE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(实现|开发|编写|创建|构建|build|implement|create|develop)/i, reason: '开发任务' },
  { pattern: /(修复|fix|bug|修|解决.*问题|repair)/i, reason: '修复任务' },
  { pattern: /(重构|refactor|优化.*代码|改进.*架构)/i, reason: '重构任务' },
  { pattern: /(添加|新增|加上|add|增加.*功能)/i, reason: '功能新增' },
  { pattern: /(删除|移除|remove|去掉|清理)/i, reason: '删除/清理任务' },
  { pattern: /(测试|test|单元测试|集成测试|写.*测试)/i, reason: '测试任务' },
  { pattern: /(部署|deploy|上线|发布|release)/i, reason: '部署任务' },
  { pattern: /(迁移|migrate|升级.*版本|migration)/i, reason: '迁移任务' },
  { pattern: /(设计|design|架构.*设计|方案)/i, reason: '设计任务' },
];

/** 澄清信号：输入太短或太模糊 */
const MIN_ORCHESTRATE_LENGTH = 8;

/**
 * 规则引擎路由判断。
 * 返回 null 表示规则无法判断，需要 LLM 兜底。
 *
 * Fix #6: orchestrate 模式优先级高于 direct。
 * 如果输入同时匹配 direct 和 orchestrate，以 orchestrate 为准。
 * 例如"我想问一下怎么实现 OAuth" 同时匹配"怎么"（direct）和"实现"（orchestrate），
 * 应该走 orchestrate。
 */
export function routeByRules(userIntent: string): RouteResult | null {
  const trimmed = userIntent.trim();

  // 空输入 → clarify
  if (trimmed.length === 0) {
    return {
      decision: 'clarify',
      decisionSource: 'rule',
      reason: '输入为空',
    };
  }

  // 太短且不匹配任何模式 → clarify
  if (trimmed.length < MIN_ORCHESTRATE_LENGTH) {
    // 先检查是否匹配直答模式
    for (const { pattern, reason } of DIRECT_ANSWER_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { decision: 'direct', decisionSource: 'rule', reason };
      }
    }
    return {
      decision: 'clarify',
      decisionSource: 'rule',
      reason: `输入过短（${trimmed.length} 字符），无法判断意图`,
    };
  }

  // Fix #6: 先检查编排模式（优先级更高）
  for (const { pattern, reason } of ORCHESTRATE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { decision: 'orchestrate', decisionSource: 'rule', reason };
    }
  }

  // 再检查直答模式
  for (const { pattern, reason } of DIRECT_ANSWER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { decision: 'direct', decisionSource: 'rule', reason };
    }
  }

  // 规则无法判断
  return null;
}

// ─── LLM 兜底分类 ────────────────────────────────────────────────────────────

const ROUTER_CLASSIFICATION_PROMPT = `你是一个意图路由分类器。根据用户输入判断应该走哪条路径。

分类规则：
- DIRECT：简单问题、知识查询、闲聊、状态查询——可以直接回答，不需要写代码或执行任务
- ORCHESTRATE：需要实际动手的任务（写代码、修 bug、重构、部署、设计方案等）
- CLARIFY：意图不清楚，需要追问用户才能判断

严格按以下格式输出一行：
DECISION: DIRECT|ORCHESTRATE|CLARIFY
REASON: <一句话理由>`;

/**
 * LLM 兜底路由。当规则引擎无法判断时调用。
 * 如果 LLM 也失败，默认走 orchestrate（宁可多做不漏）。
 * Fix #4: 加 3s 超时，避免无效 API key 导致长时间阻塞（L1.6 p95 < 2s）。
 */
export async function routeByLlm(
  userIntent: string,
  callLlm: (prompt: string) => Promise<string>,
): Promise<RouteResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const output = await Promise.race([
      callLlm(`${ROUTER_CLASSIFICATION_PROMPT}\n\n用户输入：${userIntent}`),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error('router LLM timeout (3s)')),
        );
      }),
    ]);
    clearTimeout(timeout);

    const decisionMatch = /DECISION:\s*(DIRECT|ORCHESTRATE|CLARIFY)/i.exec(output);
    const reasonMatch = /REASON:\s*(.+)/i.exec(output);

    if (decisionMatch) {
      const raw = decisionMatch[1]!.toUpperCase();
      const decision: RouteDecision =
        raw === 'DIRECT' ? 'direct' : raw === 'CLARIFY' ? 'clarify' : 'orchestrate';
      return {
        decision,
        decisionSource: 'llm',
        reason: reasonMatch?.[1]?.trim() ?? 'LLM 分类',
        llmRawOutput: output,
      };
    }

    // LLM 输出格式不对 → 默认 orchestrate
    return {
      decision: 'orchestrate',
      decisionSource: 'llm',
      reason: 'LLM 输出格式不匹配，默认走编排',
      llmRawOutput: output,
    };
  } catch (err) {
    // LLM 调用失败或超时 → 默认 orchestrate（宁可多做不漏）
    return {
      decision: 'orchestrate',
      decisionSource: 'llm',
      reason: `LLM 路由失败（${err instanceof Error ? err.message : 'unknown'}），默认走编排`,
    };
  }
}
