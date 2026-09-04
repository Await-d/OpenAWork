export type AttachStreamDisconnectResult = 'continue' | 'handled';

export interface AttachStreamReconnectWiringOptions {
  attachSessionViewEpoch: number;
  handleAttachReconnect: (technicalDetail?: string) => void;
  isCurrentSessionRequest: (sessionId: string, expectedEpoch: number) => boolean;
  requestSessionListRefresh: () => void;
  sessionId: string;
}

export interface AttachStreamReconnectWiring {
  handleAttachDisconnectError: (code: string) => AttachStreamDisconnectResult;
  handleReconnectRequired: (technicalDetail?: string) => void;
}

export function createAttachStreamReconnectWiring(
  options: AttachStreamReconnectWiringOptions,
): AttachStreamReconnectWiring {
  const {
    attachSessionViewEpoch,
    handleAttachReconnect,
    isCurrentSessionRequest,
    requestSessionListRefresh,
    sessionId,
  } = options;

  return {
    handleAttachDisconnectError: (code) => {
      if (!isCurrentSessionRequest(sessionId, attachSessionViewEpoch)) {
        requestSessionListRefresh();
        return 'handled';
      }

      if (code === 'ATTACH_STREAM_DISCONNECTED') {
        handleAttachReconnect();
        return 'handled';
      }

      return 'continue';
    },
    handleReconnectRequired: (technicalDetail) => {
      handleAttachReconnect(technicalDetail);
    },
  };
}
