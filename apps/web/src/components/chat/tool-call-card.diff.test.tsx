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

describe('ToolCallCard diff view', () => {
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

  it('shows side-by-side before/after labels when expanding a diff tool output', async () => {
    await act(async () => {
      root!.render(
        <ToolCallCard
          toolName="workspace_review_diff"
          input={{ filePath: 'src/example.ts' }}
          output={{
            filePath: 'src/example.ts',
            diff: '@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;',
          }}
          status="completed"
        />,
      );
    });

    await flushEffects();
    expect(container?.textContent).toContain('文件变更视图');
    expect(container?.textContent).toContain('修改前');
    expect(container?.textContent).toContain('修改后');
    expect(container?.textContent).toContain('const b = 2;');
    expect(container?.textContent).toContain('const b = 3;');
  });

  it('switches between files for apply_patch multi-file outputs in the main message list', async () => {
    await act(async () => {
      root!.render(
        <ToolCallCard
          toolName="apply_patch"
          input={{ patchText: '*** Begin Patch' }}
          output={{
            files: [
              {
                path: 'src/example.ts',
                before: 'const a = 1;\nconst b = 2;',
                after: 'const a = 1;\nconst b = 3;\nconst c = 4;',
                additions: 2,
                deletions: 1,
                status: 'modified',
              },
              {
                path: 'src/feature.ts',
                before: '',
                after: 'export const feature = true;',
                additions: 1,
                deletions: 0,
                status: 'added',
              },
            ],
          }}
          status="completed"
        />,
      );
    });

    await flushEffects();
    expect(container?.textContent).toContain('文件切换');
    expect(container?.textContent).toContain('src/example.ts');
    expect(container?.textContent).toContain('src/feature.ts');
    expect(container?.textContent).toContain('const b = 2;');

    const buttons = Array.from(container?.querySelectorAll('button') ?? []);
    const featureButton = buttons.find((button) => button.textContent?.includes('feature.ts'));
    act(() => {
      featureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    expect(container?.textContent).toContain('export const feature = true;');
  });
});
