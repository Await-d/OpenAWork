// @vitest-environment jsdom
/**
 * TeamMessageRoleHeader smoke：角色身份头按 roleLayer 渲染对应层级名 + 代号，
 * 未知层回退中性「团队」身份。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TeamMessageRoleHeader } from './TeamMessageRoleHeader.js';

afterEach(() => cleanup());

describe('TeamMessageRoleHeader', () => {
  it('执行层显示「执行层」与代号 e', () => {
    render(<TeamMessageRoleHeader roleLayer="executor" />);
    expect(screen.getByText('执行层')).toBeTruthy();
    expect(screen.getByText('e')).toBeTruthy();
  });

  it('评审层显示「评审层」与代号 g', () => {
    render(<TeamMessageRoleHeader roleLayer="reviewer" />);
    expect(screen.getByText('评审层')).toBeTruthy();
    expect(screen.getByText('g')).toBeTruthy();
  });

  it('接待层显示「接待层」与代号 b', () => {
    render(<TeamMessageRoleHeader roleLayer="reception" />);
    expect(screen.getByText('接待层')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('未知 / null 层回退到中性「团队」身份（无代号）', () => {
    render(<TeamMessageRoleHeader roleLayer={null} />);
    expect(screen.getByText('团队')).toBeTruthy();
  });
});
