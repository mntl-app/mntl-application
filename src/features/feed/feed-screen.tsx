import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { FeedMode, Post } from '@/api';
import { ChoiceChips, ErrorState, LoadingState, Screen, Text, toOptions } from '@/components/ui';
import { useWellbeingSettings } from '@/features/wellbeing/api';
import { useCopy } from '@/i18n';
import { useColors } from '@/theme/use-colors';

import { useFeed } from './api';
import { FeedHeader } from './components/feed-header';
import { PostCard } from './components/post-card';

export function FeedScreen() {
  const copy = useCopy();
  const colors = useColors();
  const [mode, setMode] = useState<FeedMode>('your-rules');
  const feed = useFeed(mode);
  const settings = useWellbeingSettings();

  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const showLikeCount = !settings.data?.hideLikeCounts;

  const openExplanation = (post: Post) =>
    router.push({ pathname: '/post/[id]/why', params: { id: post.id } });

  return (
    <Screen className="p-0">
      <FlatList
        data={posts}
        keyExtractor={(post) => post.id}
        renderItem={({ item }) => (
          <PostCard post={item} onPressWhy={openExplanation} showLikeCount={showLikeCount} />
        )}
        ListHeaderComponent={
          <View className="gap-4">
            <FeedHeader />
            <ChoiceChips
              options={toOptions(copy.feed.modes)}
              value={mode}
              onChange={setMode}
              accessibilityLabel={copy.feed.modesLabel}
            />
          </View>
        }
        ListEmptyComponent={
          feed.isPending ? (
            <LoadingState />
          ) : feed.isError ? (
            <ErrorState onRetry={() => feed.refetch()} />
          ) : (
            <Text tone="muted" className="py-12 text-center">
              {copy.feed.empty}
            </Text>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <LoadingState className="py-4" />
          ) : posts.length > 0 && !feed.hasNextPage ? (
            <Text variant="small" tone="muted" className="py-4 text-center">
              {copy.feed.caughtUp}
            </Text>
          ) : null
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => feed.refetch()}
            tintColor={colors.cobalt}
            colors={[colors.cobalt]}
          />
        }
        contentContainerClassName="gap-4 px-4 pt-2 pb-4"
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
