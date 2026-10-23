import { Image } from 'expo-image';

const sizes = {
  sm: { px: 38, placeholder: require('@/assets/images/avatar-placeholder-sm.svg') },
  lg: { px: 76, placeholder: require('@/assets/images/avatar-placeholder-lg.svg') },
} as const;

type AvatarProps = {
  /** Profile photo; the placeholder circle from the design is shown when absent or loading. */
  uri: string | null;
  size?: keyof typeof sizes;
  label: string;
};

export function Avatar({ uri, size = 'sm', label }: AvatarProps) {
  const { px, placeholder } = sizes[size];
  return (
    <Image
      source={uri ? { uri } : placeholder}
      placeholder={placeholder}
      style={{ width: px, height: px, borderRadius: px / 2 }}
      contentFit="cover"
      accessibilityLabel={label}
    />
  );
}
