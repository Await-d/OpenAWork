import { describe, expect, it } from 'vitest';
import {
  AUTO_EDIT_EXCLUDED_TOOLS,
  AUTO_EDIT_PERMISSION_CATEGORIES,
  resolveSessionPermissionMode,
  type SessionPermissionMode,
} from './session-permission-mode.js';

describe('resolveSessionPermissionMode', () => {
  it('metadata 为空对象时回退到保守档位 ask', () => {
    expect(resolveSessionPermissionMode({})).toBe('ask');
  });

  it('历史字段 yoloMode 严格等于 true 时回退到 yolo', () => {
    expect(resolveSessionPermissionMode({ yoloMode: true })).toBe('yolo');
  });

  it('yoloMode 为 false 时回退到 ask', () => {
    expect(resolveSessionPermissionMode({ yoloMode: false })).toBe('ask');
  });

  it('显式 permissionMode 枚举的三个合法取值均按原样返回', () => {
    expect(resolveSessionPermissionMode({ permissionMode: 'ask' })).toBe('ask');
    expect(resolveSessionPermissionMode({ permissionMode: 'auto-edit' })).toBe('auto-edit');
    expect(resolveSessionPermissionMode({ permissionMode: 'yolo' })).toBe('yolo');
  });

  it('合法枚举优先于过期的 yoloMode 布尔值', () => {
    expect(resolveSessionPermissionMode({ permissionMode: 'auto-edit', yoloMode: true })).toBe(
      'auto-edit',
    );
  });

  it('非法枚举被忽略，回退到 yoloMode 布尔值', () => {
    expect(resolveSessionPermissionMode({ permissionMode: 'bogus', yoloMode: true })).toBe('yolo');
  });

  it('对错误类型的 permissionMode 保持严格，回退到 ask', () => {
    expect(resolveSessionPermissionMode({ permissionMode: 42 })).toBe('ask');
    expect(resolveSessionPermissionMode({ permissionMode: null })).toBe('ask');
    expect(resolveSessionPermissionMode({ permissionMode: 'YOLO' })).toBe('ask');
    expect(resolveSessionPermissionMode({ permissionMode: ['yolo'] })).toBe('ask');
    expect(resolveSessionPermissionMode({ permissionMode: { mode: 'yolo' } })).toBe('ask');
  });

  it('只有严格的布尔 true 才算 yolo，其余取值均回退 ask', () => {
    expect(resolveSessionPermissionMode({ yoloMode: 'true' })).toBe('ask');
    expect(resolveSessionPermissionMode({ yoloMode: 1 })).toBe('ask');
    expect(resolveSessionPermissionMode({ yoloMode: null })).toBe('ask');
  });

  it('混杂未知字段时仍以 ask 兜底且不抛异常', () => {
    expect(
      resolveSessionPermissionMode({ permissionMode: undefined, yoloMode: false, extra: {} }),
    ).toBe('ask');
  });

  it('返回值收敛为 SessionPermissionMode 联合类型', () => {
    const mode: SessionPermissionMode = resolveSessionPermissionMode({});
    expect(mode).toBe('ask');
  });

  it('纯函数：重复调用不修改入参', () => {
    const metadata = { permissionMode: 'bogus', yoloMode: true, nested: { a: 1 } };
    const snapshot = structuredClone(metadata);

    expect(resolveSessionPermissionMode(metadata)).toBe('yolo');
    expect(resolveSessionPermissionMode(metadata)).toBe('yolo');
    expect(metadata).toEqual(snapshot);
  });
});

describe('AUTO_EDIT_PERMISSION_CATEGORIES', () => {
  it('恰好包含 edit 与 write 两个权限类别', () => {
    expect(AUTO_EDIT_PERMISSION_CATEGORIES.size).toBe(2);
    expect(AUTO_EDIT_PERMISSION_CATEGORIES.has('edit')).toBe(true);
    expect(AUTO_EDIT_PERMISSION_CATEGORIES.has('write')).toBe(true);
  });
});

describe('AUTO_EDIT_EXCLUDED_TOOLS', () => {
  it('恰好包含 workspace_review_revert 一个豁免工具', () => {
    expect(AUTO_EDIT_EXCLUDED_TOOLS.size).toBe(1);
    expect(AUTO_EDIT_EXCLUDED_TOOLS.has('workspace_review_revert')).toBe(true);
  });
});
