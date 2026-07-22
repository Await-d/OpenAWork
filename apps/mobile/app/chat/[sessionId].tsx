import { useLocalSearchParams } from 'expo-router';
import { View, Text } from 'react-native';
import { ChatScreen } from '../../src/screens/ChatScreen';
import { colors } from '../../src/theme/colors';

export default function ChatPage() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  if (!sessionId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bgBase,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.textMuted }}>Missing session id</Text>
      </View>
    );
  }

  return <ChatScreen sessionId={sessionId} />;
}
