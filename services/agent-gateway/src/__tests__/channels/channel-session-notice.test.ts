/**
 * 渠道审批回推（261101）：会话 → 渠道目标的解析、best-effort 契约、回推内容。
 *
 * 这些用例守的是「用户能不能知道情况」这条线：解析错了 → 提示发不出去；
 * 推送失败冒泡了 → 审批接口 500 诱导重复提交。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ManagerModule from '../../channels/manager.js';
import type * as NoticeModule from '../../channels/channel-session-notice.js';
import type * as ChannelConfigModule from '../../channels/channel-config.js';
import type {
  ChannelInstance,
  ChannelMessage,
  MessagingChannelService,
} from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const PLUGIN_ID = 'telegram-notice-test';
const CHAT_ID = 'chat-notice-1';
const USER_ID = 'u-notice';

interface SentMessage {
  readonly chatId: string;
  readonly content: string;
}

class RecordingService implements MessagingChannelService {
  readonly pluginId = PLUGIN_ID;
  readonly pluginType = 'telegram';
  readonly sent: SentMessage[] = [];
  private running = false;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(chatId: string, content: string): Promise<{ messageId: string }> {
    this.sent.push({ chatId, content });
    return { messageId: `sent-${this.sent.length}` };
  }

  async replyMessage(): Promise<{ messageId: string }> {
    return { messageId: 'reply' };
  }

  async getGroupMessages(): Promise<ChannelMessage[]> {
    return [];
  }

  async listGroups(): Promise<[]> {
    return [];
  }
}

let db: typeof DbModule;
let manager: typeof ManagerModule;
let notice: typeof NoticeModule;
let channelConfig: typeof ChannelConfigModule;
const service = new RecordingService();

function seedUser(): void {
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function insertSession(input: {
  id: string;
  title: string;
  metadata: Record<string, unknown>;
}): void {
  db.sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [input.id, USER_ID, input.title, '[]', 'idle', JSON.stringify(input.metadata)],
  );
}

function insertPendingPermission(sessionId: string, toolName: string): void {
  db.sqliteRun(
    `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [`pr-${toolName}-${sessionId}`, sessionId, toolName, 'bash *', '需要授权', 'high'],
  );
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  seedUser();
  channelConfig = await import('../../channels/channel-config.js');
  manager = await import('../../channels/manager.js');
  notice = await import('../../channels/channel-session-notice.js');
  const instance: ChannelInstance = {
    id: PLUGIN_ID,
    type: 'telegram',
    name: 'Notice Telegram',
    enabled: true,
    config: {},
    replyLanguage: 'zh-CN',
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 0,
    updatedAt: 0,
  };
  manager.channelManager.registerFactory('telegram', () => service);
  await manager.channelManager.startPlugin(instance, () => undefined);
});

afterAll(async () => {
  await manager.channelManager.stopPlugin(PLUGIN_ID);
});

describe('渠道会话通知目标解析', () => {
  it('优先按 metadata 解析渠道与 chatId，并沿用会话回复语言', () => {
    insertSession({
      id: 's-metadata',
      title: `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      metadata: {
        source: 'channel',
        channelChatId: CHAT_ID,
        replyLanguage: 'en-US',
        channel: { id: PLUGIN_ID, type: 'telegram' },
      },
    });

    const target = notice.resolveChannelSessionNoticeTarget('s-metadata');
    expect(target).toEqual({
      pluginId: PLUGIN_ID,
      chatId: CHAT_ID,
      replyLanguage: 'en-US',
      ownerUserId: USER_ID,
    });
  });

  it('metadata 丢失渠道字段时按会话标题兜底，语言回落默认值', () => {
    insertSession({
      id: 's-key-fallback',
      title: `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      metadata: {},
    });

    const target = notice.resolveChannelSessionNoticeTarget('s-key-fallback');
    expect(target?.pluginId).toBe(PLUGIN_ID);
    expect(target?.chatId).toBe(CHAT_ID);
    expect(target?.replyLanguage).toBe('zh-CN');
  });

  it('非渠道会话（Web 直接创建）解析不到目标', () => {
    insertSession({ id: 's-web', title: '普通会话', metadata: {} });
    expect(notice.resolveChannelSessionNoticeTarget('s-web')).toBeNull();
  });

  it('渠道服务不可达时安静失败，不抛错', async () => {
    const target = {
      pluginId: 'telegram-not-registered',
      chatId: CHAT_ID,
      replyLanguage: 'zh-CN' as const,
      ownerUserId: USER_ID,
    };
    await expect(
      notice.sendChannelSessionNotice({
        target,
        sessionId: 's-metadata',
        source: 'test',
        text: 'hello',
      }),
    ).resolves.toBe(false);
  });
});

describe('渠道派生子代理会话的回推', () => {
  function seedParentChannelSession(id: string): void {
    insertSession({
      id,
      title: `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      metadata: {
        source: 'channel',
        channelChatId: CHAT_ID,
        channel: { id: PLUGIN_ID, type: 'telegram' },
      },
    });
  }

  it('子会话自身没有渠道身份，沿 parentSessionId 才能找到父渠道', () => {
    seedParentChannelSession('s-ancestor-parent');
    insertSession({
      id: 's-ancestor-child',
      title: '子代理会话',
      metadata: { parentSessionId: 's-ancestor-parent', createdByTool: 'task' },
    });

    expect(notice.resolveChannelSessionNoticeTarget('s-ancestor-child')).toBeNull();
    expect(notice.resolveChannelSessionNoticeTargetIncludingAncestors('s-ancestor-child')).toEqual({
      pluginId: PLUGIN_ID,
      chatId: CHAT_ID,
      replyLanguage: 'zh-CN',
      ownerUserId: USER_ID,
    });
  });

  it('team_parent_session_id 列同样可回溯', () => {
    seedParentChannelSession('s-team-parent');
    insertSession({ id: 's-team-child', title: '团队执行会话', metadata: {} });
    db.sqliteRun('UPDATE sessions SET team_parent_session_id = ? WHERE id = ?', [
      's-team-parent',
      's-team-child',
    ]);

    expect(notice.resolveChannelSessionNoticeTargetIncludingAncestors('s-team-child')?.chatId).toBe(
      CHAT_ID,
    );
  });

  it('非渠道祖先链不推送', () => {
    insertSession({ id: 's-web-parent', title: '普通会话', metadata: {} });
    insertSession({
      id: 's-web-child',
      title: '子代理会话',
      metadata: { parentSessionId: 's-web-parent' },
    });

    expect(notice.resolveChannelSessionNoticeTargetIncludingAncestors('s-web-child')).toBeNull();
  });

  it('子会话的审批决定会回推到父渠道', async () => {
    // 记录数组是跨 describe 共享的：回推是 fire-and-forget，上一条可能在下一个
    // 用例断言之后才落地，所以每个用例自己先清零（本 describe 内也各自清一次）。
    seedParentChannelSession('s-ancestor-decide-parent');
    insertSession({
      id: 's-ancestor-decide-child',
      title: '子代理会话',
      metadata: { parentSessionId: 's-ancestor-decide-parent' },
    });
    service.sent.length = 0;

    notice.notifyChannelPermissionDecision({
      sessionId: 's-ancestor-decide-child',
      toolName: 'bash',
      decision: 'once',
      resumed: true,
    });

    await vi.waitFor(() => expect(service.sent.length).toBe(1));
    expect(service.sent[0]?.chatId).toBe(CHAT_ID);
    expect(service.sent[0]?.content).toContain('bash');
  });

  afterEach(() => {
    service.sent.length = 0;
  });
});

describe('超时失效的回推', () => {
  it('说明「已失效」而不是「已拒绝」', async () => {
    insertSession({
      id: 's-expired',
      title: `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      metadata: { channelChatId: CHAT_ID, channel: { id: PLUGIN_ID } },
    });
    service.sent.length = 0;

    notice.notifyChannelPermissionExpired({ sessionId: 's-expired', toolNames: ['bash'] });

    await vi.waitFor(() => expect(service.sent.length).toBe(1));
    const content = service.sent[0]?.content ?? '';
    expect(content).toContain('授权已超时');
    expect(content).toContain('bash');
    expect(content).not.toContain('已拒绝');
  });

  afterEach(() => {
    service.sent.length = 0;
  });
});

describe('主动推送尊重渠道开关', () => {
  const target = {
    pluginId: PLUGIN_ID,
    chatId: CHAT_ID,
    replyLanguage: 'zh-CN' as const,
    ownerUserId: USER_ID,
  };

  afterEach(() => {
    db.sqliteRun('DELETE FROM user_settings WHERE user_id = ?', [USER_ID]);
    service.sent.length = 0;
  });

  function writeStoredChannels(overrides: Record<string, unknown>): void {
    const channel = channelConfig.createChannelInstance(
      {
        id: PLUGIN_ID,
        type: 'telegram',
        name: '开关用例',
        config: {},
        enabled: true,
        ...overrides,
      },
      USER_ID,
    );
    db.sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'channels', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      [USER_ID, JSON.stringify([channel])],
    );
  }

  it('渠道被禁用后不再主动发消息', async () => {
    service.sent.length = 0;
    writeStoredChannels({ enabled: false, features: { autoReply: true } });

    await expect(
      notice.sendChannelSessionNotice({
        target,
        sessionId: 's-metadata',
        source: 'test',
        text: 'hello',
      }),
    ).resolves.toBe(false);
    expect(service.sent.length).toBe(0);
  });

  it('关掉「自动回复」后同样不主动发消息', async () => {
    writeStoredChannels({ enabled: true, features: { autoReply: false } });

    await expect(
      notice.sendChannelSessionNotice({
        target,
        sessionId: 's-metadata',
        source: 'test',
        text: 'hello',
      }),
    ).resolves.toBe(false);
    expect(service.sent.length).toBe(0);
  });

  it('开关均开启时正常推送', async () => {
    writeStoredChannels({ enabled: true, features: { autoReply: true } });

    await expect(
      notice.sendChannelSessionNotice({
        target,
        sessionId: 's-metadata',
        source: 'test',
        text: 'hello',
      }),
    ).resolves.toBe(true);
    expect(service.sent.length).toBe(1);
  });

  it('配置读不到时不拦截（会话确实来自该渠道且服务在跑）', async () => {
    await expect(
      notice.sendChannelSessionNotice({
        target,
        sessionId: 's-metadata',
        source: 'test',
        text: 'hello',
      }),
    ).resolves.toBe(true);
  });

  it('平台发送失败时安静返回 false，不把异常抛给审批流程', async () => {
    const spy = vi
      .spyOn(service, 'sendMessage')
      .mockRejectedValueOnce(new Error('telegram sendMessage 500'));

    await expect(
      notice.sendChannelSessionNotice({
        target,
        sessionId: 's-metadata',
        source: 'test',
        text: 'hello',
      }),
    ).resolves.toBe(false);

    spy.mockRestore();
  });
});

describe('权限审批回推内容', () => {
  it('批准后回推含工具名与「正在继续执行」', async () => {
    service.sent.length = 0;
    notice.notifyChannelPermissionDecision({
      sessionId: 's-metadata',
      toolName: 'bash',
      decision: 'once',
      resumed: true,
    });

    await vi.waitFor(() => expect(service.sent.length).toBe(1));
    const content = service.sent[0]?.content ?? '';
    expect(service.sent[0]?.chatId).toBe(CHAT_ID);
    expect(content).toContain('Permission approved');
    expect(content).toContain('bash');
  });

  it('拒绝后回推明确说明不会执行，且不提「正在继续」', async () => {
    service.sent.length = 0;
    notice.notifyChannelPermissionDecision({
      sessionId: 's-metadata',
      toolName: 'write',
      decision: 'reject',
      resumed: false,
    });

    await vi.waitFor(() => expect(service.sent.length).toBe(1));
    const content = service.sent[0]?.content ?? '';
    expect(content).toContain('Permission denied');
    expect(content).not.toContain('continuing now');
  });
});

describe('授权后续跑的回推', () => {
  it('仍挂着待审批时再发一条等待授权提示', async () => {
    insertSession({
      id: 's-resume-pending',
      title: `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      metadata: { channelChatId: CHAT_ID, channel: { id: PLUGIN_ID } },
    });
    insertPendingPermission('s-resume-pending', 'bash');
    service.sent.length = 0;

    await notice.notifyChannelAfterApprovedResume({
      sessionId: 's-resume-pending',
      clientRequestId: 'cr-1',
    });

    expect(service.sent.length).toBe(1);
    expect(service.sent[0]?.content).toContain('等待授权');
    expect(service.sent[0]?.content).toContain('bash');
  });

  it('无待审批且没有文本输出时给出兜底说明，而不是静默', async () => {
    insertSession({
      id: 's-resume-empty',
      title: `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      metadata: { channelChatId: CHAT_ID, channel: { id: PLUGIN_ID } },
    });
    service.sent.length = 0;

    await notice.notifyChannelAfterApprovedResume({
      sessionId: 's-resume-empty',
      clientRequestId: 'cr-2',
    });

    expect(service.sent.length).toBe(1);
    expect(service.sent[0]?.content).toContain('授权后已继续执行');
  });

  it('续跑失败时也回推，避免批准后永久沉默', async () => {
    service.sent.length = 0;
    notice.notifyChannelPermissionResumeFailure({
      sessionId: 's-resume-empty',
      detail: '上游 500',
    });

    await vi.waitFor(() => expect(service.sent.length).toBe(1));
    expect(service.sent[0]?.content).toContain('执行失败');
    expect(service.sent[0]?.content).toContain('上游 500');
  });
});
