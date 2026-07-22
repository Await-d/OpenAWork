import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { OnboardingWizard } from '../src/onboarding/OnboardingWizard';
import { colors } from '../src/theme/colors';

export default function OnboardingScreen() {
  const router = useRouter();

  const handleComplete = useCallback(async () => {
    await AsyncStorage.setItem('onboarded', 'true');
    router.replace('/');
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgBase }}>
      <OnboardingWizard
        onComplete={() => {
          void handleComplete();
        }}
      />
    </View>
  );
}
