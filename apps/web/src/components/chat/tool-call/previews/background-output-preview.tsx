/**
 * `background_output` returns a plain task message string in the common case,
 * but with `full_session=true` it returns the gateway's task output envelope
 * plus a `messages` array (see `buildTaskToolOutput` /
 * `formatBackgroundOutputMessages` in the gateway). This preview covers the
 * structured form; the string form keeps flowing through the text envelope.
 */
export interface BackgroundOutputMessage {
  role: string;
  text: string;
}

export interface BackgroundOutputView {
  assignedAgent?: string;
  errorMessage?: string;
  message?: string;
  messages: BackgroundOutputMessage[];
  reason?: string;
  result?: string;
  status: string;
  taskId: string;
  timedOut?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function partText(part: unknown): string | null {
  const record = asRecord(part);
  if (!record) return null;
  const type = typeof record['type'] === 'string' ? record['type'] : 'part';
  if (type === 'text' && typeof record['text'] === 'string') return record['text'];
  return `[${type}]`;
}

function toMessage(value: unknown): BackgroundOutputMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  const role = typeof record['role'] === 'string' ? record['role'] : 'unknown';
  const content = Array.isArray(record['content']) ? record['content'] : [];
  const text = content
    .map(partText)
    .filter((part): part is string => part !== null && part.length > 0)
    .join('\n');
  return { role, text };
}

export function extractBackgroundOutput(output: unknown): BackgroundOutputView | null {
  const record = asRecord(output);
  if (!record) return null;
  const taskId = record['taskId'];
  const status = record['status'];
  if (typeof taskId !== 'string' || typeof status !== 'string') return null;

  const messages: BackgroundOutputMessage[] = [];
  if (Array.isArray(record['messages'])) {
    for (const item of record['messages']) {
      const message = toMessage(item);
      if (message) messages.push(message);
    }
  }

  return {
    ...(typeof record['assignedAgent'] === 'string'
      ? { assignedAgent: record['assignedAgent'] }
      : {}),
    ...(typeof record['errorMessage'] === 'string' ? { errorMessage: record['errorMessage'] } : {}),
    ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    messages,
    ...(typeof record['reason'] === 'string' ? { reason: record['reason'] } : {}),
    ...(typeof record['result'] === 'string' ? { result: record['result'] } : {}),
    status,
    taskId,
    ...(record['timedOut'] === true ? { timedOut: true } : {}),
  };
}

export function BackgroundOutputPreview({ view }: { view: BackgroundOutputView }) {
  return (
    <div className="bg-task">
      <div className="bg-task-head">
        <span className="bg-task-status">{view.status}</span>
        {view.assignedAgent && <span className="bg-task-agent">{view.assignedAgent}</span>}
        <span className="bg-task-id">{view.taskId}</span>
        {view.timedOut && <span className="bg-task-timeout">等待超时</span>}
      </div>
      {view.errorMessage && <div className="bg-task-error">{view.errorMessage}</div>}
      {view.message && <div className="bg-task-message">{view.message}</div>}
      {view.result && <div className="bg-task-result">{view.result}</div>}
      {view.messages.length > 0 && (
        <div className="bg-task-messages">
          {view.messages.map((message, index) => (
            <div className="bg-task-msg" key={index}>
              <span className="bg-task-msg-role">{message.role}</span>
              <span className="bg-task-msg-text">{message.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
