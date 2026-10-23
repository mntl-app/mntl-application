import { View } from 'react-native';

import type { User } from '@/api';
import { Avatar, Button, Text, type TextTone } from '@/components/ui';
import { useCopy } from '@/i18n';
import { joinWithDot } from '@/lib/format';

type ProfileSummaryProps = {
  user: User;
  onEdit?: () => void;
  onShare: () => void;
};

/** Avatar, name, bio, stats and profile actions at the top of a profile. */
export function ProfileSummary({ user, onEdit, onShare }: ProfileSummaryProps) {
  const copy = useCopy();
  const { stats } = user;

  return (
    <View className="gap-5">
      <View className="flex-row items-center gap-4">
        <Avatar uri={user.avatarUrl} size="lg" label={user.displayName} />
        <View className="flex-1 gap-0.5">
          <Text variant="display" accessibilityRole="header" numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text variant="small" tone="muted">
            {joinWithDot(`@${user.handle}`, user.location)}
          </Text>
        </View>
      </View>

      {user.bio ? <Text>{user.bio}</Text> : null}

      <View className="flex-row items-center gap-6">
        <Stat value={String(stats.posts)} label={copy.profile.posts} />
        <Stat value={String(stats.following)} label={copy.profile.following} />
        {stats.followers === null ? (
          <Stat value={copy.profile.hidden} label={copy.profile.followers} tone="cobalt" />
        ) : (
          <Stat value={String(stats.followers)} label={copy.profile.followers} />
        )}
      </View>

      <View className="flex-row items-center gap-2.5">
        <Button variant="secondary" label={copy.profile.edit} onPress={onEdit} className="flex-1" />
        <Button variant="secondary" label={copy.profile.share} onPress={onShare} className="flex-1" />
      </View>
    </View>
  );
}

function Stat({ value, label, tone = 'ink' }: { value: string; label: string; tone?: TextTone }) {
  return (
    <View accessible accessibilityLabel={`${value} ${label}`}>
      <Text variant="title" tone={tone}>
        {value}
      </Text>
      <Text variant="small" tone="muted">
        {label}
      </Text>
    </View>
  );
}
