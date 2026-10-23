import { Image } from 'expo-image';

/**
 * Icons exported from Figma, each drawn at its design size and colour. Add new icons here.
 * Note: `why` is empty in the Figma file (its vector has no paths), so it only reserves space.
 */
const icons = {
  home: { source: require('@/assets/icons/home.svg'), size: 24 },
  sliders: { source: require('@/assets/icons/sliders.svg'), size: 24 },
  leaf: { source: require('@/assets/icons/leaf.svg'), size: 24 },
  user: { source: require('@/assets/icons/user.svg'), size: 24 },
  heart: { source: require('@/assets/icons/heart.svg'), size: 18 },
  chat: { source: require('@/assets/icons/chat.svg'), size: 18 },
  why: { source: require('@/assets/icons/why.svg'), size: 15 },
  check: { source: require('@/assets/icons/check.svg'), size: 14 },
  'leaf-cobalt': { source: require('@/assets/icons/leaf-cobalt.svg'), size: 14 },
  'active-dot': { source: require('@/assets/icons/active-dot.svg'), size: 5 },
} as const;

export type IconName = keyof typeof icons;

/** Decorative icon; give the surrounding control the accessible label. */
export function Icon({ name }: { name: IconName }) {
  const { source, size } = icons[name];
  return (
    <Image
      source={source}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessible={false}
    />
  );
}
