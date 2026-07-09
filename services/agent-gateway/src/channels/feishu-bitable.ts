import { channelFetch } from './channel-http.js';
import { FEISHU_API } from './feishu-api-types.js';
import type { FeishuAuthContext } from './feishu-messaging.js';
import { feishuDataEnvelopeSchema } from './feishu-response-schemas.js';

export async function listFeishuBitableApps(
  auth: FeishuAuthContext,
  input: {
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const pageSize = input.pageSize ?? 50;
  const pageToken = input.pageToken ? `&page_token=${encodeURIComponent(input.pageToken)}` : '';
  return getFeishuBitableData(
    auth,
    `/bitable/v1/apps?page_size=${pageSize}${pageToken}`,
    input.signal,
  );
}

export async function listFeishuBitableTables(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  const pageSize = input.pageSize ?? 100;
  const pageToken = input.pageToken ? `&page_token=${encodeURIComponent(input.pageToken)}` : '';
  return getFeishuBitableData(
    auth,
    `/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables?page_size=${pageSize}${pageToken}`,
    input.signal,
  );
}

export async function listFeishuBitableFields(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  const pageSize = input.pageSize ?? 200;
  const pageToken = input.pageToken ? `&page_token=${encodeURIComponent(input.pageToken)}` : '';
  return getFeishuBitableData(
    auth,
    `/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables/${encodeURIComponent(
      input.tableId,
    )}/fields?page_size=${pageSize}${pageToken}`,
    input.signal,
  );
}

export async function getFeishuBitableRecords(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly filter?: string;
    readonly pageSize?: number;
    readonly pageToken?: string;
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  const pageSize = input.pageSize ?? 50;
  const pageToken = input.pageToken ? `&page_token=${encodeURIComponent(input.pageToken)}` : '';
  const filter = input.filter ? `&filter=${encodeURIComponent(input.filter)}` : '';
  return getFeishuBitableData(
    auth,
    `/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables/${encodeURIComponent(
      input.tableId,
    )}/records?page_size=${pageSize}${pageToken}${filter}`,
    input.signal,
  );
}

export async function createFeishuBitableRecords(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly records: readonly Record<string, unknown>[];
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  return mutateFeishuBitableRecords(auth, input, 'POST', 'records', input.records);
}

export async function updateFeishuBitableRecords(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly records: readonly Record<string, unknown>[];
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  return mutateFeishuBitableRecords(auth, input, 'PUT', 'records', input.records);
}

export async function deleteFeishuBitableRecords(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly recordIds: readonly string[];
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  const path = `/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables/${encodeURIComponent(
    input.tableId,
  )}/records/batch_delete`;
  return postFeishuBitableData(auth, path, { record_ids: input.recordIds }, input.signal);
}

async function getFeishuBitableData(
  auth: FeishuAuthContext,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const token = await auth.getToken();
  const resp = await channelFetch(`${FEISHU_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  return parseBitableEnvelope(await resp.json(), 'Feishu bitable request failed');
}

async function mutateFeishuBitableRecords(
  auth: FeishuAuthContext,
  input: {
    readonly appToken: string;
    readonly tableId: string;
    readonly signal?: AbortSignal;
  },
  method: 'POST' | 'PUT',
  bodyKey: 'records',
  bodyValue: readonly Record<string, unknown>[],
): Promise<unknown> {
  const path = `/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables/${encodeURIComponent(
    input.tableId,
  )}/records`;
  return postFeishuBitableData(auth, path, { [bodyKey]: bodyValue }, input.signal, method);
}

async function postFeishuBitableData(
  auth: FeishuAuthContext,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  method: 'POST' | 'PUT' = 'POST',
): Promise<unknown> {
  const token = await auth.getToken();
  const resp = await channelFetch(`${FEISHU_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseBitableEnvelope(await resp.json(), 'Feishu bitable mutation failed');
}

function parseBitableEnvelope(body: unknown, message: string): unknown {
  const data = feishuDataEnvelopeSchema.parse(body);
  if (data.code !== 0) {
    throw new Error(`${message}: ${data.msg ?? data.code}`);
  }
  return data.data ?? {};
}
