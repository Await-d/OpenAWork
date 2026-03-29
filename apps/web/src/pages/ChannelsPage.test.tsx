// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ChannelsPage from './ChannelsPage.js';

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
});

describe('ChannelsPage', () => {
  it('redirects to the settings channels tab', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/channels']}>
          <Routes>
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/settings/channels" element={<div>渠道模板库</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('渠道模板库');
  });
});
