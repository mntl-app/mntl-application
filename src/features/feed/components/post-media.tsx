import { Image } from 'expo-image';
import { View } from 'react-native';

import type { MediaAsset } from '@/api';

/** Post photo. The design's soft cobalt-to-sand gradient shows while it loads or if it fails. */
export function PostMedia({ media }: { media: MediaAsset }) {
  return (
    <View className="h-[190px] overflow-hidden rounded-[18px] bg-linear-150 from-cobalt-soft from-14% to-sand to-86%">
      <Image
        source={{ uri: media.url }}
        accessibilityLabel={media.alt}
        contentFit="cover"
        transition={200}
        style={{ flex: 1 }}
      />
    </View>
  );
}
