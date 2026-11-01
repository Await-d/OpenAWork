/**
 * 会话扩展审批结果的渠道回推（261101）。
 *
 * 守两件事：
 *   1. 只有**操作进入终态**才回推——无效 nonce / 越权 / 重复点击都停在
 *      `pending_approval`，不能给渠道回一条「已处理」，那会误导用户以为变更发生了；
 *   2. 终态的操作确实有回执送到渠道（保留早先写好、却一直没人调用的
 *      `buildSessionExtensionResultText`）。
 *
 * 「该不该回推」现在由**库里那条操作的状态**决定，而不是决策接口的返回值形状：
 * 这样即便未来新增一条结算路径，也不会漏掉或误发回执。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ManagerModule from '../../channels/manager.js';
import type * as NoticeModule from '../../session-extension/session-extension-channel-notice.js';
import type * as OpStoreModule from '../../session-extension/session-extension-operation-store.js';
import type * as DeliveryStoreModule from '../../session-extension/session-extension-delivery-store.js';
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

const PLUGIN_ID = 'telegram-extension-notice-test';
const CHAT_ID = 'chat-ext-1';
const USER_ID = 'u-ext-notice';
const SESSION_ID = 's-ext-notice';

const sent: Array<{ chatId: string; content: string }> = [];

class RecordingService implements MessagingChannelService {
  readonly pluginId = PLUGIN_ID;
  readonly pluginType = 'telegram';
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
    sent.push({ chatId, content });
    return { messageId: `sent-${sent.length}` };
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
let opStore: typeof OpStoreModule;
let deliveryStore: typeof DeliveryStoreModule;

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  db.sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [
      SESSION_ID,
      USER_ID,
      `channel:${PLUGIN_ID}:chat:${CHAT_ID}`,
      '[]',
      'idle',
      JSON.stringify({
        source: 'channel',
        channelChatId: CHAT_ID,
        channel: { id: PLUGIN_ID, type: 'telegram' },
      }),
    ],
  );

  manager = await import('../../channels/manager.js');
  notice = await import('../../session-extension/session-extension-channel-notice.js');
  opStore = await import('../../session-extension/session-extension-operation-store.js');
  deliveryStore = await import('../../session-extension/session-extension-delivery-store.js');

  const instance: ChannelInstance = {
    id: PLUGIN_ID,
    type: 'telegram',
    name: 'Extension Notice Telegram',
    enabled: true,
    config: {},
    replyLanguage: 'zh-CN',
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 0,
    updatedAt: 0,
  };
  manager.channelManager.registerFactory('telegram', () => new RecordingService());
  await manager.channelManager.startPlugin(instance, () => undefined);
});

afterAll(async () => {
  await manager.channelManager.stopPlugin(PLUGIN_ID);
});

/**
 * 用例隔离：派发器按 `available_at` FIFO 领取**全局**最旧的一条到期记录，
 * 上一个用例留下的待投递行会被本轮先领走（这是生产上的正确行为），
 * 因此每个用例都必须从空队列开始。
 */
beforeEach(() => {
  db.sqliteRun('DELETE FROM session_extension_deliveries', []);
  db.sqliteRun('DELETE FROM session_extension_operations', []);
});

function createOperation(overrides: Record<string, unknown> = {}) {
  return opStore.createSessionExtensionOperation({
    sessionId: SESSION_ID,
    ownerUserId: USER_ID,
    kind: 'skill',
    action: 'install',
    resourceRef: 'skill://demo',
    payload: { skillId: 'demo', displayName: '演示技能' },
    configDigest: null,
    expectedRevision: null,
    ...overrides,
  });
}

/** 把操作推到 `rejected` 终态（走生产状态机，而不是直接改库）。 */
function reject(operationId: string, nonce: string): void {
  opStore.rejectSessionExtensionOperation({
    sessionId: SESSION_ID,
    operationId,
    approverUserId: USER_ID,
    nonce,
    reason: '来源不可信',
  });
}

describe('哪些状态该回推渠道', () => {
  it('非终态不产生投递记录（这次点击没做任何变更）', () => {
    const operation = createOperation();
    expect(
      deliveryStore.enqueueSessionExtensionDelivery({
        operationId: operation.id,
        sessionId: SESSION_ID,
      }),
    ).toBe(false);
    expect(deliveryStore.getSessionExtensionDelivery(operation.id)).toBeUndefined();
  });

  it('终态产生回执文案并带回目标名', () => {
    const operation = createOperation();
    reject(operation.id, operation.nonce);

    expect(
      deliveryStore.enqueueSessionExtensionDelivery({
        operationId: operation.id,
        sessionId: SESSION_ID,
      }),
    ).toBe(true);
    const delivery = deliveryStore.getSessionExtensionDelivery(operation.id);
    expect(delivery?.state).toBe('pending');
    expect(delivery?.text).toContain('演示技能');
    expect(delivery?.text).toContain('未做任何变更');
  });

  it('同一操作重复入队只留一条（operationId 去重）', () => {
    const operation = createOperation();
    reject(operation.id, operation.nonce);
    const first = deliveryStore.enqueueSessionExtensionDelivery({
      operationId: operation.id,
      sessionId: SESSION_ID,
    });
    const second = deliveryStore.enqueueSessionExtensionDelivery({
      operationId: operation.id,
      sessionId: SESSION_ID,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe('终态操作的回执送达渠道', () => {
  it('拒绝后渠道收到含目标名与「未做任何变更」的回执', async () => {
    const operation = createOperation();
    reject(operation.id, operation.nonce);
    sent.length = 0;

    notice.notifyChannelSessionExtensionOutcome({
      sessionId: SESSION_ID,
      operationId: operation.id,
    });

    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0]?.chatId).toBe(CHAT_ID);
    expect(sent[0]?.content ?? '').toContain('演示技能');
    // 送达与结算之间有一步 ack，等它落库再断言状态。
    await vi.waitFor(() => {
      const record = deliveryStore.getSessionExtensionDelivery(operation.id);
      expect(record?.state, JSON.stringify(record)).toBe('delivered');
    });
  });

  it('非终态操作不回推任何内容', async () => {
    const operation = createOperation({
      kind: 'mcp',
      action: 'add',
      resourceRef: 'mcp://demo',
      payload: { displayId: 'demo-mcp' },
    });
    sent.length = 0;

    notice.notifyChannelSessionExtensionOutcome({
      sessionId: SESSION_ID,
      operationId: operation.id,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.length).toBe(0);
    expect(deliveryStore.getSessionExtensionDelivery(operation.id)).toBeUndefined();
  });
});
