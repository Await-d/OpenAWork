import { usePersistedStreamError } from './use-persisted-stream-error.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function ErrorProbe({ sessionId }: { sessionId: string | null }) {
  const [streamError, setStreamError] = usePersistedStreamError(sessionId);

  return (
    <>
      <button type="button" onClick={() => setStreamError('stream failed')}>
        保存错误
      </button>
      <output data-testid="stream-error">{streamError ?? ''}</output>
    </>
  );
}

describe('usePersistedStreamError', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: window.sessionStorage,
    });
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it('clears the previous session error before loading the next session', () => {
    // Given
    window.sessionStorage.setItem(
      'chat_stream_error_session-1',
      JSON.stringify({ error: 'session 1 failed', timestamp: Date.now() }),
    );
    const view = render(<ErrorProbe sessionId="session-1" />);

    // When
    view.rerender(<ErrorProbe sessionId="session-2" />);

    // Then
    expect(screen.getByTestId('stream-error').textContent).toBe('');
  });

  it('restores a saved error after the session page remounts', () => {
    // Given
    const firstView = render(<ErrorProbe sessionId="session-1" />);

    // When
    fireEvent.click(screen.getByRole('button', { name: '保存错误' }));
    firstView.unmount();
    render(<ErrorProbe sessionId="session-1" />);

    // Then
    expect(screen.getByTestId('stream-error').textContent).toBe('stream failed');
  });
});
