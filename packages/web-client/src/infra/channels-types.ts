export interface ChannelListResponse<TChannel> {
  channels?: TChannel[];
  error?: string;
}

export interface ChannelDescriptorListResponse<TDescriptor> {
  descriptors?: TDescriptor[];
  error?: string;
}

export interface ChannelMutationResponse<TChannel> {
  channel?: TChannel;
  error?: string;
  status?: TChannel extends { status: infer S } ? S : string;
}

export interface ChannelTargetsResponse<TTarget> {
  groups?: TTarget[];
  error?: string;
}

export interface ChannelDiagnostics {
  readonly status: string;
  readonly running: boolean;
  readonly transport?: string;
  readonly currentIntent?: string;
  readonly currentIntentDescription?: string;
  readonly identified?: boolean;
  readonly lastReadyAt?: number;
  readonly lastHeartbeatAckAt?: number;
  readonly lastDispatchAt?: number;
  readonly lastDispatchType?: string;
  readonly lastInboundAt?: number;
  readonly lastInboundAccepted?: boolean;
  readonly lastInboundType?: string;
  readonly lastInboundError?: string;
  readonly lastMessageAt?: number;
  readonly lastMessageChatId?: string;
  readonly lastIgnoredDispatchAt?: number;
  readonly lastIgnoredDispatchType?: string;
  readonly lastSocketCloseAt?: number;
  readonly lastSocketCloseCode?: number;
  readonly lastSocketCloseReason?: string;
  readonly lastErrorAt?: number;
  readonly lastError?: string;
  readonly note?: string;
}

export interface ChannelDiagnosticsResponse<TDiagnostics = ChannelDiagnostics> {
  diagnostics?: TDiagnostics;
  error?: string;
}

export interface ChannelConversationSummary {
  readonly id: string;
  readonly chatId: string;
  readonly chatName: string | null;
  readonly title: string;
  readonly stateStatus: string;
  readonly messageCount: number;
  readonly lastMessagePreview: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChannelConversationsResponse {
  conversations?: ChannelConversationSummary[];
  error?: string;
}

export interface WeixinLoginStartInput {
  readonly accountId?: string;
  readonly baseUrl?: string;
  readonly routeTag?: string;
  readonly botType?: string;
  readonly force?: boolean;
}

export interface WeixinLoginStartResponse {
  readonly sessionKey: string;
  readonly qrCodeUrl?: string;
  readonly message: string;
}

export interface WeixinLoginWaitInput {
  readonly sessionKey: string;
  readonly baseUrl?: string;
  readonly routeTag?: string;
  readonly botType?: string;
  readonly timeoutMs?: number;
}

export interface WeixinLoginWaitResponse {
  readonly connected: boolean;
  readonly message: string;
  readonly token?: string;
  readonly accountId?: string;
  readonly baseUrl?: string;
  readonly userId?: string;
}

export interface ChannelsClient<
  TChannel = Record<string, unknown>,
  TDescriptor = Record<string, unknown>,
  TTarget = Record<string, unknown>,
> {
  list(token: string, options?: { signal?: AbortSignal }): Promise<TChannel[]>;
  listDescriptors(token: string, options?: { signal?: AbortSignal }): Promise<TDescriptor[]>;
  create(token: string, draft: unknown): Promise<TChannel>;
  update(token: string, channelId: string, draft: unknown): Promise<TChannel>;
  remove(token: string, channelId: string): Promise<void>;
  start(token: string, channelId: string): Promise<{ status?: string }>;
  stop(token: string, channelId: string): Promise<{ status?: string }>;
  diagnostics(token: string, channelId: string): Promise<ChannelDiagnostics>;
  listTargets(token: string, channelId: string): Promise<TTarget[]>;
  listConversations(
    token: string,
    channelId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ChannelConversationSummary[]>;
  startWeixinLogin(token: string, input: WeixinLoginStartInput): Promise<WeixinLoginStartResponse>;
  waitWeixinLogin(token: string, input: WeixinLoginWaitInput): Promise<WeixinLoginWaitResponse>;
}
