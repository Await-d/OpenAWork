/**
 * 待发队列的**网关侧自动续跑**（无人值守消费）。
 *
 * ## 为什么需要
 *
 * 队列落在服务端（`session_composer_queue`），但消费一直由客户端驱动：`use-unified-composer-state`
 * 的 flush effect 只在「该会话当前被打开、且会话空闲」时才发。用户切到别的会话 / 关掉页面后，
 * 原会话跑完也没有任何驱动源，队列就此停住直到用户切回来。
 *
 * 本模块把消费下沉到网关：**回合收尾时**（`stream.ts` 的 `finally { clearReservation() }`）
 * 尝试消费队首一条并起下一轮。事件驱动、不轮询、不建定时器——这是刻意为之：队列条目只会
 * 由用户入队产生，不存在「服务端自己造条目」的路径，因此没有无限自激的土壤；连续自动轮
 * 仍有上限（{@link MAX_CONSECUTIVE_QUEUE_AUTO_RUNS}）兜住「用户排了几十条就走」这类场景。
 *
 * ## 关键不变量
 *
 * 1. **只消费队首**：队首不可自动消费时整队停住，不越过它去发后面的条目——否则用户看到的
 *    顺序会与他排队的顺序不一致。
 * 2. **出队即互斥**：`take` 是同步段（读队列 → 可消费性判定 → claim → 删除），JS 单线程下
 *    天然串行；后到的触发点读到的队列已不含该条目，因此不需要额外的进程内锁。
 * 3. **先删后起轮 + 失败幂等回填**：不要持 claim 跑完整轮。`COMPOSER_QUEUE_CLAIM_LEASE_MS`
 *    上限只有 5 分钟，而一整轮 agent 回合经常更久；持租约跑完整轮会让另一端的客户端在租约
 *    过期后抢到条目重发。回填用原 `itemId`（`enqueueComposerQueueItem` 幂等）与原
 *    `enqueuedAt`（保持 FIFO 位置），与 `reEnqueueRejectedQueuedMessage` 同一范式。
 * 4. **删除不回收附件副本**：本模块直接走 `removeComposerQueueItem`，**刻意不经**
 *    `session-composer-queue` 路由的 `purgeComposerQueueAttachments`。客户端发送时会重新上传
 *    一份新副本再引用，队列副本因此可以回收；服务端自动轮没有这一步，它直接引用队列里的
 *    `artifactId`——若照常回收，模型读图时会 404。副本在此从「队列临时文件」转为「消息资产」。
 * 5. **不做伪装的用户交互**：起轮走 `runSessionInBackground` 的内部请求身份
 *    （`clientRequestId = itemId`），因此不会重置唤醒预算、也不会被记成「用户手动交互」；
 *    幂等由 `dispatchChatMessage({ messageID: clientRequestId })` 保证——同一 itemId 重放
 *    不会落第二条用户消息。
 *
 * ## 已知边界
 *
 * - 带**非图片附件**（`file` / `audio` / `video`），或附件尚未拿到跨端副本
 *   （`requiresAttachmentRebind`、缺 `artifactId`）的条目不会自动发。服务端没有把这些类型重建
 *   成模型输入的等价装配方式，硬发就是静默丢附件——宁可不发，留给用户切回来手动发送。
 * - 上述三种「不发」**必须给出三段不同的文案**（见 `QueueBlockedReason`）：先按类型判、
 *   再按副本判。把「图片但副本缺失」也算成「非图片附件」，会让用户按错误方向排查。
 * - 会话处于等待审批 / 等待回答（`hasPendingSessionInteraction`）时停住并保留队列：这正好
 *   实现了「ask 档撞审批就停在 paused，用户回来批准后自动继续」的预期语义。
 * - 计数器是进程内存储（与 `task-wake-budget` 一致）：重启即清零，属可接受语义。
 */

import { randomUUID } from 'node:crypto';
import type { InputImageContent } from '@openAwork/shared';
import { describeError, logGatewayInfo, logGatewayWarn } from '../infra/gateway-logger.js';
import { MESSAGE_HARD_MAX_CHARS } from '../infra/message-limits-store.js';
import { getAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';
import {
  claimComposerQueueItem,
  COMPOSER_QUEUE_CLAIM_LEASE_MS,
  enqueueComposerQueueItem,
  listComposerQueueItems,
  releaseComposerQueueItem,
  removeComposerQueueItem,
  type ComposerQueueItem,
} from './composer-queue-store.js';
import {
  createNotification,
  expireQueueBlockedNotificationsForSession,
  QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE,
} from './notification-store.js';
import { hasPendingSessionInteraction } from './session-runtime-state.js';

/**
 * 连续自动续跑上限。
 *
 * 队列条目数本身是天然上界（服务端不会自己造条目），这个上限针对的是「用户一次排了几十条
 * 然后离开」——单会话连续自动跑满 20 轮就停住，队列保留，用户回来仍可手动发。用户任一次
 * 真实发言即重置计数（`noteManualSessionInteractionForComposerQueue`）。
 */
export const MAX_CONSECUTIVE_QUEUE_AUTO_RUNS = 20;

/** 服务端消费方在 claim 中使用的固定标识，与客户端「每标签页一个 clientId」区分开。 */
const GATEWAY_QUEUE_CLAIM_CLIENT_ID = 'gateway-composer-queue-pump';

const consecutiveAutoRunCounts = new Map<string, number>();

/** 自动轮起跑后的观测结果。`true` = 网关已受理这一轮（`statusCode === 200`）。 */
export type StartQueuedRun = (task: ComposerQueueAutoRunTask) => Promise<boolean>;

export interface ComposerQueueAutoRunTask {
  /** 同时用作 `clientRequestId`：消息 id 即它，因此重复起轮不会落第二条用户消息。 */
  clientRequestId: string;
  inputParts: InputImageContent[];
  sessionId: string;
  text: string;
  userId: string;
  /** 起轮失败时把条目幂等回填（原 itemId + 原 enqueuedAt，保持 FIFO 位置）。 */
  restore: () => void;
}

/**
 * 自动续跑总开关。默认开启，`OPENAWORK_DISABLE_COMPOSER_QUEUE_AUTO_RUN=1` 回退到「只由客户端驱动」
 * 的既有行为（项目里同类开关统一用 DISABLE 语义，见 `OPENAWORK_DISABLE_TOOL_FOLDING`）。
 */
export function isComposerQueueAutoRunEnabled(): boolean {
  return process.env['OPENAWORK_DISABLE_COMPOSER_QUEUE_AUTO_RUN'] !== '1';
}

function sessionKey(input: { sessionId: string; userId: string }): string {
  return `${input.userId}:${input.sessionId}`;
}

/** 尝试消耗一次自动续跑预算。`false` = 预算耗尽，调用方应保留队列不再起轮。 */
export function tryConsumeQueueAutoRunBudget(input: {
  sessionId: string;
  userId: string;
}): boolean {
  const key = sessionKey(input);
  const current = consecutiveAutoRunCounts.get(key) ?? 0;
  if (current >= MAX_CONSECUTIVE_QUEUE_AUTO_RUNS) {
    return false;
  }
  consecutiveAutoRunCounts.set(key, current + 1);
  return true;
}

/**
 * 用户真实交互 → 重置连续自动轮计数。
 *
 * ⚠️ 只应由**非网关内部请求**调用（调用方用 `isGatewayInternalRequestKey` 判定）：自动轮自身
 * 也是请求，若它也重置，上限就永远触发不了。
 */
export function noteManualSessionInteractionForComposerQueue(input: {
  sessionId: string;
  userId: string;
}): void {
  consecutiveAutoRunCounts.delete(sessionKey(input));
}

/** 读取当前连续自动轮次数（观测 / 测试用）。 */
export function readConsecutiveQueueAutoRunCount(input: {
  sessionId: string;
  userId: string;
}): number {
  return consecutiveAutoRunCounts.get(sessionKey(input)) ?? 0;
}

/** 仅测试使用：清空全部计数。 */
export function resetComposerQueueAutoRunBudgetForTests(): void {
  consecutiveAutoRunCounts.clear();
}

/**
 * 队首阻塞的原因（同时也是阻塞提醒文案的查找键）。
 *
 * 三者对应**三种完全不同的用户动作**，因此不能合并：
 * - `attachment-rebind`：跨端副本整体失效，条目已被标记为需要重新绑定 → 重新选文件；
 * - `attachment-missing-copy`：附件本身是图片（类型合法），只是网关侧找不到它的副本
 *   （上传失败 / 旧版本客户端写入 / 已被清理）→ 重新选图片；
 * - `unsupported-attachment`：附件类型根本不是图片（`file` / `audio` / `video`），自动续发
 *   没有等价的装配方式 → 手动发送即可，文件类型本身没问题。
 *
 * 后两者此前共用一条分支与一句文案，于是「图片副本丢了」会被告知「包含非图片附件」，
 * 用户会去找一个并不存在的文件类型问题。
 */
type QueueBlockedReason =
  'attachment-rebind' | 'attachment-missing-copy' | 'unsupported-attachment';

/**
 * 可消费性判定的结论。
 *
 * 区分「不可发但不值得打扰用户」与「不可发且必须告知用户」是这一改动的核心：此前两者都是
 * `null`，于是「队首卡着一条带 PDF 的消息」和「队首是个空条目」在调用方看来一模一样，
 * 用户离开后永远不会知道自己排的消息停住了。
 */
type AutoRunPayloadResult =
  | { kind: 'ok'; inputParts: InputImageContent[] }
  /** 队首不可自动消费，但**值得提醒用户**（附件类问题）。 */
  | { kind: 'blocked'; reason: QueueBlockedReason }
  /** 不值得打扰用户（空条目 / 超长文本）。 */
  | { kind: 'skipped' };

/**
 * 判定一条队列条目能否被网关自动发出去。
 *
 * 返回非 `ok` 表示**不可自动消费**——调用方必须保留队列（不跳过队首、不丢弃条目）。
 * 判据刻意保守：宁可停住等用户，也不要发出一条悄悄丢了附件的消息。
 */
function resolveAutoRunPayload(item: ComposerQueueItem): AutoRunPayloadResult {
  if (item.requiresAttachmentRebind) {
    return { kind: 'blocked', reason: 'attachment-rebind' };
  }
  if (item.text.length > MESSAGE_HARD_MAX_CHARS) {
    return { kind: 'skipped' };
  }
  if (item.text.trim().length === 0 && item.attachmentItems.length === 0) {
    return { kind: 'skipped' };
  }

  const inputParts: InputImageContent[] = [];
  for (const attachment of item.attachmentItems) {
    // 只有「图片 + 已有跨端副本」能在网关侧重建为模型输入。两种缺失必须分开判：
    // 前者是类型不支持，后者是副本不在——用户要做的事完全不同（见 {@link QueueBlockedReason}）。
    if (attachment.type !== 'image') {
      // 非图片附件：服务端没有把它们重建成模型输入的等价装配方式（见文件头「已知边界」）。
      return { kind: 'blocked', reason: 'unsupported-attachment' };
    }
    if (!attachment.artifactId) {
      // 是图片，但跨端副本不在（上传失败 / 旧版本客户端写入 / 已被清理）：
      // 与「非图片附件」是两种完全不同的用户动作，文案必须区分开，否则用户会去找
      // 一个并不存在的「文件类型不支持」问题。
      return { kind: 'blocked', reason: 'attachment-missing-copy' };
    }
    inputParts.push({
      type: 'input_image',
      artifactId: attachment.artifactId,
      fileName: attachment.name,
    });
  }
  return { kind: 'ok', inputParts };
}

/** 供提醒文案指代队首位置，例如 `队列第 1 条（共 3 条）`。 */
function buildQueuePositionLabel(input: { position: number; total: number }): string {
  return `队列第 ${input.position} 条（共 ${input.total} 条）`;
}

/**
 * 三种阻塞原因对应的提醒文案。
 *
 * 用映射而不是三元表达式：原因已有三种，继续写三元就会退化成嵌套三元，每加一种都更难读，
 * 也更容易把两句话错配到同一个分支上（这正是本次要修的缺陷）。
 *
 * `body` 是「队首位置标签 → 正文」的函数，因为正文句首必须嵌入「队列第 N 条（共 M 条）」。
 */
const QUEUE_BLOCKED_MESSAGES: Record<
  QueueBlockedReason,
  { body: (queuePositionLabel: string) => string; title: string }
> = {
  'attachment-rebind': {
    body: (label) =>
      `${label}的附件没能在网关侧恢复（跨端副本已失效），自动续发无法发出。回到会话重新选择文件后手动发送。`,
    title: '待发消息的附件需要重新选择',
  },
  'attachment-missing-copy': {
    body: (label) =>
      `${label}的图片在网关侧找不到副本（可能已被清理），自动续发无法发出。回到会话重新选择图片后手动发送。`,
    title: '待发消息的图片副本已失效',
  },
  'unsupported-attachment': {
    body: (label) => `${label}包含非图片附件，自动续发只支持文本与图片。回到会话手动发送即可。`,
    title: '待发消息含自动续发不支持的文件',
  },
};

/**
 * 依据「队首此刻能否自动发出」投递或收口阻塞提醒。
 *
 * 每回合收尾都会走到这里，因此必须幂等：投递用固定 dedupeKey（每会话一条，重复调用只会刷新
 * 同一条未读项），收口只在确实有行变化时广播（见 notification-store 的实现）。
 */
function syncQueueBlockedNotification(input: {
  blockedReason: QueueBlockedReason | null;
  queuePositionLabel: string;
  sessionId: string;
  userId: string;
}): void {
  try {
    if (input.blockedReason === null) {
      expireQueueBlockedNotificationsForSession({
        sessionId: input.sessionId,
        userId: input.userId,
      });
      return;
    }
    const content = QUEUE_BLOCKED_MESSAGES[input.blockedReason];
    createNotification({
      body: content.body(input.queuePositionLabel),
      // 每会话只保留一条未读：每回合收尾都会重调本函数，靠它抵抗重复计票。
      dedupeKey: `${QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE}:${input.sessionId}`,
      eventType: QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE,
      id: randomUUID(),
      // 显式传 kind：`resolveNotificationKind` 只认 permission / question 两类。
      kind: 'actionable',
      sessionId: input.sessionId,
      title: content.title,
      userId: input.userId,
    });
  } catch (error) {
    // 调用点在回合收尾路径上：提醒本身是告知，绝不能因为它的失败中断队列消费。
    logGatewayWarn('待发队列自动续跑：阻塞提醒投递 / 收口失败', {
      sessionId: input.sessionId,
      ...describeError(error),
    });
  }
}

/**
 * 同步阶段：守卫 → 读队首 → 可消费性判定 → claim → 出队。
 *
 * 返回 `null` 表示本次不消费（原因无需区分：每种情况都对应「队列保持不动 + 不再起轮」）。
 * 返回任务对象后，调用方负责起轮；起轮失败要调 `task.restore()`。
 *
 * 全程同步（SQLite 同步 API），因此两次并发触发不会取到同一条——队列出队本身就是互斥。
 */
export function takeComposerQueueAutoRun(input: {
  sessionId: string;
  userId: string;
  now?: number;
}): ComposerQueueAutoRunTask | null {
  if (!isComposerQueueAutoRunEnabled()) {
    return null;
  }
  // 等待审批 / 等待回答：会话已 paused，此刻起轮只会先落一条用户消息再撞锁失败。
  // 保留队列，用户处理完交互后由下一次回合收尾继续消费。
  if (hasPendingSessionInteraction(input.sessionId)) {
    return null;
  }
  // 仍在跑：这一轮结束时会再次触发，不必在这里抢。
  if (getAnyInFlightStreamRequestForSession(input)) {
    return null;
  }

  const items = listComposerQueueItems(input);
  const head = items[0];
  if (!head) {
    // 队列空了：若此前挂过一条阻塞提醒（例如队首被另一端的客户端消费掉、没走 HTTP 路由的
    // 收口路径），这里兜底收口。无阻塞项时 UPDATE 命中 0 行，不会广播。
    syncQueueBlockedNotification({
      blockedReason: null,
      queuePositionLabel: '',
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return null;
  }
  const payload = resolveAutoRunPayload(head);
  if (payload.kind === 'blocked') {
    // 队首卡住了：整队停住，同时告诉用户「为什么停」——他可能已经离开页面。
    syncQueueBlockedNotification({
      blockedReason: payload.reason,
      queuePositionLabel: buildQueuePositionLabel({ position: 1, total: items.length }),
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return null;
  }
  if (payload.kind === 'skipped') {
    // 空条目 / 超长文本不值得打扰用户：既不新建提醒，也**不收口**已有提醒——
    // 队首之后可能仍有一条真阻塞的条目，此刻把红点灭掉等于把问题藏起来。
    return null;
  }
  // **必须「先 claim，后扣预算」**：claim 会因「另一端正持有租约 / 本端抢输了」而失败，
  // 这条路径上本端一个动作都没做。若提前扣预算，用户排了几十条、途中被抢几次，上限就
  // 被白吃光——人不在场时队列会彻底停住。预算只该为「本端真的发起的那一轮」计数。
  const claimed = claimComposerQueueItem({
    clientId: GATEWAY_QUEUE_CLAIM_CLIENT_ID,
    itemId: head.id,
    leaseMs: COMPOSER_QUEUE_CLAIM_LEASE_MS,
    now: input.now ?? Date.now(),
    sessionId: input.sessionId,
    userId: input.userId,
  });
  if (!claimed) {
    // 另一端（客户端标签页）正在发这一条：交给它，本地不再动作。
    return null;
  }

  if (!tryConsumeQueueAutoRunBudget(input)) {
    // 预算耗尽：条目仍在队列里，因此**先交还发送权再返回**——攥着租约不放，这条消息得
    // 白等一个租约周期（60s）才能被别的端接手，期间用户切回来也发不出去。
    releaseComposerQueueItem({
      clientId: GATEWAY_QUEUE_CLAIM_CLIENT_ID,
      itemId: head.id,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    logGatewayInfo('待发队列自动续跑：连续自动轮达上限，保留队列等待用户', {
      sessionId: input.sessionId,
      consecutiveAutoRuns: MAX_CONSECUTIVE_QUEUE_AUTO_RUNS,
    });
    return null;
  }

  // 出队。**刻意不调用 `purgeComposerQueueAttachments`**：本轮的图片附件要继续以同一
  // `artifactId` 被引用，回收会让模型读图 404（见文件头不变量 4）。
  if (
    !removeComposerQueueItem({
      itemId: head.id,
      sessionId: input.sessionId,
      userId: input.userId,
    })
  ) {
    releaseComposerQueueItem({
      clientId: GATEWAY_QUEUE_CLAIM_CLIENT_ID,
      itemId: head.id,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    return null;
  }

  // 队首已发出：原先的阻塞提醒（若有）到此已不成立，立刻收口。
  syncQueueBlockedNotification({
    blockedReason: null,
    queuePositionLabel: '',
    sessionId: input.sessionId,
    userId: input.userId,
  });

  return {
    clientRequestId: head.id,
    inputParts: payload.inputParts,
    restore: () => {
      // 幂等回填：同一 itemId 不会产生第二条；原 enqueuedAt 保证 FIFO 位置不变。
      enqueueComposerQueueItem({
        attachmentItems: head.attachmentItems,
        enqueuedAt: head.enqueuedAt,
        itemId: head.id,
        requiresAttachmentRebind: head.requiresAttachmentRebind,
        sessionId: input.sessionId,
        text: head.text,
        userId: input.userId,
      });
    },
    sessionId: input.sessionId,
    text: head.text,
    userId: input.userId,
  };
}

/**
 * 生产环境的「起一轮」实现。
 *
 * `runSessionInBackground` 用**动态 import**：`stream.ts` 静态导入本模块，而本模块反向静态
 * 导入 `stream-runtime.ts` 会构成 `stream.ts ⇄ stream-runtime.ts` 的运行时环。同一写法在
 * `task/task-job-delivery.ts` 已有先例。
 *
 * 判定口径：`runSessionInBackground` 的契约是「异常 = 没跑起来；正常返回时 statusCode 反映
 * 受理结果」，且它会把缺失的 `stopReason` 补成 `'error'`——所以**不能**用 stopReason 判受理，
 * 只能用 `statusCode === 200`。上游 500 但已落库回复的情况仍是 200，此时不该回填条目。
 */
async function startComposerQueueAutoRun(task: ComposerQueueAutoRunTask): Promise<boolean> {
  const { runSessionInBackground } = await import('../routes/stream-runtime.js');
  const result = await runSessionInBackground({
    requestData: {
      clientRequestId: task.clientRequestId,
      message: task.text,
      ...(task.inputParts.length > 0 ? { inputParts: task.inputParts } : {}),
    },
    sessionId: task.sessionId,
    userId: task.userId,
  });
  return result.statusCode === 200;
}

/**
 * 幂等回填，**绝不抛错**。
 *
 * 回填本身要写 SQLite，而 `session_composer_queue.session_id` 对 `sessions` 有外键：会话在
 * 起轮期间被删除时，回填必然抛 FK 错误。此处若不兜住，异常会让 `scheduleComposerQueueAutoRun`
 * 里那个被 `void` 掉的异步 IIFE 变成 unhandled rejection——网关不允许出现这种 rejection。
 * 回填失败只意味着**这条消息丢了**（已记日志），不影响本轮收尾与后续队列消费。
 */
function restoreConsumedQueueItem(task: ComposerQueueAutoRunTask): void {
  try {
    task.restore();
  } catch (error) {
    logGatewayWarn('待发队列自动续跑：条目回填失败（消息可能丢失）', {
      itemId: task.clientRequestId,
      sessionId: task.sessionId,
      ...describeError(error),
    });
  }
}

/**
 * 生产入口：尝试消费一条待发消息并起下一轮。**fire-and-forget**，绝不抛错。
 *
 * 调用点只有一处——`stream.ts` 的回合收尾（`finally { clearReservation() }`）。刻意不 await：
 * 该位置属于请求返回路径，等一整轮跑完会把上一轮的 HTTP 响应拖住。
 *
 * @param deps 仅测试注入用；生产不传。
 */
export function scheduleComposerQueueAutoRun(
  input: { sessionId: string; userId: string; now?: number },
  deps: { startRun?: StartQueuedRun } = {},
): void {
  let task: ComposerQueueAutoRunTask | null;
  try {
    task = takeComposerQueueAutoRun(input);
  } catch (error) {
    // 判定阶段的同步 SQLite 异常不得逃逸到回合收尾路径——那里正是单飞锁释放点，
    // 抛出会把整轮对话的收尾变成失败。
    logGatewayWarn('待发队列自动续跑：判定阶段失败，本次跳过', {
      sessionId: input.sessionId,
      ...describeError(error),
    });
    return;
  }
  if (!task) {
    return;
  }

  const consumed = task;
  void (async () => {
    try {
      const started = await (deps.startRun ?? startComposerQueueAutoRun)(consumed);
      if (!started) {
        restoreConsumedQueueItem(consumed);
        logGatewayWarn('待发队列自动续跑：网关未受理，已尝试回填队列', {
          itemId: consumed.clientRequestId,
          sessionId: consumed.sessionId,
        });
        return;
      }
      logGatewayInfo('待发队列自动续跑：已发起下一轮', {
        itemId: consumed.clientRequestId,
        sessionId: consumed.sessionId,
      });
    } catch (error) {
      restoreConsumedQueueItem(consumed);
      logGatewayWarn('待发队列自动续跑：起轮异常，已尝试回填队列', {
        itemId: consumed.clientRequestId,
        sessionId: consumed.sessionId,
        ...describeError(error),
      });
    }
  })();
}

/**
 * 供队列 HTTP 路由在条目被删除 / 附件回填后调用：重新判定一次「是否还有阻塞」，让提醒
 * 不必等到下一个回合收尾才消失（用户在页面上手动移出阻塞条目时，红点应当立刻灭）。
 *
 * 与 `takeComposerQueueAutoRun` 内的判定同源（同一个 `resolveAutoRunPayload`），因此不会
 * 出现「drain 认为阻塞、路由认为不阻塞」两套口径。**绝不抛错**：路由侧的成功响应不该被
 * 一次提醒运算拖垮。
 */
export function syncComposerQueueBlockedNotification(input: {
  sessionId: string;
  userId: string;
}): void {
  try {
    const items = listComposerQueueItems(input);
    const head = items[0];
    const payload = head ? resolveAutoRunPayload(head) : null;
    syncQueueBlockedNotification({
      // `ok` / `skipped` 都意味着「队首此刻没有值得提醒的阻塞」，一律收口：
      // 这条路径由用户主动改动队列触发，队首已换人，旧提醒不再指向任何在卡的东西。
      blockedReason: payload?.kind === 'blocked' ? payload.reason : null,
      queuePositionLabel: buildQueuePositionLabel({ position: 1, total: items.length }),
      sessionId: input.sessionId,
      userId: input.userId,
    });
  } catch (error) {
    logGatewayWarn('待发队列自动续跑：阻塞提醒重新判定失败，本次跳过', {
      sessionId: input.sessionId,
      ...describeError(error),
    });
  }
}
