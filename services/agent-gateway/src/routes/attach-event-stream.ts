import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RunEventReplayReader, ReplayEvent } from '../session/session-run-event-replay.js';
import { assertRunEventSize, RunEventSizeError } from '../session/run-event-size-budget.js';

const MAX_PENDING_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_EVENTS = 2048;
const DRAIN_TIMEOUT_MS = 15_000;

export interface AttachStreamResult {
  reason: string;
  lastCursor: number;
  replayedCount: number;
}

/** 重放与实时事件共用一个写泵；慢连接只影响自身，不阻塞同步事件发布者。 */
export async function runAttachEventStream(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  after: number;
  createReader: () => RunEventReplayReader;
  subscribe?: (onEvent: (event: ReplayEvent) => void) => () => void;
  encode: (event: ReplayEvent) => string;
  endsStream?: (event: ReplayEvent) => boolean;
  initialFrames?: string;
  endFrame?: (replayedCount: number) => string;
  endWhenEmpty?: string;
}): Promise<AttachStreamResult> {
  const { request, reply } = input;
  let closed = false;
  let reason = 'unknown';
  let lastCursor = input.after;
  let replayedCount = 0;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let wake: (() => void) | undefined;
  let cancelDrain: (() => void) | undefined;
  let pendingBytes = 0;
  let heartbeatPending = false;
  let sizeFailure: RunEventSizeError | undefined;
  const pending = new Map<number, { event: ReplayEvent; frame: string; bytes: number }>();

  const finish = (why: string) => {
    if (closed) return;
    closed = true;
    reason = why;
    clearInterval(heartbeat);
    unsubscribe?.();
    request.raw.off('aborted', onAborted);
    reply.raw.off('close', onClosed);
    reply.raw.off('error', onError);
    cancelDrain?.();
    wake?.();
    pending.clear();
    pendingBytes = 0;
    if (!reply.raw.destroyed && !reply.raw.writableEnded) {
      if (why === 'backpressure_timeout' || why === 'pending_overflow') reply.raw.destroy();
      else reply.raw.end();
    }
  };
  const onAborted = () => finish('client_aborted');
  const onClosed = () => finish('client_closed');
  const onError = () => finish('response_error');
  request.raw.on('aborted', onAborted);
  reply.raw.on('close', onClosed);
  reply.raw.on('error', onError);

  const write = async (frame: string): Promise<boolean> => {
    if (closed) return false;
    if (reply.raw.destroyed || reply.raw.writableEnded) {
      finish('client_closed');
      return false;
    }
    try {
      if (!reply.raw.write(frame)) {
        const drained = await new Promise<boolean>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const done = (ok: boolean) => {
            clearTimeout(timer);
            reply.raw.off('drain', onDrain);
            cancelDrain = undefined;
            resolve(ok);
          };
          const onDrain = () => done(true);
          cancelDrain = () => done(false);
          reply.raw.once('drain', onDrain);
          timer = setTimeout(() => {
            done(false);
            finish('backpressure_timeout');
          }, DRAIN_TIMEOUT_MS);
          if (closed || reply.raw.destroyed) done(false);
        });
        if (!drained) return false;
      }
      return !closed;
    } catch {
      finish('write_failed');
      return false;
    }
  };

  const enqueue = (event: ReplayEvent) => {
    if (closed || sizeFailure || event.cursor <= lastCursor || pending.has(event.cursor)) return;
    try {
      assertRunEventSize(event.event);
      const frame = input.encode(event);
      const bytes = Buffer.byteLength(frame);
      if (pendingBytes + bytes > MAX_PENDING_BYTES || pending.size >= MAX_PENDING_EVENTS) {
        finish('pending_overflow');
        return;
      }
      pending.set(event.cursor, { event, frame, bytes });
      pendingBytes += bytes;
      wake?.();
    } catch (error) {
      if (error instanceof RunEventSizeError) {
        sizeFailure = error;
        wake?.();
      } else finish('encode_failed');
    }
  };

  const deliver = async (event: ReplayEvent, frame?: string): Promise<boolean> => {
    if (closed) return false;
    if (event.cursor <= lastCursor) return true;
    if (!frame) assertRunEventSize(event.event);
    if (!(await write(frame ?? input.encode(event)))) return false;
    lastCursor = event.cursor;
    if (input.endsStream?.(event)) finish('terminal_event');
    return true;
  };

  try {
    if (reply.raw.destroyed || request.raw.aborted) {
      finish('client_closed');
    } else {
      unsubscribe = input.subscribe?.(enqueue);
      const readPage = input.createReader();
      if (input.initialFrames) await write(input.initialFrames);
      let cursor = input.after;
      while (!closed) {
        if (sizeFailure) throw sizeFailure;
        const page = readPage(cursor);
        for (const event of page.events) {
          if (!(await deliver(event))) break;
          replayedCount += 1;
        }
        if (closed || !page.more || page.nextCursor <= cursor) break;
        cursor = page.nextCursor;
        await yieldToLoop();
      }
      if (!closed && !input.subscribe) {
        if (input.endFrame) await write(input.endFrame(replayedCount));
        finish('replay_complete');
      }
      if (!closed && input.endWhenEmpty && replayedCount === 0 && pending.size === 0) {
        await write(input.endWhenEmpty);
        finish('no_active_stream');
      }
      if (!closed) {
        heartbeat = setInterval(() => {
          heartbeatPending = true;
          wake?.();
        }, 10_000);
      }
      while (!closed) {
        if (pending.size === 0 && !heartbeatPending && !sizeFailure) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
        if (sizeFailure) throw sizeFailure;
        if (heartbeatPending && !closed) {
          heartbeatPending = false;
          await write(': keepalive\n\n');
        }
        const batch = [...pending.values()].sort(
          (left, right) => left.event.cursor - right.event.cursor,
        );
        for (const entry of batch) {
          pending.delete(entry.event.cursor);
          pendingBytes -= entry.bytes;
          if (!(await deliver(entry.event, entry.frame))) break;
        }
        if (batch.length > 0) await yieldToLoop();
      }
    }
  } catch (error) {
    if (error instanceof RunEventSizeError && !closed) {
      unsubscribe?.();
      unsubscribe = undefined;
      await write(
        `data: ${JSON.stringify({ type: 'error', code: 'ATTACH_EVENT_TOO_LARGE', message: error.message })}\n\n`,
      );
      finish('event_too_large');
    } else finish('replay_failed');
  } finally {
    finish('stream_finished');
  }
  return { reason, lastCursor, replayedCount };
}
