// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryEditDialog from './history-edit-dialog.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

describe('HistoryEditDialog', () => {
  it('keeps hook order stable when opening in StrictMode', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await act(async () => {
      root!.render(
        <StrictMode>
          <HistoryEditDialog
            initialText="```ts\nconsole.log(1)\n```"
            onClose={() => undefined}
            onContinueCurrent={() => undefined}
            onCreateBranch={() => undefined}
            open={false}
          />
        </StrictMode>,
      );
    });

    await act(async () => {
      root!.render(
        <StrictMode>
          <HistoryEditDialog
            initialText="```ts\nconsole.log(1)\n```"
            onClose={() => undefined}
            onContinueCurrent={() => undefined}
            onCreateBranch={() => undefined}
            open
          />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    const errorLog = consoleErrorSpy.mock.calls
      .flatMap((args) => args.map((arg) => String(arg)))
      .join(' ');

    expect(errorLog).not.toContain('Expected static flag was missing');
    expect(errorLog).not.toContain('Rendered fewer hooks than expected');

    const textarea = container?.querySelector(
      '[data-testid="history-edit-dialog-textarea"]',
    ) as HTMLTextAreaElement | null;

    expect(textarea?.value).toContain('console.log(1)');
  });
});
