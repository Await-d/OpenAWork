/**
 * 请求级诊断上下文。
 *
 * 解决的问题：网关里有**两套互不相通的请求标识**，导致拿着一个报错线索无法定位：
 * - Fastify 的 `request.id`：pino 日志的 `reqId`，但是递增数字；
 * - `createRequestContext()` 生成的 `requestId`：写入 `request_workflow_logs` 表与
 *   workflow 日志头。
 *
 * 二者原本各生成一次，客户端拿到的 ID 在服务端查不到对应记录。
 *
 * 为什么不直接改 Fastify 的 `genReqId` 让两者合并：`request.id` 还被
 * `routes/permissions.ts` 与 `routes/questions.ts` 当作**业务字段**写入数据库
 * （permission / question 的对外 ID），把它从递增数字改成 UUID 会改变落库数据格式，
 * 属于超出「让错误可排查」范围的行为变更。因此这里用独立的 WeakMap 保存追踪 ID。
 *
 * 追踪 ID 的优先级：入站 `x-request-id` → 新生成的 UUID，并回写到响应头，
 * 使客户端报障时能给出服务端可直接检索的 ID。
 */
import { generateRequestId, resolveRequestId, REQUEST_ID_HEADER } from '@openAwork/logger';

export interface RequestDiagnostics {
  /** 贯穿网关日志、错误响应头与 `request_workflow_logs` 表的追踪 ID。 */
  requestId: string;
  /** 鉴权通过后写入，便于按用户定位错误。 */
  userId: string | null;
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  id: string;
}

const diagnosticsByRequest = new WeakMap<object, RequestDiagnostics>();

/**
 * 为一次请求建立诊断上下文。幂等：重复调用返回已建立的上下文，
 * 保证同一请求在任何位置读到的追踪 ID 一致。
 */
export function attachRequestDiagnostics(request: RequestLike): RequestDiagnostics {
  const existing = diagnosticsByRequest.get(request);
  if (existing) return existing;

  const diagnostics: RequestDiagnostics = {
    requestId: resolveRequestId(request.headers, generateRequestId()),
    userId: null,
  };
  diagnosticsByRequest.set(request, diagnostics);
  return diagnostics;
}

export function getRequestDiagnostics(request: object): RequestDiagnostics | undefined {
  return diagnosticsByRequest.get(request);
}

/**
 * 读取追踪 ID，缺失时就地建立。
 *
 * 懒建立是必要的：全局错误处理器与 404 处理器可能在 `request-workflow` 插件建立
 * 上下文之前就被调用（未匹配路由根本不进入正常钩子链）。若此时退化成 Fastify 的
 * `request.id`，客户端拿到的 ID 就查不到 `request_workflow_logs`——正是本次要消除
 * 的那种「有 ID 但查不到」的困境。
 */
export function resolveTraceId(request: RequestLike): string {
  return attachRequestDiagnostics(request).requestId;
}

/** 记录已鉴权用户，供后续错误日志按用户聚合。 */
export function setRequestUserId(request: object, userId: string): void {
  const diagnostics = diagnosticsByRequest.get(request);
  if (diagnostics) {
    diagnostics.userId = userId;
  }
}

export { REQUEST_ID_HEADER };
