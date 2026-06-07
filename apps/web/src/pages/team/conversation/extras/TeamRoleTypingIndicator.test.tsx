// @vitest-environment jsdom
/**
 * TeamRoleTypingIndicator smoke：visible=false 不渲染；visible=true 按层级显示
 * 角色短名 + 「正在思考」。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TeamRoleTypingIndicator } from './TeamRoleTypingIndicator.js';

afterEach(() => cleanup());

describe('TeamRoleTypingIndicator', () => {
  it('visible=false 时不渲染', () => {
    const { container } = render(<TeamRoleTypingIndicator roleLayer="executor" visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('visible=true 显示对应层级的「正在思考」', () => {
    render(<TeamRoleTypingIndicator roleLayer="executor" visible />);
    expect(screen.getByText('执行 正在思考')).toBeTruthy();
  });

  it('未知层级回退中性「团队」身份', () => {
    render(<TeamRoleTypingIndicator roleLayer={null} visible />);
    expect(screen.getByText('团队 正在思考')).toBeTruthy();
  });
});
