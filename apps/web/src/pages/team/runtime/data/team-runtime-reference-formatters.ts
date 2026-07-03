import type {
  SessionTask,
  TeamAuditLogRecord,
  TeamMessageRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import type {
  AgentTeamsConversationCard,
  AgentTeamsMessageCard,
  AgentTeamsSidebarTeam,
  AgentTeamsTimelineEventType,
} from './team-runtime-types.js';
import {
  mapSemanticStatusToSidebarStatus,
  type TeamRuntimeSemanticStatus,
} from './team-runtime-status.js';

export function formatWorkspaceLabel(workspacePath: string | null): string {
  if (!workspacePath) {
    return '未绑定工作区';
  }

  const segments = workspacePath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? workspacePath;
}

export function formatClock(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (Number.isNaN(delta) || delta < 0) {
    return '刚刚';
  }
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function formatRuntimeDuration(values: number[]): string {
  if (values.length === 0) {
    return '0m 00s';
  }

  const startedAt = Math.min(...values);
  const delta = Math.max(0, Date.now() - startedAt);
  const totalMinutes = Math.floor(delta / 60_000);
  const seconds = Math.floor(delta / 1000) % 60;
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function mapMemberStatusLabel(status: string | undefined): string {
  if (status === 'working') {
    return '工作中';
  }
  if (status === 'done') {
    return '已完成';
  }
  if (status === 'error') {
    return '异常';
  }
  return '空闲';
}

export function isRuntimeSessionPaused(stateStatus: string | undefined, paused?: boolean): boolean {
  if (paused === true) {
    return true;
  }
  return stateStatus === 'paused';
}

export function isSharedSessionPaused(stateStatus: string | undefined): boolean {
  return stateStatus === 'paused';
}

export function mapSidebarStatus(
  status: TeamRuntimeSemanticStatus,
): AgentTeamsSidebarTeam['status'] {
  return mapSemanticStatusToSidebarStatus(status);
}

export function mapMessageCardType(type: TeamMessageRecord['type']): AgentTeamsMessageCard['type'] {
  return type;
}

export function mapConversationType(
  type: TeamMessageRecord['type'],
): AgentTeamsConversationCard['type'] {
  if (type === 'question') {
    return 'question';
  }
  if (type === 'result') {
    return 'result';
  }
  if (type === 'error') {
    return 'direct';
  }
  return 'broadcast';
}

export function mapTimelineEventTypeFromMessage(
  type: TeamMessageRecord['type'],
): AgentTeamsTimelineEventType {
  if (type === 'question') {
    return 'user_input';
  }
  if (type === 'error') {
    return 'error';
  }
  if (type === 'result') {
    return 'task_complete';
  }
  return 'assistant_message';
}

export function mapTimelineEventTypeFromAudit(
  action: TeamAuditLogRecord['action'],
): AgentTeamsTimelineEventType {
  if (action === 'capability_violation') {
    return 'error';
  }
  if (action === 'shared_comment_created') {
    return 'assistant_message';
  }
  if (action === 'shared_question_replied') {
    return 'user_input';
  }
  if (action === 'shared_permission_replied') {
    return 'waiting_confirmation';
  }
  if (action === 'share_created') {
    return 'session_start';
  }
  if (action === 'share_deleted') {
    return 'write';
  }
  return 'tool_use';
}

export function mapTimelineEventTypeFromRuntimeTask(
  status: SessionTask['status'],
): AgentTeamsTimelineEventType {
  if (status === 'completed') {
    return 'task_complete';
  }
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'running') {
    return 'thinking';
  }
  return 'waiting_confirmation';
}

/**
 * 将时间线事件的原始 detail 文本格式化为简洁可读的摘要。
 *
 * 后端返回的 task.result / task.errorMessage / message.content / log.detail
 * 可能包含 JSON 字符串、多行日志、堆栈等原始内容，直接在仪表盘时间线中展示
 * 会显得像未处理的日志。此函数做以下处理：
 *   1. 尝试 JSON.parse，提取有意义的字段组合成可读摘要
 *   2. 截断多行内容，只保留首行
 *   3. 限制总长度到 maxLen
 */
export function formatTimelineDetail(raw: string | undefined | null, maxLen = 120): string {
  if (!raw || typeof raw !== 'string') {
    return '';
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  // 尝试解析 JSON —— 后端有时把结构化错误/结果序列化为 JSON 字符串
  const jsonResult = tryExtractJsonSummary(trimmed, maxLen);
  if (jsonResult !== null) {
    return jsonResult;
  }

  // 非 JSON：取首行，去掉多余空白
  const firstLine = trimmed.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';

  // 截断到 maxLen
  if (firstLine.length <= maxLen) {
    return firstLine;
  }
  return `${firstLine.slice(0, maxLen - 1)}…`;
}

/**
 * 尝试从可能是 JSON 的文本中提取人类可读的摘要。
 * 返回 null 表示不是 JSON 或无法提取有意义的内容。
 */
function tryExtractJsonSummary(text: string, maxLen: number): string | null {
  // 只有当文本以 { 或 [ 开头时才尝试 JSON 解析。
  // 混合文本（如 "任务描述 {json}"）不解析，直接当纯文本处理。
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (typeof parsed === 'string') {
      const inner = formatTimelineDetail(parsed, maxLen);
      return inner || null;
    }

    if (parsed && typeof parsed === 'object') {
      // 数组：取第一个元素递归
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (typeof first === 'string') {
          const inner = formatTimelineDetail(first, maxLen);
          return inner || null;
        }
        if (first && typeof first === 'object') {
          const summary = buildObjectSummary(first as Record<string, unknown>, maxLen);
          if (summary) return summary;
        }
        return null;
      }

      // 对象：组合字段生成摘要
      const summary = buildObjectSummary(parsed as Record<string, unknown>, maxLen);
      if (summary) return summary;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 从 JSON 对象中组合多个字段生成可读摘要。
 *
 * 策略：优先将「动作类字段」(action/toolName/tool/status) 作为前缀，
 * 再拼接「描述类字段」(subject/title/description/message/error/reason/summary/result) 作为主体。
 * 这样既能看到"做了什么"，也能看到"结果/原因"。
 */
function buildObjectSummary(record: Record<string, unknown>, maxLen: number): string | null {
  // 1. 提取描述类字段（主体内容）—— 优先任务描述，再 fallback 到消息/错误
  const descFields = [
    'subject',
    'title',
    'description',
    'message',
    'error',
    'errorMessage',
    'reason',
    'summary',
    'detail',
    'result',
    'note',
    'content',
    'text',
  ];
  let desc = '';
  for (const key of descFields) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() && !looksLikeIdOrPath(value)) {
      desc = value.trim();
      break;
    }
  }

  // 2. 提取动作类字段（前缀），英文 action 做中文映射
  const actionFields = [
    'action',
    'toolName',
    'tool',
    'operation',
    'event',
    'status',
    'state',
    'type',
  ];
  let rawAction = '';
  for (const key of actionFields) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      rawAction = value.trim();
      break;
    }
  }

  const action = humanizeAction(rawAction);

  // 3. 组合
  if (action && desc) {
    // 如果动作本身就是中文化的描述，不需要重复加"："
    if (action === desc || action === rawAction) {
      return truncateText(desc, maxLen);
    }
    const combined = `${action}：${desc}`;
    return truncateText(combined, maxLen);
  }

  // 只有描述
  if (desc) {
    return truncateText(desc, maxLen);
  }

  // 只有动作：尝试用动作 + 数量字段构建更完整摘要
  if (action) {
    const actionWithCounts = buildActionWithCounts(action, rawAction, record);
    return truncateText(actionWithCounts, maxLen);
  }

  // 都没有：尝试任何字符串值
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim() && !looksLikeIdOrPath(value)) {
      return truncateText(value.trim(), maxLen);
    }
  }

  return null;
}

/**
 * 将常见的英文动作标识符映射为中文可读文本。
 */
function humanizeAction(action: string): string {
  if (!action) return '';

  const map: Record<string, string> = {
    'resume-all': '恢复全部运行',
    'pause-all': '暂停全部运行',
    'stop-all': '停止全部运行',
    'restart-all': '重启全部运行',
    'cancel-all': '取消全部运行',
    resume: '恢复运行',
    pause: '暂停运行',
    stop: '停止运行',
    start: '开始运行',
    restart: '重启运行',
    cancel: '取消运行',
    create: '创建',
    update: '更新',
    delete: '删除',
    edit: '编辑',
    submit: '提交',
    approve: '审批通过',
    reject: '拒绝',
    complete: '完成',
    fail: '失败',
    retry: '重试',
    sync: '同步',
    refresh: '刷新',
    init: '初始化',
    clone: '克隆',
    merge: '合并',
    deploy: '部署',
    build: '构建',
    test: '测试',
    run: '执行',
    execute: '执行',
    invoke: '调用',
    query: '查询',
    notify: '通知',
    assign: '分配',
    handoff: '交接',
    transfer: '转交',
    accept: '接受',
    decline: '拒绝',
    plan: '规划',
    review: '审查',
    analyze: '分析',
    summarize: '总结',
  };

  return map[action] ?? action;
}

/**
 * 当 JSON 对象中只有动作字段时，尝试结合数量字段生成更完整的摘要。
 * 例如：{"action":"resume-all","sessionIds":["a"],"handoffIds":[]} → "恢复全部运行：1 个会话"
 */
function buildActionWithCounts(
  action: string,
  rawAction: string,
  record: Record<string, unknown>,
): string {
  const countParts: string[] = [];

  const sessionIds = record['sessionIds'];
  if (Array.isArray(sessionIds)) {
    countParts.push(`${sessionIds.length} 个会话`);
  }

  const handoffIds = record['handoffIds'];
  if (Array.isArray(handoffIds)) {
    countParts.push(`${handoffIds.length} 个交接`);
  }

  const taskIds = record['taskIds'];
  if (Array.isArray(taskIds)) {
    countParts.push(`${taskIds.length} 个任务`);
  }

  const items = record['items'] ?? record['records'];
  if (Array.isArray(items)) {
    countParts.push(`${items.length} 条记录`);
  }

  if (countParts.length > 0) {
    return `${action}（${countParts.join('，')}）`;
  }

  // 如果没有数量字段，但 rootSessionId 等 ID 字段存在，说明是运行时操作
  const hasRuntimeIds = ['rootSessionId', 'sessionId', 'taskId', 'handoffId'].some(
    (key) => record[key] && typeof record[key] === 'string',
  );
  if (hasRuntimeIds) {
    return `${action}操作`;
  }

  return action;
}

function truncateText(text: string, maxLen: number): string {
  // 取首行，压缩空白
  const firstLine = text.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (firstLine.length <= maxLen) {
    return firstLine;
  }
  return `${firstLine.slice(0, maxLen - 1)}…`;
}

/**
 * 判断一个值是否像 ID、UUID、路径等技术标识符（不适合作为人类可读摘要）。
 */
function looksLikeIdOrPath(value: string): boolean {
  // UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  if (/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) return true;
  // 长 hex 字符串 (session/task ID)
  if (/^[a-f0-9]{16,}$/i.test(value)) return true;
  return false;
}

export function buildTaskUpdateStatus(
  currentStatus: TeamTaskRecord['status'],
  direction: 'left' | 'right',
): 'pending' | 'in_progress' | 'done' | 'failed' | null {
  if (currentStatus === 'pending') {
    return direction === 'right' ? 'in_progress' : null;
  }
  if (currentStatus === 'in_progress') {
    return direction === 'left' ? 'pending' : 'done';
  }
  if (currentStatus === 'completed' || currentStatus === 'failed') {
    return direction === 'left' ? 'in_progress' : null;
  }
  return null;
}
