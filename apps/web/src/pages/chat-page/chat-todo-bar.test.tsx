import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatTodoBar } from './chat-todo-bar.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ChatTodoBar', () => {
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

  it('shows both main and temp todos after expanding in the chat area', async () => {
    await act(async () => {
      root!.render(
        <ChatTodoBar
          editorMode={false}
          rightOpen={false}
          sessionTodos={[
            { content: '主待办 QA', lane: 'main', status: 'in_progress', priority: 'high' },
            { content: '临时待办 QA', lane: 'temp', status: 'pending', priority: 'low' },
          ]}
        />,
      );
    });

    const todoBar = container!.querySelector('[data-testid="chat-todo-bar"]');
    expect(todoBar).not.toBeNull();
    expect(todoBar?.textContent).toContain('正在进行：主待办 QA');
    expect(todoBar?.textContent).toContain('主待办');
    expect(todoBar?.textContent).toContain('临时待办');

    const toggle = container!.querySelector(
      '[data-testid="chat-todo-toggle"]',
    ) as HTMLButtonElement | null;
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(todoBar?.textContent).toContain('主待办 QA');
    expect(todoBar?.textContent).toContain('临时待办 QA');
    expect(todoBar?.textContent).toContain('高优先级');
    expect(todoBar?.textContent).toContain('低优先级');
  });

  it('keeps the todo bar visible when the right panel is open', async () => {
    await act(async () => {
      root!.render(
        <ChatTodoBar
          editorMode={false}
          rightOpen={true}
          sessionTodos={[
            {
              content: '继续修复聊天待办栏',
              lane: 'main',
              status: 'in_progress',
              priority: 'high',
            },
          ]}
        />,
      );
    });

    const todoBar = container!.querySelector('[data-testid="chat-todo-bar"]');
    expect(todoBar).not.toBeNull();
    expect(todoBar?.textContent).toContain('待办清单');
    expect(todoBar?.textContent).toContain('继续修复聊天待办栏');
  });
});
