const SESSION_STREAM_RESUME_ATTACH_EVENT = 'openAwork:session-stream-resume-attach';

export function requestSessionStreamResumeAttach(sessionId: string): void {
  if (typeof window === 'undefined' || sessionId.trim().length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ sessionId: string }>(SESSION_STREAM_RESUME_ATTACH_EVENT, {
      detail: { sessionId },
    }),
  );
}

export function subscribeSessionStreamResumeAttach(
  onResumeAttach: (sessionId: string) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleResumeAttach = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : '';
    if (sessionId.trim().length > 0) {
      onResumeAttach(sessionId);
    }
  };

  window.addEventListener(SESSION_STREAM_RESUME_ATTACH_EVENT, handleResumeAttach);
  return () => window.removeEventListener(SESSION_STREAM_RESUME_ATTACH_EVENT, handleResumeAttach);
}
