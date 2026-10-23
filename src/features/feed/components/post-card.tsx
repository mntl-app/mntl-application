import { View } from 'react-native';

import type { Post } from '@/api';
import { Avatar, Card, Icon, type IconName, Pill, Text } from '@/components/ui';
import { useCopy } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatRelativeTime, joinWithDot } from '@/lib/format';

import { PostMedia } from './post-media';

type PostCardProps = {
  post: Post;
  /** Shows the "Why this?" pill; called when it's pressed. */
  onPressWhy?: (post: Post) => void;
  /** False when the user hides like counts (wellbeing setting). */
  showLikeCount?: boolean;
  className?: string;
};

export function PostCard({ post, onPressWhy, showLikeCount = true, className }: PostCardProps) {
  const copy = useCopy();
  const media = post.media[0];

  return (
    <Card className={cn('gap-[14px] rounded-[24px] p-4', className)}>
      <View className="flex-row items-center gap-2.5">
        <Avatar uri={post.author.avatarUrl} label={post.author.displayName} />
        <View className="flex-1">
          <Text numberOfLines={1}>{post.author.displayName}</Text>
          <Text variant="small" numberOfLines={1}>
            {joinWithDot(`@${post.author.handle}`, formatRelativeTime(post.createdAt, copy.common))}
          </Text>
        </View>
        {onPressWhy ? (
          <Pill
            icon="why"
            label={copy.post.whyThis}
            accessibilityHint={copy.post.whyThisHint}
            onPress={() => onPressWhy(post)}
            className="gap-[5px] py-1.5 pr-[11px] pl-2"
          />
        ) : null}
      </View>

      <Text>{post.body}</Text>

      {media ? <PostMedia media={media} /> : null}

      <View className="flex-row items-center gap-4">
        <Text variant="small" className="flex-1">
          #{post.topic.slug}
        </Text>
        {showLikeCount ? (
          <PostStat icon="heart" value={post.likeCount} label={copy.post.likes(post.likeCount)} />
        ) : null}
        <PostStat icon="chat" value={post.commentCount} label={copy.post.comments(post.commentCount)} />
      </View>
    </Card>
  );
}

function PostStat({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  return (
    <View accessible accessibilityLabel={label} className="flex-row items-center gap-[5px]">
      <Icon name={icon} />
      <Text variant="small">{value}</Text>
    </View>
  );
}
