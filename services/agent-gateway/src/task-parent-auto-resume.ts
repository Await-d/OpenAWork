import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun } from './db.js';
import { getAnyInFlightStreamRequestForSession } from './routes/stream-cancellation.js';

const TASK_PARENT_AUTO_RESUME_DELAY_MS = 800;
const TASK_PARENT_AUTO_RESUME_RETRY_MS = 1500;
const MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES = 10;
const TASK_PARENT_AUTO_RESUME_REQUEST_PREFIX = 'task-auto-resume:';
const MAX_TASK_PARENT_AUTO_RESUME_MESSAGE_LENGTH = 30000;

interface TaskParentAutoResumeContextRow {
  child_session_id: string;
  parent_session_id: string;
  request_data_json: string;
  task_id: string;
  user_id: string;
}

interface ParentSessionStateRow {
  id: string;
  state_status: string;
}

interface StoredTaskParentAutoResumeContext {
  requestData: Record<string, unknown>;
  taskId: string;
}

interface PendingTaskParentAutoResumeItem {
  assignedAgent: string;
  childSessionId: string;
  errorMessage?: string;
  parentSessionId: string;
  requestData: Record<string, unknown>;
  result?: string;
  status: 'done' | 'failed';
  taskId: string;
  taskTitle: string;
  userId: string;
}

const pendingTaskParentAutoResumes = new Map<
  string,
  Map<string, PendingTaskParentAutoResumeItem>
>();
const taskParentAutoResumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const drainingTaskParentAutoResumes = new Set<string>();
const consecutiveTaskParentAutoResumeCounts = new Map<string, number>();

function buildSessionKey(parentSessionId: string, userId: string): string {
  return `${userId}:${parentSessionId}`;
}

function truncateAutoResumeText(value: string, maxLength = 1400): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function _buildAutoResumeDisplayMessage(items: PendingTaskParentAutoResumeItem[]): string {
  if (items.length === 1) {
    const item = items[0]!;
    return `子代理结果回流：@${item.assignedAgent} · ${item.taskTitle}`;
  }

  const titles = items.slice(0, 2).map((item) => `@${item.assignedAgent} · ${item.taskTitle}`);
  const suffix = items.length > 2 ? ` 等 ${items.length} 个子代理` : ` 共 ${items.length} 个子代理`;
  return `子代理结果回流：${titles.join('；')}${suffix}`;
}

export function buildAutoResumeMessage(items: PendingTaskParentAutoResumeItem[]): string {
  const sections = items.map((item, index) => {
    const primaryText = truncateAutoResumeText(
      item.errorMessage ?? item.result ?? '子代理执行已结束，但没有返回可展示的摘要。',
    );
    return [
      `子代理 ${index + 1}`,
      `- 任务：${item.taskTitle}`,
      `- 代理：${item.assignedAgent}`,
      `- 状态：${item.status === 'failed' ? '失败' : '完成'}`,
      `- 会话：${item.childSessionId}`,
      `- ${item.errorMessage ? '错误' : '结果'}：`,
      primaryText,
    ].join('\n');
  });

  const header = [
    '以下是后台子代理已完成后自动回流到主对话的结果，请继续当前主任务并直接回复用户。',
    '不要把这条系统注入消息当成新的用户需求；它只是子代理结果汇总。',
    '若这些结果已经足够，请整合后给出结论；若仍需继续委派，请避免重复启动刚刚完成的子代理。',
    '',
  ].join('\n');
  const separator = '\n\n---\n\n';
  let output = header;

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    const prefix = index === 0 ? '' : separator;
    if (
      output.length + prefix.length + section.length <=
      MAX_TASK_PARENT_AUTO_RESUME_MESSAGE_LENGTH
    ) {
      output += `${prefix}${section}`;
      continue;
    }

    const remainingCount = sections.length - index;
    const omittedNotice = `${prefix}其余 ${remainingCount} 个子代理结果已省略，请按需进入对应子会话查看详情。`;
    const availableLength = MAX_TASK_PARENT_AUTO_RESUME_MESSAGE_LENGTH - output.length;
    if (availableLength > 1) {
      output += omittedNotice.slice(0, availableLength);
    }
    break;
  }

  return output.slice(0, MAX_TASK_PARENT_AUTO_RESUME_MESSAGE_LENGTH);
}

function buildAutoResumeRequestData(
  baseRequestData: Record<string, unknown>,
  items: PendingTaskParentAutoResumeItem[],
): Record<string, unknown> {
  const latestItem = items[items.length - 1]!;
  const message = buildAutoResumeMessage(items);
  return {
    ...baseRequestData,
    clientRequestId: `${TASK_PARENT_AUTO_RESUME_REQUEST_PREFIX}${latestItem.parentSessionId}:${randomUUID()}`,
    displayMessage: undefined,
    message,
  };
}

function isParentSessionBusy(parentSessionId: string, userId: string): boolean {
  if (getAnyInFlightStreamRequestForSession({ sessionId: parentSessionId, userId })) {
    return true;
  }

  const session = sqliteGet<ParentSessionStateRow>(
    'SELECT id, state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [parentSessionId, userId],
  );
  if (!session) {
    return false;
  }

  return session.state_status === 'running' || session.state_status === 'paused';
}

function mergePendingItems(sessionKey: string, items: PendingTaskParentAutoResumeItem[]): void {
  const existing = pendingTaskParentAutoResumes.get(sessionKey) ?? new Map();
  for (const item of items) {
    existing.set(item.taskId, item);
  }
  pendingTaskParentAutoResumes.set(sessionKey, existing);
}

function scheduleDrain(sessionKey: string, delayMs: number): void {
  const existingTimer = taskParentAutoResumeTimers.get(sessionKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    taskParentAutoResumeTimers.delete(sessionKey);
    void drainPendingTaskParentAutoResumes(sessionKey);
  }, delayMs);
  taskParentAutoResumeTimers.set(sessionKey, timer);
}

async function drainPendingTaskParentAutoResumes(sessionKey: string): Promise<void> {
  if (drainingTaskParentAutoResumes.has(sessionKey)) {
    return;
  }

  const pendingItems = pendingTaskParentAutoResumes.get(sessionKey);
  if (!pendingItems || pendingItems.size === 0) {
    pendingTaskParentAutoResumes.delete(sessionKey);
    return;
  }

  drainingTaskParentAutoResumes.add(sessionKey);
  try {
    const items = Array.from(pendingItems.values());
    const sample = items[items.length - 1]!;
    const currentAutoResumeCount = consecutiveTaskParentAutoResumeCounts.get(sessionKey) ?? 0;
    if (currentAutoResumeCount >= MAX_CONSECUTIVE_TASK_PARENT_AUTO_RESUMES) {
      pendingTaskParentAutoResumes.delete(sessionKey);
      return;
    }

    if (isParentSessionBusy(sample.parentSessionId, sample.userId)) {
      scheduleDrain(sessionKey, TASK_PARENT_AUTO_RESUME_RETRY_MS);
      return;
    }

    pendingTaskParentAutoResumes.delete(sessionKey);
    const requestData = buildAutoResumeRequestData(sample.requestData, items);
    const { runSessionInBackground } = await import('./routes/stream-runtime.js');
    const result = await runSessionInBackground({
      requestData,
      sessionId: sample.parentSessionId,
      userId: sample.userId,
    });

    if (result.statusCode === 409 || result.statusCode >= 500) {
      mergePendingItems(sessionKey, items);
      scheduleDrain(sessionKey, TASK_PARENT_AUTO_RESUME_RETRY_MS);
      return;
    }

    consecutiveTaskParentAutoResumeCounts.set(sessionKey, currentAutoResumeCount + 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Another request is already running for this session.')) {
      scheduleDrain(sessionKey, TASK_PARENT_AUTO_RESUME_RETRY_MS);
      return;
    }

    pendingTaskParentAutoResumes.delete(sessionKey);
  } finally {
    drainingTaskParentAutoResumes.delete(sessionKey);
  }
}

export function isTaskParentAutoResumeClientRequestId(clientRequestId: string): boolean {
  return clientRequestId.startsWith(TASK_PARENT_AUTO_RESUME_REQUEST_PREFIX);
}

export function noteManualSessionInteraction(input: { sessionId: string; userId: string }): void {
  consecutiveTaskParentAutoResumeCounts.set(buildSessionKey(input.sessionId, input.userId), 0);
}

export function clearPendingTaskParentAutoResumesForSession(input: {
  sessionId: string;
  userId: string;
}): void {
  const sessionKey = buildSessionKey(input.sessionId, input.userId);
  pendingTaskParentAutoResumes.delete(sessionKey);
  consecutiveTaskParentAutoResumeCounts.delete(sessionKey);
  const timer = taskParentAutoResumeTimers.get(sessionKey);
  if (timer) {
    clearTimeout(timer);
    taskParentAutoResumeTimers.delete(sessionKey);
  }
}

export function upsertTaskParentAutoResumeContext(input: {
  childSessionId: string;
  parentSessionId: string;
  requestData: Record<string, unknown>;
  taskId: string;
  userId: string;
}): void {
  sqliteRun(
    `INSERT INTO task_parent_auto_resume_contexts
      (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(child_session_id) DO UPDATE SET
       parent_session_id = excluded.parent_session_id,
       user_id = excluded.user_id,
       task_id = excluded.task_id,
       request_data_json = excluded.request_data_json,
       updated_at = datetime('now')`,
    [
      input.childSessionId,
      input.parentSessionId,
      input.userId,
      input.taskId,
      JSON.stringify(input.requestData),
    ],
  );
}

export function consumeTaskParentAutoResumeContext(input: {
  childSessionId: string;
  parentSessionId: string;
  userId: string;
}): StoredTaskParentAutoResumeContext | null {
  const row = sqliteGet<TaskParentAutoResumeContextRow>(
    `SELECT child_session_id, parent_session_id, user_id, task_id, request_data_json
     FROM task_parent_auto_resume_contexts
     WHERE child_session_id = ? AND parent_session_id = ? AND user_id = ?
     LIMIT 1`,
    [input.childSessionId, input.parentSessionId, input.userId],
  );
  if (!row) {
    return null;
  }

  sqliteRun(
    'DELETE FROM task_parent_auto_resume_contexts WHERE child_session_id = ? AND user_id = ?',
    [input.childSessionId, input.userId],
  );

  try {
    const requestData = JSON.parse(row.request_data_json) as Record<string, unknown>;
    if (!requestData || typeof requestData !== 'object' || Array.isArray(requestData)) {
      return null;
    }

    return {
      requestData,
      taskId: row.task_id,
    };
  } catch {
    return null;
  }
}

export function clearTaskParentAutoResumeContext(input: {
  childSessionId: string;
  userId: string;
}): void {
  sqliteRun(
    'DELETE FROM task_parent_auto_resume_contexts WHERE child_session_id = ? AND user_id = ?',
    [input.childSessionId, input.userId],
  );
}

export function scheduleTaskParentAutoResume(input: PendingTaskParentAutoResumeItem): void {
  const sessionKey = buildSessionKey(input.parentSessionId, input.userId);
  mergePendingItems(sessionKey, [input]);
  scheduleDrain(sessionKey, TASK_PARENT_AUTO_RESUME_DELAY_MS);
}
