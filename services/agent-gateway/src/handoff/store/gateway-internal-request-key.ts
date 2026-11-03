/**
 * 网关内部后台流请求键的形状注册表（2026-11-03 从 handoff-store.ts 拆出）。
 *
 * 纯数据 + 纯函数：不触 DB、不依赖其它业务模块。handoff-store.ts 保留再导出，既有 import 不受影响。
 */

/**
 * 网关内部后台流请求键的形状注册表——实现与守卫测试共同消费的唯一事实来源。
 *
 * 每项声明一个保留前缀（`isGatewayInternalRequestKey` 按 startsWith 匹配）、一个
 * 代表性样例键（守卫测试断言其被拒绝）与形状来源。实现方的前缀集合由本表派生；
 * 新增网关内部请求键 builder 必须在此登记，否则守卫测试
 * （`verification/verify-team-turn-rollback-internal-keys.ts`）的源码扫描会失败。
 *
 * 这些键由网关自身生成，代表服务端发起的执行，不是用户在该会话发起的回合键：
 *   - `handoff:` / `pm1:` / `pm2:` / `pm2-return:` —— handoff runner 的重放 / 幂等键
 *     （pm1-runner / artifact-chain / pm2-runner / watcher）；
 *   - `reception:` / `reception-client:` —— reception-orchestrator 无显式用户键时的兜底键；
 *   - `team-resume:` —— 团队恢复后台运行的请求键（team-resume-context）；
 *   - `task:` / `task-job:` —— task 子代理请求键；`task-job:` 是单通道交付的合成通知身份
 *     （`task-job:<childSessionId>:<taskUpdatedAt>`，同时用作唤醒请求的幂等键）；
 *   - `task-reminder:` / `task-auto-resume:` / `task-parent-decision:` —— 父任务完成提醒、
 *     父会话自动续跑 / 决策请求。**前两者已无生产者**（旧「伪造用户请求 + 定时重试」机制随单通道交付退役），
 *     保留在此仅为**存量数据的只读兼容**：历史会话里这些 clientRequestId 仍需被识别为网关内部键。
 *     `task-parent-decision:` 仍在生产（子代理中途停顿时由父代理决策）；
 *   - `command:` / `command-card:` / `loop:` / `ulw-verify:` / `permission:` ——
 *     斜杠命令运行、命令卡片、命令循环、ULW 验证与权限兜底键；
 *   - `team-inbound:` / `start-work:` / `workflow-plan:` —— 团队反向消息、start-work
 *     子任务幂等键与工作流计划标签；
 *   - `restore-apply:` / `restore-apply-` / `file-revert-` —— 会话恢复应用与文件回滚键；
 *   - `cron-` —— 计划任务触发的后台运行。
 *
 * 会话存在活跃父 handoff 时，这些后台运行仍继承父回合键（回退父回合可连带清理它们）。
 * 只有不透明的外部客户端键（web-client 生成的 UUID、消息渠道 key 等）才视为会话自身
 * 的新回合键并优先于继承——用户直发团队子会话时必须归到自己的回合，否则回退该条
 * 消息清不掉这一回合的团队记录。外部键都是随机 UUID，不以任何保留前缀开头。
 */
export interface GatewayInternalRequestKeyShape {
  /** 保留前缀；`isGatewayInternalRequestKey` 按 startsWith 匹配。 */
  readonly prefix: string;
  /** 代表性样例键（真实 builder 前缀 + 占位 id）；守卫测试断言它被拒绝。 */
  readonly sample: string;
  /** 形状来源（阅读与守卫失败信息用）。 */
  readonly source: string;
}

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000000';

export const GATEWAY_INTERNAL_REQUEST_KEY_SHAPES: readonly GatewayInternalRequestKeyShape[] = [
  { prefix: 'handoff:', sample: `handoff:${SAMPLE_UUID}:completed`, source: 'handoff/runner/**' },
  {
    prefix: 'pm1:',
    sample: `pm1:${SAMPLE_UUID}:escalation-limit`,
    source: 'handoff/runner/pm1-runner',
  },
  { prefix: 'pm2:', sample: `pm2:${SAMPLE_UUID}:dispatch`, source: 'handoff/runner/pm2-runner' },
  {
    prefix: 'pm2-return:',
    sample: `pm2-return:dispatch:${SAMPLE_UUID}`,
    source: 'handoff/runner/pm2-runner',
  },
  {
    prefix: 'reception:',
    sample: `reception:${SAMPLE_UUID}`,
    source: 'handoff/runner/reception-orchestrator',
  },
  {
    prefix: 'reception-client:',
    sample: `reception-client:${'a'.repeat(48)}`,
    source: 'handoff/runner/reception-orchestrator',
  },
  {
    prefix: 'team-resume:',
    sample: `team-resume:${SAMPLE_UUID}`,
    source: 'team/team-resume-context',
  },
  {
    prefix: 'task:',
    sample: `task:${SAMPLE_UUID}:child:${SAMPLE_UUID}`,
    source: 'task/delegated-child-request-id',
  },
  {
    prefix: 'task-reminder:',
    sample: `task-reminder:${SAMPLE_UUID}:done:1730000000000`,
    source: 'tools/tool-sandbox',
  },
  {
    prefix: 'task-auto-resume:',
    sample: `task-auto-resume:${SAMPLE_UUID}:${SAMPLE_UUID}`,
    source: 'legacy: task/task-parent-auto-resume（已退役，仅存量兼容）',
  },
  {
    prefix: 'task-parent-decision:',
    sample: `task-parent-decision:${SAMPLE_UUID}:${SAMPLE_UUID}`,
    source: 'task/task-parent-auto-decision',
  },
  {
    prefix: 'task-job:',
    sample: `task-job:${SAMPLE_UUID}:1730000000000`,
    source: 'task/task-job-delivery',
  },
  {
    prefix: 'command:',
    sample: `command:${SAMPLE_UUID}:${SAMPLE_UUID}:${SAMPLE_UUID}`,
    source: 'routes/commands',
  },
  { prefix: 'command-card:', sample: `command-card:${SAMPLE_UUID}`, source: 'routes/commands' },
  {
    prefix: 'loop:',
    sample: `loop:start-work:${SAMPLE_UUID}:iteration:1`,
    source: 'routes/command-loop-runtime',
  },
  {
    prefix: 'ulw-verify:',
    sample: `ulw-verify:${SAMPLE_UUID}:recovered-task-id`,
    source: 'routes/commands',
  },
  {
    prefix: 'team-inbound:',
    sample: `team-inbound:user_input:${SAMPLE_UUID}`,
    source: 'routes/team-inbound',
  },
  {
    prefix: 'workflow-plan:',
    sample: 'workflow-plan:.agentdocs/workflow/team-turn-rollback.md',
    source: 'routes/start-work-subtasks',
  },
  {
    prefix: 'start-work:',
    sample: `start-work:${SAMPLE_UUID}:plan.md:任务`,
    source: 'routes/start-work-subtasks',
  },
  { prefix: 'permission:', sample: `permission:${SAMPLE_UUID}`, source: 'routes/permissions' },
  { prefix: 'restore-apply:', sample: `restore-apply:${SAMPLE_UUID}`, source: 'routes/sessions' },
  { prefix: 'restore-apply-', sample: `restore-apply-${SAMPLE_UUID}`, source: 'routes/sessions' },
  { prefix: 'file-revert-', sample: `file-revert-${'b'.repeat(32)}`, source: 'routes/sessions' },
  { prefix: 'cron-', sample: `cron-job-123-${SAMPLE_UUID}`, source: 'cron/agent-handler' },
];

const GATEWAY_INTERNAL_REQUEST_KEY_PREFIXES = GATEWAY_INTERNAL_REQUEST_KEY_SHAPES.map(
  (shape) => shape.prefix,
);

/** 判断请求键是否由网关后台运行生成（幂等 / 恢复 / 调度键，不是用户回合键）。 */
export function isGatewayInternalRequestKey(clientRequestId: string): boolean {
  return GATEWAY_INTERNAL_REQUEST_KEY_PREFIXES.some((prefix) => clientRequestId.startsWith(prefix));
}
