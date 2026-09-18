import type { ReactElement } from 'react';

export interface BrandLogoProps {
  size?: number;
  variant?: 'filled' | 'plain';
  className?: string;
}

/**
 * 品牌 Logo 的测试替身：只保留尺寸与 class 契约，真实渐变/花瓣路径属于视觉细节，
 * 不需要在单测里渲染（避免 shared-ui 真实实现被拉进每个测试模块图）。
 */
export function BrandLogo({ size = 22, className }: BrandLogoProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-testid="brand-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
    />
  );
}
