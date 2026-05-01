import { useLocalSearchParams } from 'expo-router';
import { View, Text } from 'react-native';
import { ChatScreen as MobileChatScreen } from '../../src/screens/ChatScreen.js';

export default function ChatRouteScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();

  if (!sessionId) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0f172a',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#94a3b8' }}>Missing session id</Text>
      </View>
    );
  }

  return <MobileChatScreen sessionId={sessionId} />;
}
