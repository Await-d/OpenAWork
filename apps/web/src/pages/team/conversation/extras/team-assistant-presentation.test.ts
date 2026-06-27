import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { buildTeamAssistantPresentation } from './team-assistant-presentation.js';

describe('buildTeamAssistantPresentation', () => {
  it('提取下一步并把它从正文里剥离出来', () => {
    const message: ChatMessage = {
      id: 'm-1',
      role: 'assistant',
      content: '已完成 API 方案收敛。\n\n下一步：由 PM2 安排执行层开始落地。',
    };

    const result = buildTeamAssistantPresentation(message);
    expect(result.detailText).toContain('已完成 API 方案收敛');
    expect(result.detailText).not.toContain('下一步：');
    expect(result.nextStep).toBe('由 PM2 安排执行层开始落地。');
  });

  it('从 assistant trace 中统计思考、读取和文件触达过程', () => {
    const message: ChatMessage = {
      id: 'm-2',
      role: 'assistant',
      content: '已确认问题根因。',
      parts: [
        { id: 'r1', type: 'reasoning', text: '先判断入口路由' },
        { id: 'r2', type: 'reasoning', text: '再确认工具调用是否应该下沉' },
        {
          id: 't1',
          type: 'tool',
          toolCallId: 'tool-read',
          toolName: 'read',
          input: { filePath: 'apps/web/src/pages/team/conversation/TeamConversationView.tsx' },
          status: 'completed',
        },
        {
          id: 't2',
          type: 'tool',
          toolCallId: 'tool-grep',
          toolName: 'grep',
          input: { pattern: 'renderChatMessageContentWithOptions' },
          status: 'completed',
        },
        {
          id: 't3',
          type: 'tool',
          toolCallId: 'tool-write',
          toolName: 'write',
          input: { filePath: 'apps/web/src/pages/team/conversation/TeamConversationView.tsx' },
          status: 'completed',
        },
      ],
      modifiedFilesSummary: {
        type: 'modified_files_summary',
        title: '本轮改动',
        summary: '更新了 team 对话展示',
        files: [
          {
            file: 'apps/web/src/pages/team/conversation/TeamConversationView.tsx',
            before: 'const before = true;',
            after: 'const after = true;',
            status: 'modified',
            additions: 10,
            deletions: 3,
          },
        ],
      },
    };

    const result = buildTeamAssistantPresentation(message);
    expect(result.stats.reasoningCount).toBe(2);
    expect(result.stats.toolCallCount).toBe(3);
    expect(result.stats.readLikeToolCount).toBe(2);
    expect(result.stats.modifiedFileCount).toBe(1);
    expect(result.processSummary).toContain('思考 2 段');
    expect(result.processSummary).toContain('读取上下文 2 次');
    expect(result.toolSummaries[0]).toContain('读取');
    expect(result.modifiedFiles[0]).toContain('TeamConversationView.tsx');
  });

  it('历史工具卡消息也会被折叠为 team 可读摘要，而不是直接暴露原始卡片内容', () => {
    const message: ChatMessage = {
      id: 'm-3',
      role: 'assistant',
      content: [
        '工具：read',
        '类型：tool',
        '状态：completed',
        '摘要：读取文件',
        '',
        '输入',
        '{"filePath":"apps/web/src/pages/team/conversation/TeamConversationView.tsx"}',
      ].join('\n'),
    };

    const result = buildTeamAssistantPresentation(message);
    expect(result.summaryText).toContain('已完成处理步骤');
    expect(result.summaryText).toContain('读取相关上下文');
    expect(result.summaryText).not.toContain('TeamConversationView.tsx');
    expect(result.toolSummaries).toEqual(
      expect.arrayContaining(['读取 …/team/conversation/TeamConversationView.tsx']),
    );
    expect(result.stats.toolCallCount).toBe(1);
    expect(result.stats.readLikeToolCount).toBe(1);
  });

  it('会清洗内联 thinking 标签，并折叠连续重复的思考片段', () => {
    const repeatedThinking =
      'Good, the tech selection report was written successfully. Now I need to write the roles and workflow spec.';
    const message: ChatMessage = {
      id: 'm-4',
      role: 'assistant',
      content: [
        `<thinking>${repeatedThinking}</thinking>`,
        `<thinking>${repeatedThinking}</thinking>`,
        '已完成技术选型报告，接下来整理角色分工与协作流程说明。',
      ].join(' '),
    };

    const result = buildTeamAssistantPresentation(message);
    expect(result.summaryText).not.toContain('<thinking>');
    expect(result.summaryText).not.toContain('</thinking>');
    expect(result.summaryText.match(/Good, the tech selection report/g)?.length ?? 0).toBe(1);
    expect(result.summaryText).toContain('已完成技术选型报告');
  });

  it('会忽略空的 thinking 标签块', () => {
    const message: ChatMessage = {
      id: 'm-5',
      role: 'assistant',
      content: '<thinking>   </thinking>\n\n最终结论：保留当前实现，先补角色与流程规范。',
    };

    const result = buildTeamAssistantPresentation(message);
    expect(result.summaryText).toBe('最终结论：保留当前实现，先补角色与流程规范。');
  });
});
