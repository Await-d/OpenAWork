import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolCallCard } from '@openAwork/shared-ui';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ToolCallCard todo summaries', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it('shows summary labels for temp todo tools', async () => {
    await act(async () => {
      root!.render(
        <div>
          <ToolCallCard
            toolName="subtodowrite"
            input={{
              todos: [
                { content: '记录临时想法', status: 'pending', priority: 'low' },
                { content: '补充验证步骤', status: 'in_progress', priority: 'medium' },
              ],
            }}
          />
          <ToolCallCard toolName="subtodoread" input={{}} />
        </div>,
      );
    });

    await flushEffects();

    expect(container?.textContent).toContain('2 项临时待办');
    expect(container?.textContent).toContain('读取当前临时待办');
  });
});
