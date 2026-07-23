import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomNavContentInset, bottomNavOccupiedHeight } from './metrics';

/** Hook: floating bottom nav total height including home indicator. */
export function useBottomNavOccupiedHeight(): number {
  const insets = useSafeAreaInsets();
  return bottomNavOccupiedHeight(insets.bottom);
}

/** Hook: content bottom padding so lists clear the floating bottom nav. */
export function useBottomNavContentInset(): number {
  const insets = useSafeAreaInsets();
  return bottomNavContentInset(insets.bottom);
}
