// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextUsageMeter } from './context-usage-meter.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

describe('ContextUsageMeter', () => {
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
    root = null;
    container?.remove();
    container = null;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it('shows a visible estimate marker and matching tooltip text', async () => {
    await act(async () => {
      root?.render(<ContextUsageMeter estimated={true} usedTokens={50_000} maxTokens={200_000} />);
    });

    const meter = container?.querySelector('[data-testid="chat-context-usage-meter"]');
    expect(meter?.textContent).toContain('≈25%');
    expect(meter?.getAttribute('title')).toContain('上下文估算已用 50k / 200k（25%）');
    expect(meter?.getAttribute('title')).toContain('基于当前会话消息与流式输出估算');
  });

  it('omits the estimate marker when exact usage is available', async () => {
    await act(async () => {
      root?.render(<ContextUsageMeter estimated={false} usedTokens={65_000} maxTokens={200_000} />);
    });

    const meter = container?.querySelector('[data-testid="chat-context-usage-meter"]');
    expect(meter?.textContent).toContain('33%');
    expect(meter?.textContent).not.toContain('≈');
    expect(meter?.getAttribute('title')).toContain('上下文已用 65k / 200k（33%）');
    expect(meter?.getAttribute('title')).not.toContain('估算');
  });

  it('clamps aria-valuenow while preserving over-limit text for accessibility', async () => {
    await act(async () => {
      root?.render(<ContextUsageMeter estimated={true} usedTokens={280_000} maxTokens={200_000} />);
    });

    const meter = container?.querySelector('[data-testid="chat-context-usage-meter"]');
    expect(meter?.textContent).toContain('≈140%');
    expect(meter?.getAttribute('aria-valuenow')).toBe('200000');
    expect(meter?.getAttribute('aria-valuetext')).toContain('280k / 200k（140%）');
    expect(meter?.getAttribute('aria-valuetext')).toContain('已接近或超过上下文窗口');
  });
});
