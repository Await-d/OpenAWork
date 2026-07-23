import { describe, expect, it } from 'vitest';
import { bottomNavContentInset, bottomNavOccupiedHeight, shouldShowBottomNav } from './metrics';

describe('shouldShowBottomNav', () => {
  it('主 Tab 页显示底栏', () => {
    expect(shouldShowBottomNav('/sessions')).toBe(true);
    expect(shouldShowBottomNav('/home')).toBe(true);
    expect(shouldShowBottomNav('/settings')).toBe(true);
    expect(shouldShowBottomNav('/settings/mcp')).toBe(true);
    expect(shouldShowBottomNav('/settings/usage')).toBe(true);
    expect(shouldShowBottomNav('/settings/memory')).toBe(true);
  });

  it('聊天详情与连接/登录流程隐藏底栏', () => {
    expect(shouldShowBottomNav('/chat/abc')).toBe(false);
    expect(shouldShowBottomNav('/chat')).toBe(false);
    expect(shouldShowBottomNav('/connection')).toBe(false);
    expect(shouldShowBottomNav('/login')).toBe(false);
    expect(shouldShowBottomNav('/onboarding/gateway')).toBe(false);
    expect(shouldShowBottomNav('/sessions/new')).toBe(false);
  });
});

describe('bottomNavOccupiedHeight', () => {
  it('至少包含 pill + outer margin + 最小 home inset', () => {
    expect(bottomNavOccupiedHeight(0)).toBe(60 + 16 + 8);
    expect(bottomNavOccupiedHeight(34)).toBe(60 + 16 + 34);
  });

  it('content inset 额外留出 gap', () => {
    expect(bottomNavContentInset(0)).toBe(bottomNavOccupiedHeight(0) + 12);
  });
});
