import { describe, expect, it } from 'vitest';

import { buildDelegatedChildClientRequestId } from '../../tools/call-omo-agent-output.js';

const MAX_CLIENT_REQUEST_ID_LENGTH = 128;

const ROOT_CLIENT_REQUEST_ID = 'req_01234567-89ab-cdef-0123-456789abcdef';
const SESSION_IDS = [
  'session_01234567-89ab-cdef-0123-456789abcdef',
  'session_fedcba98-7654-3210-fedc-ba9876543210',
  'session_11111111-2222-3333-4444-555555555555',
  'session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
] as const;

describe('buildDelegatedChildClientRequestId', () => {
  it('对短输入返回与历史完全一致的 legacy 格式', () => {
    expect(
      buildDelegatedChildClientRequestId({
        childSessionId: 'child-session-1',
        parentClientRequestId: 'parent-request-1',
      }),
    ).toBe('task:parent-request-1:child:child-session-1');

    expect(
      buildDelegatedChildClientRequestId({
        childSessionId: 'child-session-2',
      }),
    ).toBe('task:child:child:child-session-2');
  });

  it('对长度恰好 128 的输入保留 legacy 格式', () => {
    const legacyPrefix = 'task:child:child:';
    const childSessionId = 'c'.repeat(MAX_CLIENT_REQUEST_ID_LENGTH - legacyPrefix.length);
    const id = buildDelegatedChildClientRequestId({ childSessionId });

    expect(id).toBe(`${legacyPrefix}${childSessionId}`);
    expect(id.length).toBe(MAX_CLIENT_REQUEST_ID_LENGTH);
  });

  it('嵌套 depth 2 / depth 3 链路的 id 均不超过 128 字符', () => {
    const depth1 = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[0],
      parentClientRequestId: ROOT_CLIENT_REQUEST_ID,
    });
    const depth2 = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[1],
      parentClientRequestId: depth1,
    });
    const depth3 = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[2],
      parentClientRequestId: depth2,
    });
    const depth4 = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[3],
      parentClientRequestId: depth3,
    });

    expect(depth1).toBe(`task:${ROOT_CLIENT_REQUEST_ID}:child:${SESSION_IDS[0]}`);
    for (const id of [depth1, depth2, depth3, depth4]) {
      expect(id.length).toBeLessThanOrEqual(MAX_CLIENT_REQUEST_ID_LENGTH);
    }
    expect(depth2).not.toBe(`task:${depth1}:child:${SESSION_IDS[1]}`);
  });

  it('对超长 childSessionId 也保证不超过 128 字符', () => {
    const id = buildDelegatedChildClientRequestId({
      childSessionId: 'child'.repeat(200),
      parentClientRequestId: 'parent'.repeat(50),
    });

    expect(id.length).toBeLessThanOrEqual(MAX_CLIENT_REQUEST_ID_LENGTH);
    expect(id.startsWith('task:')).toBe(true);
    expect(id).toContain(':child:');
  });

  it('相同输入重复调用结果完全一致', () => {
    const input = {
      childSessionId: SESSION_IDS[1],
      parentClientRequestId: buildDelegatedChildClientRequestId({
        childSessionId: SESSION_IDS[0],
        parentClientRequestId: ROOT_CLIENT_REQUEST_ID,
      }),
    };

    const first = buildDelegatedChildClientRequestId(input);
    const second = buildDelegatedChildClientRequestId(input);
    const third = buildDelegatedChildClientRequestId({ ...input });

    expect(first).toBe(second);
    expect(first).toBe(third);
  });

  it('不同 parent 产生不同 id，不同 child 也产生不同 id', () => {
    const childSessionId = SESSION_IDS[0];
    const parentA = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[1],
      parentClientRequestId: ROOT_CLIENT_REQUEST_ID,
    });
    const parentB = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[2],
      parentClientRequestId: ROOT_CLIENT_REQUEST_ID,
    });

    const idA = buildDelegatedChildClientRequestId({
      childSessionId,
      parentClientRequestId: parentA,
    });
    const idB = buildDelegatedChildClientRequestId({
      childSessionId,
      parentClientRequestId: parentB,
    });
    const idC = buildDelegatedChildClientRequestId({
      childSessionId: SESSION_IDS[3],
      parentClientRequestId: parentA,
    });

    expect(idA).not.toBe(idB);
    expect(idA).not.toBe(idC);
    for (const id of [idA, idB, idC]) {
      expect(id.length).toBeLessThanOrEqual(MAX_CLIENT_REQUEST_ID_LENGTH);
    }
  });
});
