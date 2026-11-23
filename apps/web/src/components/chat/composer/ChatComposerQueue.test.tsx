import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatComposerQueue } from './ChatComposerQueue.js';

afterEach(cleanup);
it('队首超限显示可访问暂停提示，保留恢复和移除操作，上限提升或移除后消失', () => {
  const restore = vi.fn();
  const remove = vi.fn();
  const item = { id: 'head', label: '待发正文', exceedsMessageLimit: true };
  const props = { onRestoreQueuedMessage: restore, onRemoveQueuedMessage: remove };
  const view = render(<ChatComposerQueue {...props} queuedMessages={[item]} />);
  expect(view.getByRole('alert').textContent).toBe(
    '队首消息超过当前上限，队列已暂停。请恢复编辑或移除该消息。',
  );
  fireEvent.click(view.getByText('恢复'));
  fireEvent.click(view.getByLabelText('移出队列'));
  expect(restore).toHaveBeenCalledWith('head');
  expect(remove).toHaveBeenCalledWith('head');
  view.rerender(
    <ChatComposerQueue {...props} queuedMessages={[{ ...item, exceedsMessageLimit: false }]} />,
  );
  expect(view.queryByRole('alert')).toBeNull();
  view.rerender(<ChatComposerQueue {...props} queuedMessages={[]} />);
  expect(view.queryByRole('alert')).toBeNull();
});
