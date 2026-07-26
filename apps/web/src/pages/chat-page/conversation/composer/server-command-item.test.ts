import type {
  CommandDescriptor,
  CommandExecutionResult,
  CommandResultCard,
  RunEvent,
} from '@openAwork/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchServerSlashCommand } from '../../../../components/conversation-runtime/messages/support.js';
import { buildComposerSlashItems } from './composer-slash-items.js';
import { createServerSlashCommandItem, executeServerCommand } from './server-command-item.js';

const commandClientMocks = vi.hoisted(() => {
  const execute = vi.fn<() => Promise<CommandExecutionResult>>();
  const createCommandsClient = vi.fn((_gatewayUrl: string) => ({ execute }));
  return { createCommandsClient, execute };
});

vi.mock('@openAwork/web-client', () => ({
  createCommandsClient: commandClientMocks.createCommandsClient,
}));

const startWorkDoneCommand: CommandDescriptor = {
  id: 'slash-start-work-done',
  label: '/start-work-done',
  description: '提交 start-work 子任务完成声明，等待 reviewer 确认',
  contexts: ['composer'],
  execution: 'server',
  action: { kind: 'submit_start_work_done_claim' },
};

const startWorkReviewCommand: CommandDescriptor = {
  id: 'slash-start-work-review',
  label: '/start-work-review',
  description: '提交 start-work reviewer verdict 并解除或保持完成门禁',
  contexts: ['composer'],
  execution: 'server',
  action: { kind: 'review_start_work_done_claim' },
};

const compactCommand: CommandDescriptor = {
  id: 'slash-compact',
  label: '/compact',
  description: '压缩当前会话上下文',
  contexts: ['composer'],
  execution: 'server',
  action: { kind: 'compact_session' },
};

const startWorkGateCommands: CommandDescriptor[] = [startWorkDoneCommand, startWorkReviewCommand];

beforeEach(() => {
  commandClientMocks.createCommandsClient.mockClear();
  commandClientMocks.execute.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server composer slash commands', () => {
  it('压缩命令在菜单里只显示 compact，但仍插入 /compact', async () => {
    const compactItem = createServerSlashCommandItem({
      id: 'slash-compact',
      label: '/compact',
      description: '压缩当前会话上下文',
      contexts: ['composer'],
      execution: 'server',
      action: { kind: 'compact_session' },
    });

    expect(compactItem).toMatchObject({
      label: 'compact',
      insertText: '/compact ',
      description: '压缩当前会话上下文',
    });
  });

  it('把 start-work gate 命令转换成可展示的 composer slash 项', async () => {
    const directItem = createServerSlashCommandItem(startWorkDoneCommand);
    const menuItems = buildComposerSlashItems({
      commandDescriptors: startWorkGateCommands,
    });

    expect(directItem).toMatchObject({
      id: 'slash-start-work-done',
      kind: 'slash',
      source: 'command',
      type: 'insert',
      label: '/start-work-done',
      description: '提交 start-work 子任务完成声明，等待 reviewer 确认',
      badgeLabel: '命令',
      insertText: '/start-work-done ',
    });
    await expect(directItem.onSelect()).resolves.toBeUndefined();
    expect(menuItems.map((item) => item.label)).toEqual(['/start-work-done', '/start-work-review']);
  });

  it('用用户输入的第一个 token 匹配 start-work gate server slash 命令', () => {
    const doneMatch = matchServerSlashCommand(
      '/START-WORK-DONE task-1 已完成',
      startWorkGateCommands,
    );
    const reviewMatch = matchServerSlashCommand(
      '/start-work-review task-1 confirmed',
      startWorkGateCommands,
    );

    expect(doneMatch?.id).toBe('slash-start-work-done');
    expect(reviewMatch?.id).toBe('slash-start-work-review');
  });

  it('执行命中的 server slash 命令时把 rawInput、事件和结果卡片接到 UI 回调', async () => {
    const event: RunEvent = { type: 'text_delta', delta: 'review gate updated' };
    const card: CommandResultCard = {
      type: 'status',
      title: '完成声明已提交',
      message: '等待 reviewer 确认。',
      tone: 'info',
    };
    const result: CommandExecutionResult = {
      events: [event],
      card,
    };
    const onCard = vi.fn<(nextCard: CommandResultCard) => void>();
    const onEvents = vi.fn<(events: RunEvent[]) => void>();
    const onOpenRightPanel = vi.fn<() => void>();
    commandClientMocks.execute.mockResolvedValue(result);

    await executeServerCommand({
      command: startWorkReviewCommand,
      currentSessionId: 'session-1',
      gatewayUrl: 'https://gateway.test',
      rawInput: '/start-work-review task-1 confirmed',
      token: 'token-1',
      unavailableTitle: 'start-work review 暂不可用',
      unavailableMessage: '需要先进入一个已有会话。',
      onCard,
      onEvents,
      onOpenRightPanel,
    });

    expect(commandClientMocks.createCommandsClient).toHaveBeenCalledWith('https://gateway.test');
    expect(commandClientMocks.execute).toHaveBeenCalledWith(
      'token-1',
      'session-1',
      'slash-start-work-review',
      { rawInput: '/start-work-review task-1 confirmed' },
    );
    expect(onEvents).toHaveBeenCalledWith([event]);
    expect(onOpenRightPanel).toHaveBeenCalledTimes(1);
    expect(onCard).toHaveBeenCalledWith(card);
  });

  it('压缩命令会先推送本地进行态，再等待后端结果', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    );
    const completedEvent: RunEvent = {
      type: 'compaction',
      summary: '压缩完成',
      trigger: 'manual',
      phase: 'completed',
      runId: 'command:session-1:slash-compact:11111111-1111-4111-8111-111111111111',
      eventId: 'session-1:slash-compact:11111111-1111-4111-8111-111111111111:compaction:completed',
    };
    const onCard = vi.fn<(nextCard: CommandResultCard) => void>();
    const onEvents = vi.fn<(events: RunEvent[]) => void>();
    const onOpenRightPanel = vi.fn<() => void>();
    commandClientMocks.execute.mockResolvedValue({ events: [completedEvent] });

    await executeServerCommand({
      command: compactCommand,
      currentSessionId: 'session-1',
      gatewayUrl: 'https://gateway.test',
      rawInput: '/compact',
      token: 'token-1',
      unavailableTitle: '压缩暂不可用',
      unavailableMessage: '需要先进入一个已有会话。',
      onCard,
      onEvents,
      onOpenRightPanel,
    });

    expect(onOpenRightPanel).toHaveBeenCalledTimes(1);
    expect(commandClientMocks.execute).toHaveBeenCalledWith(
      'token-1',
      'session-1',
      'slash-compact',
      {
        rawInput: '/compact',
        executionId: '11111111-1111-4111-8111-111111111111',
      },
    );
    expect(onEvents).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'compaction',
          phase: 'started',
          runId: 'command:session-1:slash-compact:11111111-1111-4111-8111-111111111111',
          eventId:
            'session-1:slash-compact:11111111-1111-4111-8111-111111111111:compaction:started',
        }),
      ]),
    );
    expect(onEvents).toHaveBeenNthCalledWith(2, [completedEvent]);
  });

  it('压缩命令请求失败时会吞掉异常并回传失败状态', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '22222222-2222-4222-8222-222222222222',
    );
    const onCard = vi.fn<(nextCard: CommandResultCard) => void>();
    const onEvents = vi.fn<(events: RunEvent[]) => void>();
    const onOpenRightPanel = vi.fn<() => void>();
    commandClientMocks.execute.mockRejectedValue(new Error('网络异常，执行命令失败。'));

    await expect(
      executeServerCommand({
        command: compactCommand,
        currentSessionId: 'session-1',
        gatewayUrl: 'https://gateway.test',
        rawInput: '/compact',
        token: 'token-1',
        unavailableTitle: '压缩暂不可用',
        unavailableMessage: '需要先进入一个已有会话。',
        onCard,
        onEvents,
        onOpenRightPanel,
      }),
    ).resolves.toBeUndefined();

    expect(onOpenRightPanel).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'compaction',
          phase: 'failed',
          runId: 'command:session-1:slash-compact:22222222-2222-4222-8222-222222222222',
        }),
      ]),
    );
    expect(onCard).not.toHaveBeenCalled();
  });

  it('没有当前会话时只回传暂不可用卡片且不请求网关', async () => {
    const onCard = vi.fn<(card: CommandResultCard) => void>();
    const onEvents = vi.fn<(events: RunEvent[]) => void>();
    const onOpenRightPanel = vi.fn<() => void>();

    await executeServerCommand({
      command: startWorkDoneCommand,
      currentSessionId: null,
      gatewayUrl: 'https://gateway.test',
      rawInput: '/start-work-done task-1 已完成',
      token: 'token-1',
      unavailableTitle: 'start-work done 暂不可用',
      unavailableMessage: '需要先进入一个已有会话。',
      onCard,
      onEvents,
      onOpenRightPanel,
    });

    expect(commandClientMocks.createCommandsClient).not.toHaveBeenCalled();
    expect(commandClientMocks.execute).not.toHaveBeenCalled();
    expect(onEvents).not.toHaveBeenCalled();
    expect(onOpenRightPanel).not.toHaveBeenCalled();
    expect(onCard).toHaveBeenCalledWith({
      type: 'status',
      title: 'start-work done 暂不可用',
      message: '需要先进入一个已有会话。',
      tone: 'warning',
    });
  });
});
