export interface ChatScreenSessionState<Message, Activity, Artifact> {
  activities: Activity[];
  artifactHistory: Artifact[];
  historyLoading: boolean;
  messages: Message[];
  sending: boolean;
}

export function buildChatScreenSessionResetState<
  Message,
  Activity,
  Artifact,
>(): ChatScreenSessionState<Message, Activity, Artifact> {
  return {
    activities: [],
    artifactHistory: [],
    historyLoading: true,
    messages: [],
    sending: false,
  };
}

export function buildChatScreenStaleSendAbortState<Message, Activity, Artifact>(
  state: ChatScreenSessionState<Message, Activity, Artifact>,
): ChatScreenSessionState<Message, Activity, Artifact> {
  return {
    ...state,
    sending: false,
  };
}
