import { BrandLogo } from '@openAwork/shared-ui';

export interface TitlebarHomeButtonProps {
  readonly active: boolean;
  readonly onClick: () => void;
}

/**
 * 标题栏「首页位」按钮：融合布局左上角展示系统品牌 Logo，
 * Logo 本身即回首页入口（与 Rail 的「对话」按钮互为冗余入口）。
 */
export function TitlebarHomeButton({ active, onClick }: TitlebarHomeButtonProps) {
  return (
    <button
      type="button"
      // 它只是一个「回首页」入口，**不是** tablist 里的 tab：此前用 role="tab" +
      // aria-selected，axe 判 aria-required-parent（tab 必须位于 tablist 内）。
      // 用 aria-current 表达「当前就在首页」即可。
      aria-current={active ? 'page' : undefined}
      title="OpenAWork · 返回首页"
      aria-label="首页"
      className="titlebar-tab-strip__home-button"
      data-active={active || undefined}
      onClick={onClick}
    >
      <BrandLogo size={22} />
    </button>
  );
}
