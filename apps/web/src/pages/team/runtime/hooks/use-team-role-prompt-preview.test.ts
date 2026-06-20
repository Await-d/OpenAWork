// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import {
  mapTeamLayerToSoulLayer,
  useTeamRolePromptPreview,
} from './use-team-role-prompt-preview.js';

const GATEWAY_URL = 'https://gw.test';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: GATEWAY_URL,
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    accessToken: null,
    email: null,
    gatewayUrl: 'http://localhost:3000',
    refreshToken: null,
    tokenExpiresAt: null,
  });
});

describe('mapTeamLayerToSoulLayer', () => {
  it('5 个有 SOUL 的层级原样映射', () => {
    expect(mapTeamLayerToSoulLayer('reception')).toBe('reception');
    expect(mapTeamLayerToSoulLayer('pm1')).toBe('pm1');
    expect(mapTeamLayerToSoulLayer('pm2')).toBe('pm2');
    expect(mapTeamLayerToSoulLayer('executor')).toBe('executor');
    expect(mapTeamLayerToSoulLayer('reviewer')).toBe('reviewer');
  });

  it('user / tester 无独立 SOUL，返回 null', () => {
    expect(mapTeamLayerToSoulLayer('user')).toBeNull();
    expect(mapTeamLayerToSoulLayer('tester')).toBeNull();
  });
});

describe('useTeamRolePromptPreview', () => {
  it('layer=null 时不发请求且 supported=false', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useTeamRolePromptPreview({ layer: null }));
    expect(result.current.supported).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('不支持的层（tester）supported=false 且不发请求', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useTeamRolePromptPreview({ layer: 'tester' }));
    expect(result.current.supported).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('支持的层拉取 persona + 指令栈预览', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);
      if (url.includes('/layer-capabilities')) {
        return jsonResponse({
          layers: [
            {
              layer: 'executor',
              adapterDisplayName: '执行（默认）',
              agentImplKey: 'executor',
              toolsetCategories: [
                { id: 'read', label: '读取', description: '文件读取', defaultEnabled: true },
              ],
              canHandoffTo: [],
              canWriteArtifactPhases: ['implementation'],
              allowedBuiltinInstructions: ['submit_patch'],
              terminal: true,
            },
          ],
        });
      }
      if (url.includes('/persona')) {
        return jsonResponse({
          roleLayer: 'executor',
          key: 'default',
          persona: null,
          effective: { soulMd: '# 执行 SOUL', isDefault: true },
        });
      }
      if (url.includes('/instruction-stack') || url.includes('preview')) {
        return jsonResponse({
          stableBlock: 'STABLE BLOCK CONTENT',
          estimatedTokens: 1234,
          oversize: false,
          layers: {
            agentsMd: true,
            architectureMd: false,
            constitution: true,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: true,
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() =>
      useTeamRolePromptPreview({ layer: 'executor', teamWorkspaceId: 'ws-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.supported).toBe(true);
    expect(result.current.persona?.effective.soulMd).toBe('# 执行 SOUL');
    expect(result.current.instructionStack?.stableBlock).toBe('STABLE BLOCK CONTENT');
    expect(result.current.instructionStack?.estimatedTokens).toBe(1234);
    expect(result.current.capability?.adapterDisplayName).toBe('执行（默认）');
    expect(result.current.capability?.terminal).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('enabled=false 时不发请求', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderHook(() => useTeamRolePromptPreview({ layer: 'executor', enabled: false }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
