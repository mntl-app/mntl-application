import { Tabs } from 'expo-router';

import { TabBar } from '@/components/navigation/tab-bar';
import { Icon } from '@/components/ui';
import { useCopy } from '@/i18n';

export default function TabsLayout() {
  const copy = useCopy();

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: copy.tabs.feed, tabBarIcon: () => <Icon name="home" /> }} />
      <Tabs.Screen
        name="algorithm"
        options={{ title: copy.tabs.algorithm, tabBarIcon: () => <Icon name="sliders" /> }}
      />
      <Tabs.Screen
        name="wellbeing"
        options={{ title: copy.tabs.wellbeing, tabBarIcon: () => <Icon name="leaf" /> }}
      />
      <Tabs.Screen name="profile" options={{ title: copy.tabs.profile, tabBarIcon: () => <Icon name="user" /> }} />
    </Tabs>
  );
}
