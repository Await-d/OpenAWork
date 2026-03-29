import type { WorkflowLogger } from './workflow-logger.js';
import type { RequestContext } from './types.js';

export type RequestLoggerDecorators = {
  workflowLogger: WorkflowLogger;
  workflowContext: RequestContext;
};

export function createRequestContext(
  method: string,
  url: string,
  headers: Record<string, string | string[] | undefined>,
  ip: string,
): RequestContext {
  const existingId = headers['x-request-id'] as string | undefined;
  const requestId = existingId ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const forwardedIp =
    (headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? ip;
  const userAgent = headers['user-agent'] as string | undefined;
  return {
    requestId,
    method,
    path: url.split('?')[0] ?? url,
    ip: forwardedIp,
    userAgent,
    startTime: Date.now(),
  };
}
