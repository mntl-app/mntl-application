import { QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { SafeAreaListener } from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';

import { createQueryClient, subscribeToAppFocus } from '@/lib/query-client';
import { useColors } from '@/theme/use-colors';

/** App-wide providers: data cache, safe-area insets for Uniwind's `*-safe` classes, navigation colours. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const colors = useColors();

  useEffect(subscribeToAppFocus, []);

  const navigationTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.cobalt,
      background: colors.canvas,
      card: colors.card,
      text: colors.ink,
      border: colors.line,
    },
  };

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)} style={{ flex: 1 }}>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="dark" />
          {children}
        </ThemeProvider>
      </SafeAreaListener>
    </QueryClientProvider>
  );
}
