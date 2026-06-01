import type { CSSProperties } from 'react';

/**
 * 选项勾选指示器：用形状区分单选 / 多选，符合通用交互习惯。
 * - 多选（multiple）：方形 checkbox —— 未选空方框、选中带对勾。
 * - 单选：圆形 radio —— 未选空圆圈、选中实心圆点。
 *
 * 用内联样式实现，自包含、不依赖外部 CSS / `<style>` 块，因此可同时被
 * 基于 CSS class 的 InlineQuestionPanel 和基于内联样式的 QuestionPromptCard 复用。
 * 纯展示，不影响选择 / 提交逻辑。
 *
 * 暴露 `data-select-mode="single|multiple"`，便于测试稳定断言形状而不依赖样式。
 */
export interface OptionSelectIndicatorProps {
  selected: boolean;
  multiple: boolean;
}

export function OptionSelectIndicator({ selected, multiple }: OptionSelectIndicatorProps) {
  if (multiple) {
    return (
      <span style={checkBoxStyle(selected)} data-select-mode="multiple" aria-hidden="true">
        {selected && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6L5 8.5L9.5 3.5"
              stroke="var(--accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    );
  }
  return (
    <span style={radioStyle(selected)} data-select-mode="single" aria-hidden="true">
      {selected && <span style={radioDotStyle} />}
    </span>
  );
}

const baseIndicatorStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  marginTop: 1,
  width: 14,
  height: 14,
  boxSizing: 'border-box',
};

const checkBoxStyle = (selected: boolean): CSSProperties => ({
  ...baseIndicatorStyle,
  borderRadius: 3,
  border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border-default)'}`,
  background: selected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
});

const radioStyle = (selected: boolean): CSSProperties => ({
  ...baseIndicatorStyle,
  borderRadius: '50%',
  border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border-default)'}`,
});

const radioDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--accent)',
};
