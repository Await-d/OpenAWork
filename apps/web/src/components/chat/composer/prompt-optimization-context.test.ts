import { describe, expect, it } from 'vitest';
import { buildPromptOptimizationContext } from './prompt-optimization-context.js';

describe('buildPromptOptimizationContext', () => {
  it('输出当前输入环境的关键优化上下文', () => {
    const context = buildPromptOptimizationContext({
      dialogueMode: 'coding',
      providerId: 'openai',
      providerType: 'openai',
      modelId: 'gpt-5-mini',
      input: '请使用 /help 并结合 @README.md 优化当前任务',
      imageGenerationMode: false,
      webSearchEnabled: true,
      thinkingEnabled: true,
      reasoningEffort: 'high',
      attachmentCount: 2,
      hasAgentOverride: true,
      hasSlashCommands: true,
      hasMentions: true,
      hasSelectedImageReference: false,
    });

    expect(context).toContain('AI 对话输入优化');
    expect(context).toContain('标准聊天提示词');
    expect(context).toContain('对话模式：代码协作');
    expect(context).toContain('openai / gpt-5-mini');
    expect(context).toContain('联网搜索：开启');
    expect(context).toContain('思考模式：开启（高）');
    expect(context).toContain('代理协作：已指定 Agent');
    expect(context).toContain('附件数量：2');
    expect(context).toContain('可用输入辅助：/ 命令、@ 文件');
    expect(context).toContain('当前草稿已显式使用：/ 命令、@ 文件');
  });

  it('在缺少可选字段时回退到稳定文案', () => {
    const context = buildPromptOptimizationContext({
      dialogueMode: 'clarify',
      providerId: 'custom-provider',
      modelId: 'custom-model',
      input: '请生成一张带透明背景的产品图',
      imageGenerationMode: true,
      imageGenerationSize: '1024x1024',
      imageGenerationQuality: 'medium',
      imageGenerationOutputFormat: 'png',
      imageGenerationBackground: 'transparent',
      webSearchEnabled: false,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
      attachmentCount: 0,
      hasAgentOverride: false,
      hasSlashCommands: false,
      hasMentions: false,
      hasSelectedImageReference: true,
    });

    expect(context).toContain('目标场景：图片生成提示词');
    expect(context).toContain('对话模式：需求澄清');
    expect(context).toContain('当前模型：custom-provider / custom-model');
    expect(context).toContain('联网搜索：关闭');
    expect(context).toContain('思考模式：关闭');
    expect(context).toContain('代理协作：跟随默认 Agent');
    expect(context).toContain('出图参数：1024x1024 / medium / png / transparent');
    expect(context).toContain('参考图片：已选择');
    expect(context).not.toContain('可用输入辅助：');
  });
});
