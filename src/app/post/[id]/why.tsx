import { useLocalSearchParams } from 'expo-router';

import { WhyThisPostScreen } from '@/features/feed/why-this-post-screen';

export default function WhyThisPostRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WhyThisPostScreen postId={id} />;
}
