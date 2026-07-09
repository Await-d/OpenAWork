import { randomUUID } from 'node:crypto';
import type { ChannelStreamingHandle } from './types.js';
import { channelFetch } from './channel-http.js';
import { DINGTALK_NEW_API } from './dingtalk-api-types.js';

export interface DingTalkChatMeta {
  readonly conversationType: 'p2p' | 'group';
  readonly senderId: string;
}

interface DingTalkCardStreamingDeps {
  readonly pluginId: string;
  readonly robotCode?: string;
  readonly cardTemplateId?: string;
  readonly getToken: () => Promise<string>;
  readonly nextGuid: () => string;
}

interface DingTalkStreamingCreateInput {
  readonly chatId: string;
  readonly initialContent: string;
  readonly chatMeta: DingTalkChatMeta | null;
}

interface DingTalkCardSpace {
  readonly spaceType: 'IM_GROUP' | 'IM_ROBOT';
  readonly openSpaceId: string;
}

interface DingTalkCardApiResponse {
  readonly success?: boolean;
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly message?: string;
}

export class DingTalkCardStreamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DingTalkCardStreamingError';
  }
}

const STREAM_THROTTLE_MS = 500;
const STREAM_KEY = 'content';

export class DingTalkCardStreamingClient {
  private readonly deps: DingTalkCardStreamingDeps;

  constructor(deps: DingTalkCardStreamingDeps) {
    this.deps = deps;
  }

  async createHandle(input: DingTalkStreamingCreateInput): Promise<ChannelStreamingHandle> {
    const { cardTemplateId } = this.deps;
    if (!cardTemplateId) {
      throw new DingTalkCardStreamingError('DingTalk cardTemplateId is not configured');
    }

    const space = buildOpenSpace(input.chatId, input.chatMeta);
    const outTrackId = `oaw-${randomUUID()}`;
    await this.createAndDeliverCard({
      cardTemplateId,
      outTrackId,
      space,
      initialContent: input.initialContent || 'Thinking...',
    });

    let lastUpdateTime = 0;
    return {
      update: async (content: string): Promise<void> => {
        const now = Date.now();
        if (now - lastUpdateTime < STREAM_THROTTLE_MS) {
          return;
        }
        lastUpdateTime = now;
        await this.streamingUpdate({ outTrackId, content, isFinalize: false });
      },
      finish: async (finalContent: string): Promise<void> => {
        await this.streamingUpdate({ outTrackId, content: finalContent, isFinalize: true });
      },
    };
  }

  private async createAndDeliverCard(input: {
    readonly cardTemplateId: string;
    readonly outTrackId: string;
    readonly space: DingTalkCardSpace;
    readonly initialContent: string;
  }): Promise<void> {
    const token = await this.deps.getToken();
    const deliverModel =
      input.space.spaceType === 'IM_GROUP'
        ? {
            imGroupOpenDeliverModel: { robotCode: this.deps.robotCode ?? this.deps.pluginId },
            imGroupOpenSpaceModel: { supportForward: true },
          }
        : {
            imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT' },
            imRobotOpenSpaceModel: { supportForward: false },
          };
    const resp = await channelFetch(`${DINGTALK_NEW_API}/card/instances/createAndDeliver`, {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cardTemplateId: input.cardTemplateId,
        outTrackId: input.outTrackId,
        openSpaceId: input.space.openSpaceId,
        callbackType: 'STREAM',
        cardData: {
          cardParamMap: { [STREAM_KEY]: input.initialContent },
        },
        ...deliverModel,
      }),
    });
    await assertDingTalkCardSuccess(resp, 'createAndDeliverCard');
  }

  private async streamingUpdate(input: {
    readonly outTrackId: string;
    readonly content: string;
    readonly isFinalize: boolean;
  }): Promise<void> {
    const token = await this.deps.getToken();
    const resp = await channelFetch(`${DINGTALK_NEW_API}/card/streaming`, {
      method: 'PUT',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        outTrackId: input.outTrackId,
        guid: this.deps.nextGuid(),
        key: STREAM_KEY,
        content: input.content,
        isFull: true,
        isFinalize: input.isFinalize,
        isError: false,
      }),
    });
    await assertDingTalkCardSuccess(resp, 'streamingUpdate');
  }
}

function buildOpenSpace(chatId: string, meta: DingTalkChatMeta | null): DingTalkCardSpace {
  if (meta?.conversationType === 'p2p') {
    const spaceId = meta.senderId || chatId;
    return { spaceType: 'IM_ROBOT', openSpaceId: `dtv1.card//IM_ROBOT.${spaceId}` };
  }
  return { spaceType: 'IM_GROUP', openSpaceId: `dtv1.card//IM_GROUP.${chatId}` };
}

async function assertDingTalkCardSuccess(resp: Response, operation: string): Promise<void> {
  const data = (await resp.json()) as DingTalkCardApiResponse;
  if (!resp.ok || data.success === false || data.errcode) {
    const reason = data.errmsg ?? data.message ?? `${resp.status}`;
    throw new DingTalkCardStreamingError(`DingTalk ${operation} failed: ${reason}`);
  }
}
