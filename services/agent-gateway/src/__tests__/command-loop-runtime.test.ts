import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { Message, MessageContent } from '@openAwork/shared';

const sessionRows = new Map<string, SessionRow>();
const sessionMessages = new Map<string, Message[]>();

interface SessionRow {
  id: string;
  user_id: string;
  messages_json: string;
  metadata_json: string;
}

function getSessionKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

function messageToText(message: Message | undefined): string {
  if (!message) return '';
  return message.content
    .map((content) => {
      if (content.type === 'text') return content.text;
      if (content.type === 'tool_call')
        return `${content.toolName}: ${JSON.stringify(content.input)}`;
      if (content.type === 'tool_result') {
        return JSON.stringify(content.output);
      }
      return `${content.title}: ${content.summary}`;
    })
    .join('\n')
    .trim();
}

vi.mock('../db.js', () => ({
  sqliteGet: (query: string, params: Array<string>) => {
    const sessionId = params[0] ?? '';
    const userId = params[1] ?? '';
    const row = sessionRows.get(getSessionKey(sessionId, userId));
    if (!row) return undefined;

    if (query.includes('SELECT metadata_json FROM sessions')) {
      return { metadata_json: row.metadata_json };
    }

    if (query.includes('SELECT id, user_id, messages_json, metadata_json FROM sessions')) {
      return row;
    }

    return undefined;
  },
  sqliteRun: (query: string, params: Array<string>) => {
    if (!query.includes('UPDATE sessions SET metadata_json = ?')) {
      return;
    }

    const metadataJson = params[0] ?? '{}';
    const sessionId = params[1] ?? '';
    const userId = params[2] ?? '';
    const key = getSessionKey(sessionId, userId);
    const row = sessionRows.get(key);
    if (row) {
      row.metadata_json = metadataJson;
      sessionRows.set(key, row);
    }
  },
  sqliteTransaction: (fn: () => unknown) => fn(),
}));

vi.mock('../session-message-store.js', () => ({
  appendSessionMessage: (input: {
    sessionId: string;
    userId: string;
    role: Message['role'];
    content: MessageContent[];
    createdAt?: number;
    messageId?: string;
  }) => {
    const key = getSessionKey(input.sessionId, input.userId);
    const row = sessionRows.get(key);
    if (!row) {
      throw new Error(`Missing session row for ${key}`);
    }

    const existing = sessionMessages.get(input.sessionId) ?? [];
    const message: Message = {
      id: input.messageId ?? randomUUID(),
      role: input.role,
      createdAt: input.createdAt ?? Date.now(),
      content: input.content,
    };
    const next = [...existing, message];
    sessionMessages.set(input.sessionId, next);
    row.messages_json = JSON.stringify(next);
    sessionRows.set(key, row);
    return message;
  },
  listSessionMessages: (input: { sessionId: string }) => sessionMessages.get(input.sessionId) ?? [],
  extractMessageText: messageToText,
}));

import {
  clearPersistedLoopState,
  readPersistedLoopStateForSession,
  scheduleLoopExecution,
  stopActiveLoopExecution,
} from '../routes/command-loop-runtime.js';

let taskManager: AgentTaskManagerImpl;
let sessionId = '';
let userId = '';
let workspaceRoot = '';

beforeEach(() => {
  sessionRows.clear();
  sessionMessages.clear();
  taskManager = new AgentTaskManagerImpl();
  sessionId = randomUUID();
  userId = randomUUID();
  workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-loop-runtime-'));

  sessionRows.set(getSessionKey(sessionId, userId), {
    id: sessionId,
    user_id: userId,
    messages_json: '[]',
    metadata_json: '{}',
  });
});

afterEach(() => {
  if (workspaceRoot) {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

describe('command-loop-runtime', () => {
  it('executes a background ralph loop and persists assistant output', async () => {
    sessionMessages.set(sessionId, [
      {
        id: randomUUID(),
        role: 'assistant',
        createdAt: Date.now() - 1_000,
        content: [{ type: 'text', text: '<promise>DONE</promise> old output' }],
      },
      {
        id: randomUUID(),
        role: 'user',
        createdAt: Date.now() - 900,
        content: [{ type: 'text', text: '不要把 <promise>DONE</promise> 当成完成信号' }],
      },
      {
        id: randomUUID(),
        role: 'assistant',
        createdAt: Date.now() - 800,
        content: [{ type: 'text', text: '<promise>done</promise> lower-case output' }],
      },
    ]);

    const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    const task = taskManager.addTask(graph, {
      title: 'Ralph Loop',
      description: 'loop test',
      status: 'pending',
      blockedBy: [],
      sessionId,
      priority: 'high',
      tags: ['ralph-loop'],
    });
    taskManager.startTask(graph, task.id);
    await taskManager.save(graph);

    sessionRows.set(getSessionKey(sessionId, userId), {
      id: sessionId,
      user_id: userId,
      messages_json: '[]',
      metadata_json: JSON.stringify({
        activeLoopKind: 'ralph',
        activeLoopTaskId: task.id,
        ralphLoopActive: true,
        ralphLoopTaskId: task.id,
      }),
    });

    scheduleLoopExecution({
      completionPromise: 'DONE',
      kind: 'ralph',
      maxIterations: 1,
      sessionId,
      strategy: 'continue',
      target: '修复认证模块',
      taskId: task.id,
      taskTitle: task.title,
      userId,
      workspaceRoot,
      taskManager,
      summarizeMessages: (messages) => messages.map((message) => messageToText(message)).join('\n'),
      extractLatestUserGoal: () => '修复认证模块',
      findLatestWorkflowPlan: async () => null,
    });

    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);

    await waitForBackgroundLoop();

    const updatedGraph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    expect(updatedGraph.tasks[task.id]).toMatchObject({ status: 'completed' });
    expect(updatedGraph.tasks[task.id]?.result).toContain('<promise>DONE</promise>');

    const texts = (sessionMessages.get(sessionId) ?? []).map((message) => messageToText(message));
    expect(texts.some((text) => text.includes('修复认证模块'))).toBe(true);
    expect(texts.some((text) => text.includes('<promise>DONE</promise>'))).toBe(true);
    expect(updatedGraph.tasks[task.id]?.result).not.toBe('<promise>DONE</promise> old output');
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(false);
  });

  it('stops a scheduled loop when cancellation is requested before completion', async () => {
    const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    const task = taskManager.addTask(graph, {
      title: 'Ralph Loop',
      description: 'loop cancel test',
      status: 'pending',
      blockedBy: [],
      sessionId,
      priority: 'high',
      tags: ['ralph-loop'],
    });
    taskManager.startTask(graph, task.id);
    await taskManager.save(graph);

    sessionRows.set(getSessionKey(sessionId, userId), {
      id: sessionId,
      user_id: userId,
      messages_json: '[]',
      metadata_json: JSON.stringify({
        activeLoopKind: 'ralph',
        activeLoopTaskId: task.id,
        ralphLoopActive: true,
        ralphLoopTaskId: task.id,
      }),
    });

    scheduleLoopExecution({
      completionPromise: 'DONE',
      kind: 'ralph',
      maxIterations: 2,
      sessionId,
      strategy: 'continue',
      target: '修复认证模块',
      taskId: task.id,
      taskTitle: task.title,
      userId,
      workspaceRoot,
      taskManager,
      summarizeMessages: () => '',
      extractLatestUserGoal: () => '修复认证模块',
      findLatestWorkflowPlan: async () => null,
    });

    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);

    stopActiveLoopExecution(sessionId);
    clearPersistedLoopState(workspaceRoot, sessionId);
    const cancellingGraph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    taskManager.cancelTask(cancellingGraph, task.id);
    await taskManager.save(cancellingGraph);

    await waitForBackgroundLoop();

    const cancelledGraph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    expect(cancelledGraph.tasks[task.id]).toMatchObject({ status: 'cancelled' });

    const texts = (sessionMessages.get(sessionId) ?? []).map((message) => messageToText(message));
    expect(texts.some((text) => text.includes('已结束：'))).toBe(false);
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(false);
  });

  it('transitions ULW into verification pending with VERIFIED promise state', async () => {
    const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    const task = taskManager.addTask(graph, {
      title: 'UltraWork Loop',
      description: 'ulw verification test',
      status: 'pending',
      blockedBy: [],
      sessionId,
      priority: 'high',
      tags: ['ulw-loop'],
    });
    taskManager.startTask(graph, task.id);
    await taskManager.save(graph);

    sessionRows.set(getSessionKey(sessionId, userId), {
      id: sessionId,
      user_id: userId,
      messages_json: '[]',
      metadata_json: JSON.stringify({
        activeLoopKind: 'ulw',
        activeLoopTaskId: task.id,
        ulwLoopActive: true,
        ulwLoopTaskId: task.id,
      }),
    });

    scheduleLoopExecution({
      completionPromise: 'DONE',
      kind: 'ulw',
      maxIterations: 2,
      sessionId,
      strategy: 'continue',
      target: '验证发布流程',
      taskId: task.id,
      taskTitle: task.title,
      userId,
      workspaceRoot,
      taskManager,
      summarizeMessages: () => '',
      extractLatestUserGoal: () => '验证发布流程',
      findLatestWorkflowPlan: async () => null,
    });

    await waitForBackgroundLoop();

    const updatedGraph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    expect(updatedGraph.tasks[task.id]).toMatchObject({ status: 'running' });
    expect(updatedGraph.tasks[task.id]?.result).toContain('<promise>VERIFIED</promise>');

    const stateFile = readFileContents(getLoopStateFilePath(workspaceRoot, sessionId));
    expect(stateFile).toContain('verification_pending: true');
    expect(stateFile).toContain('completion_promise: "VERIFIED"');
    expect(stateFile).toContain(`task_id: "${task.id}"`);

    const metadata = JSON.parse(
      sessionRows.get(getSessionKey(sessionId, userId))?.metadata_json ?? '{}',
    ) as Record<string, unknown>;
    expect(metadata['ulwVerificationPendingTaskId']).toBe(task.id);
    expect(typeof metadata['ulwVerificationPendingAt']).toBe('number');

    const texts = (sessionMessages.get(sessionId) ?? []).map((message) => messageToText(message));
    expect(texts.some((text) => text.includes('/ulw-verify --pass'))).toBe(true);
    expect(texts.some((text) => text.includes('/ulw-verify --fail'))).toBe(true);
  });

  it('clears the session-scoped state file even if the session row disappears before finalize', async () => {
    const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    const task = taskManager.addTask(graph, {
      title: 'Ralph Loop',
      description: 'cleanup on missing session',
      status: 'pending',
      blockedBy: [],
      sessionId,
      priority: 'high',
      tags: ['ralph-loop'],
    });
    taskManager.startTask(graph, task.id);
    await taskManager.save(graph);

    sessionRows.set(getSessionKey(sessionId, userId), {
      id: sessionId,
      user_id: userId,
      messages_json: '[]',
      metadata_json: JSON.stringify({
        activeLoopKind: 'ralph',
        activeLoopTaskId: task.id,
        ralphLoopActive: true,
        ralphLoopTaskId: task.id,
      }),
    });

    scheduleLoopExecution({
      completionPromise: 'DONE',
      kind: 'ralph',
      maxIterations: 1,
      sessionId,
      strategy: 'continue',
      target: '删除会话后的清理',
      taskId: task.id,
      taskTitle: task.title,
      userId,
      workspaceRoot,
      taskManager,
      summarizeMessages: () => '',
      extractLatestUserGoal: () => '删除会话后的清理',
      findLatestWorkflowPlan: async () => null,
    });

    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);
    sessionRows.delete(getSessionKey(sessionId, userId));

    await waitForBackgroundLoop();

    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(false);
  });

  it('does not clear a legacy root .openawork file that belongs to another session', () => {
    const otherSessionId = randomUUID();
    const legacyFile = getLegacyOpenAworkStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile, otherSessionId);

    clearPersistedLoopState(workspaceRoot, sessionId);

    expect(existsSync(legacyFile)).toBe(true);
  });

  it('clears a legacy root .openawork file when it belongs to the current session', () => {
    const legacyFile = getLegacyOpenAworkStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile, sessionId);

    clearPersistedLoopState(workspaceRoot, sessionId);

    expect(existsSync(legacyFile)).toBe(false);
  });

  it('does not clear a legacy .sisyphus file that belongs to another session', () => {
    const otherSessionId = randomUUID();
    const legacyFile = getLegacySisyphusStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile, otherSessionId);

    clearPersistedLoopState(workspaceRoot, sessionId);

    expect(existsSync(legacyFile)).toBe(true);
  });

  it('clears a legacy .sisyphus file when it belongs to the current session', () => {
    const legacyFile = getLegacySisyphusStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile, sessionId);

    clearPersistedLoopState(workspaceRoot, sessionId);

    expect(existsSync(legacyFile)).toBe(false);
  });

  it('migrates a legacy root .openawork state file into the session-scoped path', () => {
    const legacyFile = getLegacyOpenAworkStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile, sessionId);

    const state = readPersistedLoopStateForSession(workspaceRoot, sessionId);

    expect(state?.session_id).toBe(sessionId);
    expect(existsSync(legacyFile)).toBe(false);
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);
  });

  it('migrates a legacy root .openawork state file without session_id into the current session path', () => {
    const legacyFile = getLegacyOpenAworkStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile);

    const state = readPersistedLoopStateForSession(workspaceRoot, sessionId);

    expect(state?.session_id).toBe(sessionId);
    expect(existsSync(legacyFile)).toBe(false);
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);
  });

  it('migrates a legacy .sisyphus state file into the session-scoped path', () => {
    const legacyFile = getLegacySisyphusStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyFile, sessionId);

    const state = readPersistedLoopStateForSession(workspaceRoot, sessionId);

    expect(state?.session_id).toBe(sessionId);
    expect(existsSync(legacyFile)).toBe(false);
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);
  });

  it('removes both legacy files when both exist and the session claims them', () => {
    const legacyOpenAworkFile = getLegacyOpenAworkStateFilePath(workspaceRoot);
    const legacySisyphusFile = getLegacySisyphusStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyOpenAworkFile, sessionId);
    writeLegacyStateFile(legacySisyphusFile, sessionId);

    const state = readPersistedLoopStateForSession(workspaceRoot, sessionId);

    expect(state?.session_id).toBe(sessionId);
    expect(existsSync(legacyOpenAworkFile)).toBe(false);
    expect(existsSync(legacySisyphusFile)).toBe(false);
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(true);
  });

  it('clears only the current-session legacy file when .openawork and .sisyphus belong to different sessions', () => {
    const otherSessionId = randomUUID();
    const legacyOpenAworkFile = getLegacyOpenAworkStateFilePath(workspaceRoot);
    const legacySisyphusFile = getLegacySisyphusStateFilePath(workspaceRoot);
    writeLegacyStateFile(legacyOpenAworkFile, sessionId);
    writeLegacyStateFile(legacySisyphusFile, otherSessionId);

    clearPersistedLoopState(workspaceRoot, sessionId);

    expect(existsSync(legacyOpenAworkFile)).toBe(false);
    expect(existsSync(legacySisyphusFile)).toBe(true);
  });

  it('fails ULW and clears persisted state when verification cannot continue because session is missing', async () => {
    const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    const task = taskManager.addTask(graph, {
      title: 'UltraWork Loop',
      description: 'ulw missing-session verification',
      status: 'pending',
      blockedBy: [],
      sessionId,
      priority: 'high',
      tags: ['ulw-loop'],
    });
    taskManager.startTask(graph, task.id);
    await taskManager.save(graph);

    sessionRows.set(getSessionKey(sessionId, userId), {
      id: sessionId,
      user_id: userId,
      messages_json: '[]',
      metadata_json: JSON.stringify({
        activeLoopKind: 'ulw',
        activeLoopTaskId: task.id,
        ulwLoopActive: true,
        ulwLoopTaskId: task.id,
      }),
    });

    scheduleLoopExecution({
      completionPromise: 'DONE',
      kind: 'ulw',
      maxIterations: 2,
      sessionId,
      strategy: 'continue',
      target: 'ULW session missing finalize',
      taskId: task.id,
      taskTitle: task.title,
      userId,
      workspaceRoot,
      taskManager,
      summarizeMessages: () => '',
      extractLatestUserGoal: () => 'ULW session missing finalize',
      findLatestWorkflowPlan: async () => null,
    });

    sessionRows.delete(getSessionKey(sessionId, userId));
    await waitForBackgroundLoop();

    const updatedGraph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    expect(updatedGraph.tasks[task.id]).toMatchObject({ status: 'failed' });
    expect(existsSync(getLoopStateFilePath(workspaceRoot, sessionId))).toBe(false);
  });

  it('recreates verification_pending state for ULW even if the state file was removed before finalize', async () => {
    const graph = await taskManager.loadOrCreate(workspaceRoot, sessionId);
    const task = taskManager.addTask(graph, {
      title: 'UltraWork Loop',
      description: 'missing state fallback',
      status: 'pending',
      blockedBy: [],
      sessionId,
      priority: 'high',
      tags: ['ulw-loop'],
    });
    taskManager.startTask(graph, task.id);
    await taskManager.save(graph);

    sessionRows.set(getSessionKey(sessionId, userId), {
      id: sessionId,
      user_id: userId,
      messages_json: '[]',
      metadata_json: JSON.stringify({
        activeLoopKind: 'ulw',
        activeLoopTaskId: task.id,
        ulwLoopActive: true,
        ulwLoopTaskId: task.id,
      }),
    });

    scheduleLoopExecution({
      completionPromise: 'DONE',
      kind: 'ulw',
      maxIterations: 2,
      sessionId,
      strategy: 'continue',
      target: 'state file removed before finalize',
      taskId: task.id,
      taskTitle: task.title,
      userId,
      workspaceRoot,
      taskManager,
      summarizeMessages: () => '',
      extractLatestUserGoal: () => 'state file removed before finalize',
      findLatestWorkflowPlan: async () => null,
    });

    const stateFile = getLoopStateFilePath(workspaceRoot, sessionId);
    expect(existsSync(stateFile)).toBe(true);
    clearPersistedLoopState(workspaceRoot, sessionId);

    await waitForBackgroundLoop();

    const recreated = readFileContents(stateFile);
    expect(recreated).toContain('verification_pending: true');
    expect(recreated).toContain(`task_id: "${task.id}"`);
  });
});

async function waitForBackgroundLoop(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 140);
  });
}

function readFileContents(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function getLoopStateFilePath(workspaceRoot: string, sessionId: string): string {
  return join(
    workspaceRoot,
    `.openawork.ralph-loop.${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}.local.md`,
  );
}

function getLegacyOpenAworkStateFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.openawork.ralph-loop.local.md');
}

function getLegacySisyphusStateFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.sisyphus', 'ralph-loop.local.md');
}

function writeLegacyStateFile(filePath: string, sessionId?: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    [
      '---',
      'active: true',
      'iteration: 1',
      'completion_promise: "DONE"',
      sessionId ? `session_id: "${sessionId}"` : '',
      '---',
      'legacy prompt',
      '',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
    'utf8',
  );
}
