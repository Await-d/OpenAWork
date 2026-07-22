import { View, Text, StyleSheet } from 'react-native';
import { useNetworkState } from '../hooks/useNetworkState';
import { colors } from '../theme/colors';

export function NetworkBanner() {
  const { isConnected } = useNetworkState();

  if (isConnected) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>无网络连接</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.danger,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  text: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
});
