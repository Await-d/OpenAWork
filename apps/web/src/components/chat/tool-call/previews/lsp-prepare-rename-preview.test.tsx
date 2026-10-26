// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LspPrepareRenamePreview } from './lsp-prepare-rename-preview.js';

afterEach(cleanup);

describe('LspPrepareRenamePreview', () => {
  it('可重命名显示范围', () => {
    const { container } = render(
      <LspPrepareRenamePreview view={{ kind: 'available', range: '12:5-12:9' }} />,
    );

    expect(container.textContent).toContain('可重命名');
    expect(container.textContent).toContain('12:5-12:9');
    expect(container.querySelector('[data-prepare-rename="available"]')).not.toBeNull();
  });

  it('不可重命名显示否定态', () => {
    const { container } = render(<LspPrepareRenamePreview view={{ kind: 'unavailable' }} />);

    expect(container.textContent).toContain('不可重命名');
    expect(container.querySelector('[data-prepare-rename="unavailable"]')).not.toBeNull();
  });
});
