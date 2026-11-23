/**
 * Verifies the `always_json` column on `permission_requests` is parsed and
 * surfaced as `always: string[]` on every API/event boundary the frontend
 * actually consumes. Without this passthrough, the redesigned
 * `PermissionPrompt` cannot show the broad-approval chips and the user
 * keeps clicking "本会话允许" without understanding what it actually
 * widens to.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapPermissionRequestRow,
  parseApprovedPermissionResumePayload,
  parsePermissionAlwaysJson,
  parsePermissionRequestClientRequestId,
} from '../../permission/permission-contract.js';

import { createPermissionAskedEvent } from '../../session/session-permission-events.js';

afterEach(() => vi.restoreAllMocks());

describe('parsePermissionAlwaysJson', () => {
  it('parses a valid JSON array of patterns', () => {
    expect(parsePermissionAlwaysJson('["ls *", "git status"]')).toEqual(['ls *', 'git status']);
  });

  it('returns [] on null / missing json so callers must supply an explicit fallback', () => {
    expect(parsePermissionAlwaysJson(null)).toEqual([]);
  });

  it('returns [] on malformed json so corrupted rows do not silently widen approval', () => {
    expect(parsePermissionAlwaysJson('{')).toEqual([]);
    expect(parsePermissionAlwaysJson('"ls *"')).toEqual([]);
    expect(parsePermissionAlwaysJson('null')).toEqual([]);
  });

  it('filters non-string and empty entries', () => {
    // JSON.parse will yield mixed array; only non-empty strings should survive.
    expect(parsePermissionAlwaysJson('["ls *", 42, "", null, "git *"]')).toEqual(['ls *', 'git *']);
  });
});

describe('权限解析失败日志', () => {
  it.each([
    { operation: 'always', parse: parsePermissionAlwaysJson, fallback: [] },
    { operation: 'resume', parse: parseApprovedPermissionResumePayload, fallback: null },
    {
      operation: 'client-request-id',
      parse: parsePermissionRequestClientRequestId,
      fallback: null,
    },
  ])('$operation 保留降级返回且不记录原文或解析器回显', ({ operation, parse, fallback }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raw = '{"token":"private-credential","message":"private-user-content"';

    expect(parse(raw)).toEqual(fallback);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[permission-contract] invalid permission JSON', {
      operation,
      rawLength: raw.length,
      errorType: 'syntax',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-');
  });
});

describe('mapPermissionRequestRow always passthrough', () => {
  const baseRow = {
    id: 'req-1',
    session_id: 'sess-1',
    tool_name: 'bash',
    scope: 'ls -la',
    reason: '需要执行工作区命令',
    risk_level: 'high' as const,
    preview_action: '执行命令: ls -la',
    status: 'pending' as const,
    decision: null,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  it('exposes parsed always patterns on the API row', () => {
    const mapped = mapPermissionRequestRow({
      ...baseRow,
      always_json: '["ls *"]',
    });
    expect(mapped?.always).toEqual(['ls *']);
  });

  it('omits the field when always_json is missing so old clients keep working', () => {
    const mapped = mapPermissionRequestRow({ ...baseRow, always_json: null });
    expect(mapped?.always).toBeUndefined();
  });

  it('omits the field when always_json is malformed (no silent widening)', () => {
    const mapped = mapPermissionRequestRow({ ...baseRow, always_json: '{' });
    expect(mapped?.always).toBeUndefined();
  });
});

describe('createPermissionAskedEvent always passthrough', () => {
  it('includes the always array when patterns are present', () => {
    const event = createPermissionAskedEvent({
      requestId: 'req-1',
      toolName: 'bash',
      scope: 'ls -la',
      reason: '需要执行工作区命令',
      riskLevel: 'high',
      previewAction: '执行命令: ls -la',
      always: ['ls *'],
    });
    expect(event.always).toEqual(['ls *']);
  });

  it('omits the always array when no patterns are supplied so legacy events stay compact', () => {
    const event = createPermissionAskedEvent({
      requestId: 'req-1',
      toolName: 'bash',
      scope: 'ls -la',
      reason: '需要执行工作区命令',
      riskLevel: 'high',
    });
    expect(event.always).toBeUndefined();
  });
});
