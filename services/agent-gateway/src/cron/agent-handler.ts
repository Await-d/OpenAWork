import { randomUUID } from 'node:crypto';
import { resolveAnyChannel } from '../channels/router.js';
import { buildChannelSessionKey, upsertChannelSession } from '../channels/channel-session-store.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { runSessionInBackground } from '../routes/stream-runtime.js';
import type { CronJobRecord } from './types.js';

interface SessionOwnerRow {
  readonly id: string;
}

export function buildCronAgentPrompt(job: CronJobRecord): string {
  const channelInfo =
    job.plugin_id && job.plugin_chat_id
      ? `\n## Channel Reply Routing\nThis cron job was created from plugin channel \`${job.plugin_id}\`.\nChat ID: \`${job.plugin_chat_id}\`\nWhen you have results to report, use **PluginSendMessage** with plugin_id="${job.plugin_id}" and chat_id="${job.plugin_chat_id}" to send the results back through the channel.`
      : '';
  const deliveryInstructions =
    job.plugin_id && job.plugin_chat_id
      ? `When finished, call **PluginSendMessage** EXACTLY ONCE with plugin_id="${job.plugin_id}" and chat_id="${job.plugin_chat_id}" to send a friendly result summary back through the channel. After sending, STOP.`
      : 'When finished, provide a concise result summary in this session, then STOP.';

  return [
    `You are a scheduled task assistant running cron job (ID: ${job.id}).`,
    `Job: ${job.name}`,
    job.delivery_target ? `Target session: ${job.delivery_target}` : '',
    channelInfo,
    '',
    '## Your Task',
    job.prompt,
    '',
    '## Delivery Instructions',
    deliveryInstructions,
    '',
    'Match the language of the task prompt in your delivery message (Chinese task -> Chinese reply, English task -> English reply). Be concise and friendly.',
    '',
    'Begin working on this task now.',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function assertOwnedSession(sessionId: string, userId: string): string {
  const row = sqliteGet<SessionOwnerRow>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!row) {
    throw new Error(`Cron target session "${sessionId}" does not exist for this user.`);
  }
  return row.id;
}

function createPlainCronSession(job: CronJobRecord): string {
  const existingTarget =
    job.delivery_mode === 'session' && job.delivery_target
      ? assertOwnedSession(job.delivery_target, job.user_id)
      : job.session_id
        ? assertOwnedSession(job.session_id, job.user_id)
        : null;
  if (existingTarget) {
    return existingTarget;
  }

  const sessionId = randomUUID();
  const metadata = {
    source: 'cron',
    cronJobId: job.id,
    ...(job.working_folder ? { workingDirectory: job.working_folder } : {}),
  };
  sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, job.user_id, `cron:${job.name}`, '[]', 'idle', JSON.stringify(metadata)],
  );
  return sessionId;
}

export function prepareCronSession(job: CronJobRecord): string {
  if (job.plugin_id && job.plugin_chat_id) {
    const channel = resolveAnyChannel(job.plugin_id);
    if (!channel) {
      throw new Error(`Cron channel "${job.plugin_id}" is not configured.`);
    }
    if (channel.ownerUserId !== job.user_id) {
      throw new Error(`Cron channel "${job.plugin_id}" does not belong to this user.`);
    }
    return upsertChannelSession({
      channel,
      chatId: job.plugin_chat_id,
      sessionKey: buildChannelSessionKey(job.plugin_id, job.plugin_chat_id),
      userId: job.user_id,
    });
  }

  return createPlainCronSession(job);
}

export async function runCronAgentJob(job: CronJobRecord): Promise<void> {
  if (!job.prompt.trim()) {
    return;
  }

  const sessionId = prepareCronSession(job);
  await runSessionInBackground({
    requestData: {
      message: buildCronAgentPrompt(job),
      displayMessage: job.prompt,
      clientRequestId: `cron-${job.id}-${randomUUID()}`,
      ...(job.agent_id ? { agentId: job.agent_id } : {}),
      ...(job.model ? { model: job.model } : {}),
    },
    sessionId,
    userId: job.user_id,
  });
}
