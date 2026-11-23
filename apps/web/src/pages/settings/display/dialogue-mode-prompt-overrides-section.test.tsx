import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogueModePromptOverridesSection } from './dialogue-mode-prompt-overrides-section.js';

const clientMock = vi.hoisted(() => ({
  read: vi.fn(),
  writeDialogueMode: vi.fn(),
  resetDialogueMode: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createPromptOverridesClient: () => clientMock,
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: <T,>(selector: (state: Record<string, unknown>) => T): T =>
    selector({ accessToken: 'token-1', gatewayUrl: 'http://gateway' }),
}));

const SNAPSHOT = {
  modes: [
    { mode: 'clarify', defaultText: 'D-clarify', effectiveText: 'D-clarify', hasOverride: false },
    { mode: 'coding', defaultText: 'D-coding', effectiveText: 'E-coding', hasOverride: true },
    {
      mode: 'programmer',
      defaultText: 'D-programmer',
      effectiveText: 'D-programmer',
      hasOverride: false,
    },
  ],
  maxChars: 100,
  configState: 'ok',
};

beforeEach(() => {
  clientMock.read.mockReset();
  clientMock.writeDialogueMode.mockReset();
  clientMock.resetDialogueMode.mockReset();
  clientMock.read.mockResolvedValue(SNAPSHOT);
});

afterEach(() => {
  cleanup();
});

describe('DialogueModePromptOverridesSection', () => {
  it('加载后渲染三种模式，并展示各自的有效文本', async () => {
    render(<DialogueModePromptOverridesSection />);

    expect(await screen.findByLabelText('澄清模式提示词')).toBeTruthy();
    expect(screen.getByLabelText('程序员模式提示词')).toBeTruthy();
    expect((screen.getByLabelText('编程模式提示词') as HTMLTextAreaElement).value).toBe('E-coding');
    expect((screen.getByLabelText('澄清模式提示词') as HTMLTextAreaElement).value).toBe(
      'D-clarify',
    );
  });

  it('未编辑时禁用保存，避免把默认值当成覆盖落库', async () => {
    render(<DialogueModePromptOverridesSection />);
    await screen.findByLabelText('澄清模式提示词');

    // 澄清模式草稿初值 = effectiveText（此处等于 defaultText），未改动 → 保存必须禁用。
    const clarifySave = screen.getAllByRole('button', { name: '保存' })[0] as HTMLButtonElement;
    expect(clarifySave.disabled).toBe(true);

    // 已覆盖模式（coding：effectiveText 已偏离 defaultText）同样未编辑 → 也禁用，
    // 重复保存同一文本无意义。
    const codingSave = screen.getAllByRole('button', { name: '保存' })[1] as HTMLButtonElement;
    expect(codingSave.disabled).toBe(true);

    // 编辑使草稿偏离有效值后才可保存。
    const textarea = screen.getByLabelText('澄清模式提示词') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'D-clarify 改动' } });
    const clarifySaveAfterEdit = screen.getAllByRole('button', {
      name: '保存',
    })[0] as HTMLButtonElement;
    expect(clarifySaveAfterEdit.disabled).toBe(false);
  });

  it('保存时提交对应模式的文本并展示反馈', async () => {
    clientMock.writeDialogueMode.mockResolvedValue({
      mode: 'clarify',
      defaultText: 'D-clarify',
      effectiveText: '新内容',
      hasOverride: true,
    });

    render(<DialogueModePromptOverridesSection />);
    const textarea = await screen.findByLabelText('澄清模式提示词');
    fireEvent.change(textarea, { target: { value: '新内容' } });

    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0] as HTMLButtonElement);

    await waitFor(() =>
      expect(clientMock.writeDialogueMode).toHaveBeenCalledWith('token-1', 'clarify', '新内容'),
    );
    expect(await screen.findByText('已保存模式提示词')).toBeTruthy();
  });

  it('恢复默认仅对有覆盖的模式可用', async () => {
    clientMock.resetDialogueMode.mockResolvedValue({
      mode: 'coding',
      defaultText: 'D-coding',
      effectiveText: 'D-coding',
      hasOverride: false,
    });

    render(<DialogueModePromptOverridesSection />);
    await screen.findByLabelText('编程模式提示词');

    const resetButtons = screen.getAllByRole('button', { name: '恢复默认' });
    expect((resetButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((resetButtons[1] as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(resetButtons[1] as HTMLButtonElement);
    await waitFor(() =>
      expect(clientMock.resetDialogueMode).toHaveBeenCalledWith('token-1', 'coding'),
    );
  });

  it('超过上限时禁用保存并显示超限计数', async () => {
    render(<DialogueModePromptOverridesSection />);
    const textarea = await screen.findByLabelText('澄清模式提示词');

    fireEvent.change(textarea, { target: { value: 'x'.repeat(101) } });

    expect((screen.getAllByRole('button', { name: '保存' })[0] as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('101 / 100')).toBeTruthy();
  });

  it('配置损坏时恢复按钮仍可用（否则用户无法重建配置）', async () => {
    clientMock.read.mockResolvedValue({ ...SNAPSHOT, configState: 'corrupt' });
    clientMock.resetDialogueMode.mockResolvedValue({
      mode: 'clarify',
      defaultText: 'D-clarify',
      effectiveText: 'D-clarify',
      hasOverride: false,
    });

    render(<DialogueModePromptOverridesSection />);
    await screen.findByLabelText('澄清模式提示词');

    expect(screen.getByText(/检测到无法解析的历史配置/)).toBeTruthy();

    const resetButton = screen.getAllByRole('button', { name: '恢复默认' })[0] as HTMLButtonElement;
    expect(resetButton.disabled).toBe(false);

    fireEvent.click(resetButton);
    await waitFor(() =>
      expect(clientMock.resetDialogueMode).toHaveBeenCalledWith('token-1', 'clarify'),
    );
  });

  it('加载失败展示错误，重试后恢复', async () => {
    clientMock.read.mockRejectedValueOnce(new Error('加载模式提示词配置失败'));

    render(<DialogueModePromptOverridesSection />);
    expect(await screen.findByText('加载模式提示词配置失败')).toBeTruthy();

    clientMock.read.mockResolvedValueOnce(SNAPSHOT);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(clientMock.read).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('澄清模式提示词')).toBeTruthy();
  });
});
