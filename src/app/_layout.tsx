import '@/global.css';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ErrorState, Screen } from '@/components/ui';
import { useSession } from '@/features/session/api';
import { AppProviders } from '@/providers/app-providers';
import { fonts } from '@/theme/fonts';
import { useColors } from '@/theme/use-colors';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fonts);

  return <AppProviders>{fontsLoaded || fontError ? <RootNavigator /> : null}</AppProviders>;
}

/** Keeps the splash screen up until the session is known, then routes by onboarding state. */
function RootNavigator() {
  const session = useSession();
  const colors = useColors();

  useEffect(() => {
    if (!session.isPending) SplashScreen.hideAsync();
  }, [session.isPending]);

  if (session.isPending) return null;
  if (session.isError) {
    return (
      <Screen safeBottom className="justify-center">
        <ErrorState onRetry={() => session.refetch()} />
      </Screen>
    );
  }

  const onboarded = session.data.onboardingCompleted;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="post/[id]/why"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetCornerRadius: 28,
            sheetGrabberVisible: false,
            contentStyle: { backgroundColor: colors.card },
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}
