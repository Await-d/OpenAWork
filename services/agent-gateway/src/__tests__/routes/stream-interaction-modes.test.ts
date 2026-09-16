/**
 * `/stream` 请求级权限档位解析回归。
 *
 * 解析优先级：请求 permissionMode（规范键） > 请求 yoloMode（旧布尔） > 会话 metadata
 * 经 resolveSessionPermissionMode 解析出的档位。仅带布尔 yoloMode 的历史会话行为不变。
 */
import { describe, expect, it } from 'vitest';
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
