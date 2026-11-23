import type {
  DispatchDetail,
  DispatchDraftEdit,
  DispatchDraftInput,
  DispatchItemAction,
  DispatchList,
} from '@openAwork/shared';
import { authHeader, expectJson, fetchWithTimeout, jsonAuthHeaders } from '../gateway/http.js';

export interface DispatchesClient {
  list(token: string, cursor?: string, signal?: AbortSignal): Promise<DispatchList>;
  detail(token: string, id: string, signal?: AbortSignal): Promise<DispatchDetail>;
  createDraft(token: string, input: DispatchDraftInput): Promise<DispatchDetail>;
  editDraft(token: string, id: string, input: DispatchDraftEdit): Promise<DispatchDetail>;
  confirm(token: string, id: string, revision: number): Promise<DispatchDetail>;
  act(
    token: string,
    id: string,
    itemId: string,
    action: DispatchItemAction,
  ): Promise<DispatchDetail>;
}

export function createDispatchesClient(gatewayUrl: string): DispatchesClient {
  const root = `${gatewayUrl.replace(/\/$/, '')}/dispatch-assistant`;
  const detailUrl = (id: string) => `${root}/${encodeURIComponent(id)}`;

  async function read<T>(url: string, token: string, label: string, signal?: AbortSignal) {
    return expectJson<T>(
      await fetchWithTimeout(url, { headers: authHeader(token), signal }),
      label,
    );
  }

  async function write(
    url: string,
    token: string,
    method: 'POST' | 'PATCH',
    body: object,
    label: string,
    timeoutMs?: number,
  ) {
    return expectJson<DispatchDetail>(
      await fetchWithTimeout(url, {
        method,
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(body),
        timeoutMs,
      }),
      label,
    );
  }

  return {
    list: (token, cursor, signal) =>
      read<DispatchList>(
        cursor ? `${root}?${new URLSearchParams({ cursor })}` : root,
        token,
        '读取派工记录',
        signal,
      ),
    detail: (token, id, signal) =>
      read<DispatchDetail>(detailUrl(id), token, '读取派工详情', signal),
    createDraft: (token, input) =>
      write(`${root}/drafts`, token, 'POST', input, '生成派工草稿', 120_000),
    editDraft: (token, id, input) =>
      write(`${detailUrl(id)}/draft`, token, 'PATCH', input, '保存派工草稿'),
    confirm: (token, id, revision) =>
      write(`${detailUrl(id)}/confirm`, token, 'POST', { revision }, '确认派工'),
    act(token, id, itemId, action) {
      const { kind, expectedAttemptId } = action;
      const body =
        kind === 'follow-up'
          ? { expectedAttemptId, question: action.question }
          : { expectedAttemptId };
      return write(
        `${detailUrl(id)}/items/${encodeURIComponent(itemId)}/${kind}`,
        token,
        'POST',
        body,
        '更新派工事项',
      );
    },
  };
}
