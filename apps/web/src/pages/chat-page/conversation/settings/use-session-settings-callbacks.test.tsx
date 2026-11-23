// @vitest-environment jsdom
/**
 * useSessionSettingsCallbacks —— 来源会话（渠道 / 定时任务）的 metadata 写入豁免。
 *
 * 覆盖要点：这些会话本就没有对话模式，`buildSessionMetadata` 必须**省略** `dialogueMode`。
 * 修复前它无条件带上该键，于是在渠道会话里改任意设置都会把界面上的默认模式落库；
 * 一旦落成 `clarify`，网关的澄清只读白名单会把渠道回复工具整套过滤掉，渠道侧失能。
 */

import { cleanup, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSessionSettingsCallbacks } from './use-session-settings-callbacks.js';

const GATEWAY = 'https://gw.test';
const TOKEN = 'tok-fake';

function useHarness(isSourceManaged: boolean) {
  const [dialogueMode, setDialogueMode] = useState<'clarify' | 'coding' | 'programmer'>('coding');
  const sessionMetadataDirtyRef = useRef(false);
  const [sessionMetadataDirty, setSessionMetadataDirty] = useState(false);

  const settings = useSessionSettingsCallbacks(
    {
      dialogueMode,
      isSourceManagedSession: isSourceManaged,
      permissionMode: 'auto-edit',
      webSearchEnabled: true,
      thinkingEnabled: false,
      reasoningEffort: 'medium',
      activeProviderId: 'provider-1',
      activeModelId: 'model-1',
      modelSelectionSourceRef: { current: null },
      manualAgentId: '',
      effectiveWorkingDirectory: null,
      sessionMetadataDirty,
      sessionMetadataDirtyRef,
    },
    {
      setDialogueMode,
      setPermissionMode: () => undefined,
      setWebSearchEnabled: () => undefined,
      setThinkingEnabled: () => undefined,
      setReasoningEffort: () => undefined,
      setContextWindowOverride: () => undefined,
      setManualAgentId: () => undefined,
      setSessionMetadataDirty,
    },
    GATEWAY,
    TOKEN,
  );

  return { settings, dialogueMode };
}

afterEach(() => {
  cleanup();
});

describe('buildSessionMetadata — 来源会话豁免 dialogueMode', () => {
  it('普通会话仍写入 dialogueMode', () => {
    const { result } = renderHook(() => useHarness(false));

    expect(result.current.settings.buildSessionMetadata()['dialogueMode']).toBe('coding');
    // 同一份 payload 的其它字段不受影响。
    expect(result.current.settings.buildSessionMetadata()['permissionMode']).toBe('auto-edit');
  });

  it('来源会话（渠道 / 定时任务）不写入 dialogueMode', () => {
    const { result } = renderHook(() => useHarness(true));

    const metadata = result.current.settings.buildSessionMetadata();
    expect(Object.hasOwn(metadata, 'dialogueMode')).toBe(false);
    // 除该键外其余字段照常写入：豁免是字段级的，不是整条 metadata 不写。
    expect(metadata['permissionMode']).toBe('auto-edit');
    expect(metadata['yoloMode']).toBe(false);
    expect(metadata['providerId']).toBe('provider-1');
    expect(metadata['modelId']).toBe('model-1');
    expect(metadata['agentId']).toBeNull();
  });
});
