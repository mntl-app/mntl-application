import { View } from 'react-native';

import type { ExplanationReason } from '@/api';
import { Icon, Text } from '@/components/ui';
import { type Copy, useCopy } from '@/i18n';

/** The checklist of signals the algorithm used for a post. */
export function ExplanationReasons({ reasons }: { reasons: ExplanationReason[] }) {
  const copy = useCopy();
  return (
    <View className="gap-2.5">
      {reasons.map((reason, index) => (
        <View key={`${reason.kind}-${index}`} className="flex-row items-center gap-2.5">
          <View className="size-6 items-center justify-center rounded-xl bg-cobalt-soft">
            <Icon name="check" />
          </View>
          <Text className="flex-1">{describeReason(reason, copy)}</Text>
        </View>
      ))}
    </View>
  );
}

function describeReason(reason: ExplanationReason, copy: Copy): string {
  switch (reason.kind) {
    case 'topic-level':
      return copy.why.reasons.topicLevel(reason.topic.name, copy.levels[reason.level]);
    case 'follows-author':
      return copy.why.reasons.followsAuthor(reason.handle);
    case 'recent':
      return copy.why.reasons.recent(reason.withinHours);
  }
}
