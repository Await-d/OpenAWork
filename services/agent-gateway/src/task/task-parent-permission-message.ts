const MAX_PARENT_DECISION_MESSAGE_LENGTH = 16000;

export function buildPermissionDecisionMessage(input: {
  childSessionId: string;
  parentSessionId: string;
  parentTaskId: string;
  permission: {
    id: string;
    preview_action: string | null;
    reason: string;
    risk_level: string;
    scope: string;
    tool_name: string;
  };
}): string {
  const queryArguments = {
    session_id: input.childSessionId,
    request_id: input.permission.id,
  };

  return [
    '你是上级任务分配 AI。下级开发 agent 因工具权限请求暂停。',
    '这是开发执行层决策，不要转问用户；请判断是否批准。危险、破坏性、外部副作用不明确时拒绝并要求替代方案。',
    '决策前允许调用工具；最终回复只输出 JSON，不要输出解释文本。格式：{"kind":"permission","decision":"approve|reject","feedback":"拒绝时给替代建议","rationale":"一句话依据"}',
    '预览可能不完整或被截断；必须先查询并阅读 execution.rawInput 完整工具参数，再输出最终 JSON 决策。request 为 null、execution.available 为 false、查询失败或请求已终结时，不得据摘要批准，应保守拒绝并给出替代建议。',
    'permission_get 是只读查询，不会批准请求或续跑子会话；查询必须使用下方子会话 ID，而非父会话 ID。',
    `查询示例：permission_get(${JSON.stringify(queryArguments)})`,
    '若工具已折叠，先用 tool_search({"query":"permission_get"}) 查看完整 schema，再通过 tool_invoke 调用：',
    `tool_invoke(${JSON.stringify({ tool: 'permission_get', arguments: queryArguments })})`,
    '',
    `父任务：${input.parentTaskId}`,
    `父会话：${input.parentSessionId}`,
    `子会话：${input.childSessionId}`,
    `权限请求：${input.permission.id}`,
    `工具：${input.permission.tool_name}`,
    `范围：${input.permission.scope}`,
    `风险：${input.permission.risk_level}`,
    `原因：${input.permission.reason}`,
    `预览：${input.permission.preview_action ?? '无'}`,
  ]
    .join('\n')
    .slice(0, MAX_PARENT_DECISION_MESSAGE_LENGTH);
}
