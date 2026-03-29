import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export const MobileLayoutContext = createContext<{ isMobile: boolean }>({ isMobile: false });

export function useMobileLayout(): { isMobile: boolean } {
  return useContext(MobileLayoutContext);
}

export interface MobileResponsiveWrapperProps {
  children: ReactNode;
  breakpoint?: number;
}

export function MobileResponsiveWrapper({
  children,
  breakpoint = 768,
}: MobileResponsiveWrapperProps) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return (
    <MobileLayoutContext.Provider value={{ isMobile }}>{children}</MobileLayoutContext.Provider>
  );
}
