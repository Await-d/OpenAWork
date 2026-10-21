export type AttachStreamDisconnectResult = 'continue' | 'handled';

/**
 * SSE 关闭原因（由 `connectAttachEventSource` 的关闭判定给出）。
 *
 * - `attach_stream_disconnected`：确实收到过事件后断开，真实中断。
 * - `attach_stream_silent_close`：打开后一个事件都没收到就结束，多半是服务端
 *   回放完毕立即关闭（正常 EOF）或校验失败，不应向用户报「连接中断」。
 */
export type AttachStreamCloseReason = 'attach_stream_disconnected' | 'attach_stream_silent_close';

export interface AttachStreamReconnectWiringOptions {
  attachSessionViewEpoch: number;
  handleAttachReconnect: (reason?: AttachStreamCloseReason, technicalDetail?: string) => void;
  isCurrentSessionRequest: (sessionId: string, expectedEpoch: number) => boolean;
  requestSessionListRefresh: () => void;
  sessionId: string;
}

export interface AttachStreamReconnectWiring {
  handleAttachDisconnectError: (code: string) => AttachStreamDisconnectResult;
  handleReconnectRequired: (reason?: AttachStreamCloseReason, technicalDetail?: string) => void;
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
    handleReconnectRequired: (reason, technicalDetail) => {
      handleAttachReconnect(reason, technicalDetail);
    },
  };
}
