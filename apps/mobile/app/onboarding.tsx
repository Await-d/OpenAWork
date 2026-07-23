import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { OnboardingWizard } from '../src/onboarding/OnboardingWizard';
import { Screen } from '../src/components/Screen';

export default function OnboardingScreen() {
  const router = useRouter();

  const handleComplete = useCallback(async () => {
    await AsyncStorage.setItem('onboarded', 'true');
    router.replace('/');
  }, [router]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <OnboardingWizard
        onComplete={() => {
          void handleComplete();
        }}
      />
    </Screen>
  );
}
