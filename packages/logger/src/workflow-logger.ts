import type { WorkflowStep, RequestContext } from './types.js';

const STATUS_LABEL: Record<WorkflowStep['status'], string> = {
  success: '\x1b[32m[成功]\x1b[0m',
  pending: '\x1b[33m[进行中]\x1b[0m',
  error: '\x1b[31m[失败]\x1b[0m',
};

function statusEmoji(code: number): string {
  if (code >= 100 && code < 400) return '\x1b[32m🟢\x1b[0m';
  if (code >= 400 && code < 500) return '\x1b[33m🟡\x1b[0m';
  return '\x1b[31m🔴\x1b[0m';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatFields(fields?: Record<string, string | number | boolean>): string {
  if (!fields || Object.keys(fields).length === 0) return '';
  return (
    ' - ' +
    Object.entries(fields)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ')
  );
}

function renderStep(step: WorkflowStep, prefix: string, isLast: boolean): string[] {
  const connector = isLast ? '└──' : '├──';
  const childPrefix = prefix + (isLast ? '    ' : '│   ');

  const dur = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : '';
  const msg = step.message ? ` - ${step.message}` : '';
  const fields = formatFields(step.fields);
  const label = STATUS_LABEL[step.status];

  const line = `${prefix}${connector} ${label} ${step.name}${dur}${msg}${fields}`;
  const lines: string[] = [line];

  if (step.children && step.children.length > 0) {
    step.children.forEach((child, i) => {
      const childIsLast = i === step.children!.length - 1;
      lines.push(...renderStep(child, childPrefix, childIsLast));
    });
  }

  return lines;
}

export class WorkflowLogger {
  private steps: WorkflowStep[] = [];

  start(
    name: string,
    message?: string,
    fields?: Record<string, string | number | boolean>,
  ): WorkflowStep {
    const step: WorkflowStep = {
      name,
      status: 'pending',
      message,
      fields,
      _startedAt: Date.now(),
    };
    this.steps.push(step);
    return step;
  }

  startChild(
    parent: WorkflowStep,
    name: string,
    message?: string,
    fields?: Record<string, string | number | boolean>,
  ): WorkflowStep {
    const child: WorkflowStep = {
      name,
      status: 'pending',
      message,
      fields,
      _startedAt: Date.now(),
    };
    if (!parent.children) parent.children = [];
    parent.children.push(child);
    return child;
  }

  succeed(
    step: WorkflowStep,
    message?: string,
    fields?: Record<string, string | number | boolean>,
  ): void {
    step.status = 'success';
    if (message !== undefined) step.message = message;
    if (fields !== undefined) step.fields = { ...step.fields, ...fields };
    if (step._startedAt !== undefined) {
      step.durationMs = Date.now() - step._startedAt;
    }
  }

  fail(
    step: WorkflowStep,
    message?: string,
    fields?: Record<string, string | number | boolean>,
  ): void {
    step.status = 'error';
    if (message !== undefined) step.message = message;
    if (fields !== undefined) step.fields = { ...step.fields, ...fields };
    if (step._startedAt !== undefined) {
      step.durationMs = Date.now() - step._startedAt;
    }
  }

  flush(ctx: RequestContext, statusCode: number, extra?: Record<string, string>): void {
    const totalMs = Date.now() - ctx.startTime;
    const time = formatTime(ctx.startTime);
    const emoji = statusEmoji(statusCode);

    const lines: string[] = [];
    lines.push(`[${time} INF] ${emoji} ${statusCode} ${ctx.method} ${ctx.path} ${totalMs}ms -`);
    lines.push(`├── requestId: ${ctx.requestId}`);

    if (this.steps.length > 0) {
      lines.push('├── workflow:');
      this.steps.forEach((step, i) => {
        const isLast = i === this.steps.length - 1;
        lines.push(...renderStep(step, '│   ', isLast));
      });
    }

    if (extra) {
      const extraKeys = Object.keys(extra);
      extraKeys.forEach((k, i) => {
        const isLast = i === extraKeys.length - 1 && !ctx.ip && !ctx.userAgent;
        lines.push(`${isLast ? '└' : '├'}── ${k}: ${extra[k]}`);
      });
    }

    if (ctx.ip) {
      lines.push(`${ctx.userAgent ? '├' : '└'}── ip: ${ctx.ip}`);
    }
    if (ctx.userAgent) {
      lines.push(`└── ua: ${ctx.userAgent}`);
    }

    console.log(lines.join('\n'));
  }
}
