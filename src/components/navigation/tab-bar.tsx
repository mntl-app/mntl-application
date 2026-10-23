import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, View } from 'react-native';

import { Icon, Text } from '@/components/ui';

/**
 * The MNTL tab bar from the Figma "Tab Bar" component: icon and label per tab, with a cobalt dot
 * under the active one. Tabs, titles and icons come from the `Tabs.Screen` options.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  return (
    <View
      role="tablist"
      className="flex-row justify-between border-t border-line bg-card px-[34px] pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const label = options.title ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        return (
          <Pressable
            key={route.key}
            role="tab"
            aria-selected={focused}
            aria-label={options.tabBarAccessibilityLabel ?? label}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            hitSlop={8}
            className="items-center gap-1 active:opacity-70">
            {options.tabBarIcon?.({ focused, color: '', size: 24 })}
            <Text variant="small">{label}</Text>
            {focused ? <Icon name="active-dot" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
