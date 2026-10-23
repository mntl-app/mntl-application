import { router } from 'expo-router';
import { FlatList, Share, View } from 'react-native';

import type { Post } from '@/api';
import { ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { PostCard } from '@/features/feed/components/post-card';
import { useCurrentUser } from '@/features/session/api';
import { useWellbeingSettings } from '@/features/wellbeing/api';
import { useCopy } from '@/i18n';

import { useUserPosts } from './api';
import { ProfileSummary } from './components/profile-summary';

export function ProfileScreen() {
  const copy = useCopy();
  const user = useCurrentUser();
  const posts = useUserPosts(user.id);
  const settings = useWellbeingSettings();

  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];

  const openExplanation = (post: Post) =>
    router.push({ pathname: '/post/[id]/why', params: { id: post.id } });

  return (
    <Screen className="p-0">
      <FlatList
        data={items}
        keyExtractor={(post) => post.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPressWhy={openExplanation}
            showLikeCount={!settings.data?.hideLikeCounts}
          />
        )}
        ListHeaderComponent={
          <View className="gap-5">
            <ProfileSummary
              user={user}
              // Editing a profile isn't designed yet; the button is a placeholder for that flow.
              onShare={() => Share.share({ message: copy.profile.shareMessage(user.handle) })}
            />
            <Text variant="overline" tone="muted" accessibilityRole="header">
              {copy.profile.yourPosts}
            </Text>
          </View>
        }
        ListEmptyComponent={
          posts.isPending ? (
            <LoadingState />
          ) : posts.isError ? (
            <ErrorState onRetry={() => posts.refetch()} />
          ) : (
            <Text tone="muted">{copy.profile.noPosts}</Text>
          )
        }
        onEndReached={() => {
          if (posts.hasNextPage && !posts.isFetchingNextPage) posts.fetchNextPage();
        }}
        contentContainerClassName="gap-2.5 px-6 pt-2 pb-4"
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
