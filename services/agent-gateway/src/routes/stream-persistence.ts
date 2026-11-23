import { deleteSessionMessagesByRequestScope } from '../message/message-v2-adapter.js';
import { deleteSessionRunEventsByRequest } from '../session/session-run-events.js';
import { deleteRequestFileDiffs } from '../session/session-file-diff-store.js';
import { deleteRequestSnapshots } from '../session/session-snapshot-store.js';
import { deleteSessionEventsByRequestScope } from '../session/session-entry-store.js';

/** 清理失败重放的请求工件；保留用户消息，不承诺跨存储原子性。 */
export function clearRequestArtifacts(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
}): void {
  deleteSessionRunEventsByRequest({
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
  });
  deleteSessionMessagesByRequestScope({
    ...input,
    roles: ['assistant', 'tool', 'synthetic'],
  });
  deleteRequestFileDiffs(input);
  deleteRequestSnapshots(input);
  deleteSessionEventsByRequestScope(input);
}
