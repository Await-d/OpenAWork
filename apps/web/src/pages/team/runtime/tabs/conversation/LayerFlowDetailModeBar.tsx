import { SegmentedToggle } from '../../shared/content-kit/index.js';

export interface LayerFlowDetailModeBarProps {
  detailMode: 'session' | 'thread';
  onChange: (value: 'session' | 'thread') => void;
}

export function LayerFlowDetailModeBar({ detailMode, onChange }: LayerFlowDetailModeBarProps) {
  return (
    <SegmentedToggle<'session' | 'thread'>
      ariaLabel="层级流动详情模式"
      size="sm"
      value={detailMode}
      onChange={onChange}
      options={[
        { value: 'session', label: '单层', icon: '💬' },
        { value: 'thread', label: '跨层线程', icon: '🧵' },
      ]}
    />
  );
}
