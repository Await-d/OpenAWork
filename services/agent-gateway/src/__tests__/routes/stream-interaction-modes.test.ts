/**
 * `/stream` 请求级权限档位解析回归。
 *
 * 解析优先级：请求 permissionMode（规范键） > 请求 yoloMode（旧布尔） > 会话 metadata
 * 经 resolveSessionPermissionMode 解析出的档位。仅带布尔 yoloMode 的历史会话行为不变。
 */
import { describe, expect, it } from 'vitest';
import {
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  buildTwoPartSystemPrompts,
} from '../../routes/stream-system-prompts.js';
import {
  resolveStreamInteractionModes,
  streamRequestSchema,
  type StreamRequest,
} from '../../routes/stream.js';

function buildRequest(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return streamRequestSchema.parse({
    clientRequestId: 'req-permission-mode',
    message: 'hello',
    ...overrides,
  });
}

describe('resolveStreamInteractionModes · 权限档位解析', () => {
  it('metadata 为 auto-edit 时不解析为 yolo', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ permissionMode: 'auto-edit' }),
      requestData: buildRequest(),
    });
    expect(modes.yoloMode).toBe(false);
  });

  it('metadata 为 yolo 档位时解析为 yolo', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ permissionMode: 'yolo' }),
      requestData: buildRequest(),
    });
    expect(modes.yoloMode).toBe(true);
  });

  it('持久化仅带 {yoloMode:true} 的历史会话仍解析为 yolo', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ yoloMode: true }),
      requestData: buildRequest(),
    });
    expect(modes.yoloMode).toBe(true);
  });

  it('metadata 两个键都缺席时解析为 ask（非 yolo）', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({}),
      requestData: buildRequest(),
    });
    expect(modes.yoloMode).toBe(false);
  });

  it('请求级 permissionMode:yolo 覆盖 metadata 的 ask', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ permissionMode: 'ask' }),
      requestData: buildRequest({ permissionMode: 'yolo' }),
    });
    expect(modes.yoloMode).toBe(true);
  });

  it('请求级 permissionMode:ask 覆盖 metadata 的 yolo', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ yoloMode: true }),
      requestData: buildRequest({ permissionMode: 'ask' }),
    });
    expect(modes.yoloMode).toBe(false);
  });

  it('请求级布尔 yoloMode 仍按覆盖生效（true 覆盖 ask）', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({}),
      requestData: buildRequest({ yoloMode: true }),
    });
    expect(modes.yoloMode).toBe(true);
  });

  it('请求级布尔 yoloMode:false 仍可关闭 metadata 的 yolo', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ yoloMode: true }),
      requestData: buildRequest({ yoloMode: false }),
    });
    expect(modes.yoloMode).toBe(false);
  });
});

describe('streamRequestSchema · 权限档位字段', () => {
  it('未指定输出额度时不注入 2048，保留显式额度', () => {
    expect(buildRequest().maxTokens).toBeUndefined();
    expect(buildRequest({ maxTokens: 4096 }).maxTokens).toBe(4096);
  });

  it('接受 permissionMode 并保留旧布尔字段', () => {
    const parsed = streamRequestSchema.parse({
      clientRequestId: 'req-permission-mode',
      message: 'hello',
      permissionMode: 'auto-edit',
      yoloMode: 'true',
    });
    expect(parsed.permissionMode).toBe('auto-edit');
    expect(parsed.yoloMode).toBe(true);
  });

  it('拒绝非法 permissionMode', () => {
    const result = streamRequestSchema.safeParse({
      clientRequestId: 'req-permission-mode',
      message: 'hello',
      permissionMode: 'bogus',
    });
    expect(result.success).toBe(false);
  });
});

describe('resolveStreamInteractionModes · 对话模式解析', () => {
  it('请求级 dialogueMode 覆盖会话 metadata 的 clarify', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ dialogueMode: 'clarify' }),
      requestData: buildRequest({ dialogueMode: 'coding' }),
    });

    expect(modes.dialogueMode).toBe('coding');
  });

  it('无请求级覆盖时沿用 metadata 的 clarify（grill / 澄清轮次行为不变）', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({ dialogueMode: 'clarify' }),
      requestData: buildRequest(),
    });

    expect(modes.dialogueMode).toBe('clarify');
  });

  it('metadata 与请求都未指定时保持未指定', () => {
    const modes = resolveStreamInteractionModes({
      metadataJson: JSON.stringify({}),
      requestData: buildRequest(),
    });

    expect(modes.dialogueMode).toBeUndefined();
  });

  it('接受 programmer 并拒绝枚举外取值', () => {
    expect(buildRequest({ dialogueMode: 'programmer' }).dialogueMode).toBe('programmer');
    expect(
      streamRequestSchema.safeParse({
        clientRequestId: 'req-dialogue-mode',
        message: 'hello',
        dialogueMode: 'bogus',
      }).success,
    ).toBe(false);
  });
});

/**
 * reception direct / light 轮的生命周期：router 已判定"前台轻量承接"，本轮通过
 * 请求级 `dialogueMode: 'coding'` 覆盖 reception 会话持久态的 clarify；而 grill /
 * 澄清轮次不带覆盖，仍解析到 clarify。这里按生产同源的方式（`stream.ts` 选取
 * `DIALOGUE_MODE_SYSTEM_PROMPTS[mode]`，`stream-model-round.ts` 交给
 * `buildTwoPartSystemPrompts`）拼出该轮实际注入的 stable 提示词并断言内容。
 */
describe('reception 轮次的有效提示词注入', () => {
  const RECEPTION_METADATA = JSON.stringify({ dialogueMode: 'clarify' });

  function composeStablePrompt(requestData: StreamRequest): string {
    const modes = resolveStreamInteractionModes({
      metadataJson: RECEPTION_METADATA,
      requestData,
    });
    return buildTwoPartSystemPrompts({
      workspaceCtx: null,
      dialogueModePrompt:
        modes.dialogueMode !== undefined ? DIALOGUE_MODE_SYSTEM_PROMPTS[modes.dialogueMode] : null,
    }).stable;
  }

  it('direct / light 轮不再注入澄清人设与 __grill_confirm__ 确认门控', () => {
    const stable = composeStablePrompt(buildRequest({ dialogueMode: 'coding' }));

    expect(stable).not.toContain('需求澄清助手');
    expect(stable).not.toContain('多轮提问');
    expect(stable).not.toContain('__grill_confirm__');
  });

  it('grill / 澄清轮（无请求级覆盖）仍注入澄清人设与确认门控', () => {
    const stable = composeStablePrompt(buildRequest());

    expect(stable).toContain('需求澄清助手');
    expect(stable).toContain('多轮提问');
    expect(stable).toContain('__grill_confirm__');
  });
});
