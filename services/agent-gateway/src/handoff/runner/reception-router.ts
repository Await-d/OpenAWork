/**
 * 260518 · L1.2 b.router 实现
 *
 * b 层拆分为 router + companion + scheduler（L1.2.2）。
 * 本模块是 b.router：意图识别（直答 / 走 c / 续接 / 紧急直派）+ 路由决策。
 *
 * 路由策略（规则快速预筛 + LLM 上下文感知判断）：
 *   1. 规则预筛：只处理确定性场景（问候/致谢 → direct，空输入/极短 → clarify）
 *   2. LLM 判断：其余输入交给 LLM，LLM 同时看到用户输入和历史任务上下文，
 *      判断是 RESUME（续接上次任务）/ ORCHESTRATE（新任务）/ DIRECT / CLARIFY
 *
 * 路由结果：
 *   - 'direct'：极少数前台承接类消息（问候 / 致谢 / 简短状态确认），b 层直接答
 *   - 'resume'：用户意图是续接上次未完成任务，不需要 PM1 重新规划
 *   - 'orchestrate'：默认路径，大多数问题 / 需求都走 c→d→e/f/g 链路
 *   - 'clarify'：意图不清，b.companion 追问用户
 *
 * 强制约束（L1.2.3）：
 *   - 每次路由决策必须可被 audit log 解释
 *   - decision_source: 'rule' | 'llm'
 */

export type RouteDecision = 'direct' | 'orchestrate' | 'clarify' | 'resume';

export interface RouteResult {
  decision: RouteDecision;
  /** 决策来源：规则代码 or LLM 兜底 */
  decisionSource: 'rule' | 'llm';
  /** 人类可读的决策理由（写入 audit log） */
  reason: string;
  clarifyKind?: 'empty' | 'too_short' | 'ambiguous';
  /** LLM 分类的原始输出（仅 decisionSource='llm' 时有值） */
  llmRawOutput?: string;
}

// ─── 规则引擎（优先级高于 LLM） ─────────────────────────────────────────────

/**
 * 直答关键词：仅保留真正适合前台当场承接的超轻量消息。
 * 团队模式下，知识问答 / 技术解释 / 检索 / 对比 / “怎么做” 一律优先升级给下游层。
 */
const DIRECT_ANSWER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^(你好|hi|hello|hey|嗨|早上好|晚上好|下午好)/i, reason: '问候语' },
  { pattern: /^(谢谢|感谢|thanks|thank you)/i, reason: '感谢语' },
  { pattern: /^(收到|好的|好嘞|ok|okay|明白了|在吗)[!！。?？\s]*$/i, reason: '简短确认' },
  { pattern: /^(那个|之前的|上次|刚才).*(怎么样|进度|状态)/i, reason: '进度查询' },
];

/** 编排关键词：匹配到这些模式的输入走 c→d→e 链路 */
const ORCHESTRATE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /^(什么是|解释一下|告诉我|介绍|说说|怎么|如何|how to|how do|为什么|why|原因|对比|区别|difference|vs|比较|帮我查|查一下|搜索|找一下|look up|分析|评估)/i,
    reason: '需要分析/检索/解释的提问',
  },
  {
    pattern: /(吗|么|呢|？|\?)/i,
    reason: '团队模式下的实质性提问默认升级处理',
  },
  { pattern: /(实现|开发|编写|创建|构建|build|implement|create|develop)/i, reason: '开发任务' },
  { pattern: /(修复|fix|bug|修|解决.*问题|repair)/i, reason: '修复任务' },
  { pattern: /(重构|refactor|优化.*代码|改进.*架构)/i, reason: '重构任务' },
  { pattern: /(添加|新增|加上|add|增加.*功能)/i, reason: '功能新增' },
  { pattern: /(删除|移除|remove|去掉|清理)/i, reason: '删除/清理任务' },
  { pattern: /(测试|test|单元测试|集成测试|写.*测试)/i, reason: '测试任务' },
  { pattern: /(部署|deploy|上线|发布|release)/i, reason: '部署任务' },
  { pattern: /(迁移|migrate|升级.*版本|migration)/i, reason: '迁移任务' },
  { pattern: /(设计|design|架构.*设计|方案)/i, reason: '设计任务' },
  // 操作指令类：执行 / 运行 / 开始 / 启动 / 停止 / 暂停 / 重试 等
  // 注意：不含"重新来"/"再试"/"重做"/"redo"等——这些归"重新执行指令"模式
  {
    pattern:
      /^(执行|运行|跑一下|跑|开始|启动|停止|暂停|重试|再试一次|再来一次|重启|restart|run|start|stop|pause|retry)/i,
    reason: '操作指令',
  },
  // 撤销 / 回退类
  {
    pattern: /^(撤销|回退|撤回|undo|取消上次)/i,
    reason: '撤销/回退指令',
  },
  // 确认类（短输入中的"是 / 对 / 可以 / 行 / 没问题"等，在有上下文时表示同意执行）
  {
    pattern: /^(是|对的|对|可以|行|没问题|确认|同意|yes|yeah|yep|ok go|do it|确认执行)/i,
    reason: '确认执行',
  },
  // 否定类（"不是 / 不对 / 不行 / 算了"等，需要团队理解并调整方向）
  {
    pattern: /^(不是|不对|不行|不可以|算了|取消|不要|别|no|nope|cancel|abort)/i,
    reason: '否定/取消指令',
  },
  // 指代+动作类："这个改一下" "那个看看" "上面那个" 等——虽短但有动作意图
  {
    pattern:
      /^(这个|那个|上面|下面|之前|刚才|上次).*(看|改|修|调|查|做|弄|处理|搞|弄一下|改一下|调一下)/i,
    reason: '指代+动作指令',
  },
  // 重新/重做/再来类（含 redo，语义上更接近"重做"而非"撤销"）
  {
    pattern: /^(重新|再来|再试|重做|重新来|重新做|重新开始|redo|try again)/i,
    reason: '重新执行指令',
  },
];

/** 澄清信号：输入太短或太模糊 */
const MIN_ORCHESTRATE_LENGTH = 8;
/**
 * 极短阈值：低于此长度且不匹配任何模式时，直接判 clarify（不浪费 LLM 调用）。
 * 1 字符输入（如"嗯"、"啊"）几乎无法通过 LLM 判断意图。
 */
const MIN_LLM_FALLBACK_LENGTH = 2;

/**
 * 规则引擎路由判断（快速预筛）。
 * 返回 null 表示规则无法确定，需要 LLM 做上下文感知判断。
 *
 * 规则只处理确定性场景：
 *   - 空输入 / 极短无意义 → clarify
 *   - 问候 / 致谢 / 简短确认 → direct
 * 其余所有输入（包括"继续"、开发任务、提问等）都返回 null 交给 LLM，
 * 因为是否需要续接上次任务取决于历史上下文，纯关键词无法判断。
 *
 * Fix #6: orchestrate 模式优先级高于 direct。
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
      clarifyKind: 'empty',
    };
  }

  // 太短 → 先尝试匹配直答模式
  if (trimmed.length < MIN_ORCHESTRATE_LENGTH) {
    // 检查直答模式
    for (const { pattern, reason } of DIRECT_ANSWER_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { decision: 'direct', decisionSource: 'rule', reason };
      }
    }
    // 极短输入（≤1 字符）且不匹配任何模式 → 直接 clarify，不浪费 LLM 调用
    if (trimmed.length <= MIN_LLM_FALLBACK_LENGTH - 1) {
      return {
        decision: 'clarify',
        decisionSource: 'rule',
        reason: `输入过短（${trimmed.length} 字符），无法判断意图`,
        clarifyKind: 'too_short',
      };
    }
    // 2~7 字符且不匹配直答模式 → 返回 null 交给 LLM 兜底判断
    // 短输入可能承载延续/确认/指代等隐含意图，LLM 结合上下文能做更准确判断
    return null;
  }

  // 长输入：先检查编排模式（优先级高于 direct）
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

  // 规则无法判断 → 交给 LLM
  return null;
}

// ─── LLM 上下文感知路由 ─────────────────────────────────────────────────────

/**
 * 传给 LLM 路由器的任务上下文摘要。
 * 由 reception-orchestrator 在调用前构建，让 LLM 能看到历史任务状态。
 */
export interface RouteLlmContext {
  /**
   * 上次任务的摘要信息。为 null 表示没有历史任务（首次对话或上次任务已全部完成）。
   * LLM 会据此判断用户是否想续接。
   */
  previousTaskSummary: string | null;
  /** 未完成任务数量（0 表示没有可续接的任务） */
  incompleteTaskCount: number;
}

function buildContextBlock(context: RouteLlmContext | null): string {
  if (!context) {
    return '（无历史任务上下文）';
  }
  if (context.incompleteTaskCount === 0 || !context.previousTaskSummary) {
    return '当前没有未完成的历史任务。';
  }
  return `当前有 ${context.incompleteTaskCount} 个未完成任务：\n${context.previousTaskSummary}`;
}

const ROUTER_CLASSIFICATION_PROMPT = `你是一个意图路由分类器。你需要根据用户输入**以及历史任务上下文**判断应该走哪条路径。

分类规则：
- RESUME：用户想继续、接着、恢复上次未完成的任务。判断依据不只是"继续"等关键词，而是结合用户输入和历史任务上下文综合判断。例如：历史有未完成任务 + 用户说"上次的那个弄完它"、"还有没搞定的继续吧"、"接着来" → RESUME。但如果历史有未完成任务 + 用户提出了一个全新的、与上次任务无关的需求 → ORCHESTRATE。如果用户输入明确指向"继续做上次的事"但历史没有未完成任务 → ORCHESTRATE（当作新需求处理）。
- DIRECT：只限问候、致谢、极简确认、简短进度确认。这类消息由接待层前台承接即可。
- ORCHESTRATE：默认选项。凡是需要解释、分析、检索、对比、基于项目上下文判断、给方案、做技术决策、写代码、修 bug、重构、部署、设计方案等，都交给团队下游层处理。新需求即使用户说了"继续"也走这里（因为与上次任务无关）。
- CLARIFY：仅限核心目标缺失、自相矛盾、缺少用户专属输入，且无法用合理默认假设继续。普通模糊点默认 ORCHESTRATE，由 PM1/PM2 代决策并记录假设

判断原则：
- 优先看历史上下文：有未完成任务 + 用户意图指向延续上次工作 → RESUME
- 用户输入与上次任务明显无关（即使包含"继续"等词）→ ORCHESTRATE
- 没有未完成任务时，即使匹配"继续"关键词 → ORCHESTRATE
- 短输入（如"继续"、"对"、"嗯"）需结合上下文判断
- 宁可 ORCHESTRATE 让团队下游处理，也不要轻易 CLARIFY 打断用户节奏

严格按以下格式输出一行：
DECISION: RESUME|DIRECT|ORCHESTRATE|CLARIFY
REASON: <一句话理由>`;

/**
 * LLM 上下文感知路由。当规则引擎无法判断时调用。
 * LLM 同时看到用户输入和历史任务上下文，能准确判断是否需要续接。
 * 如果 LLM 也失败，默认走 orchestrate（宁可多做不漏）。
 * 超时设为 8s：注入历史任务上下文后 prompt 变长，3s 经常不够用；
 * 路由分类是简单单次调用，8s 已足够，不会显著影响用户体验。
 */
export async function routeByLlm(
  userIntent: string,
  callLlm: (prompt: string) => Promise<string>,
  context?: RouteLlmContext | null,
): Promise<RouteResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const contextBlock = buildContextBlock(context ?? null);
    const fullPrompt = `${ROUTER_CLASSIFICATION_PROMPT}\n\n历史任务上下文：\n${contextBlock}\n\n用户输入：${userIntent}`;
    const output = await Promise.race([
      callLlm(fullPrompt),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error('router LLM timeout (8s)')),
        );
      }),
    ]);

    const decisionMatch = /DECISION:\s*(RESUME|DIRECT|ORCHESTRATE|CLARIFY)/i.exec(output);
    const reasonMatch = /REASON:\s*(.+)/i.exec(output);

    if (decisionMatch) {
      const raw = decisionMatch[1]!.toUpperCase();
      const decision: RouteDecision =
        raw === 'DIRECT'
          ? 'direct'
          : raw === 'CLARIFY'
            ? 'clarify'
            : raw === 'RESUME'
              ? 'resume'
              : 'orchestrate';
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
  } finally {
    clearTimeout(timeout);
  }
}
