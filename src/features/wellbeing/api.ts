import { useQuery } from '@tanstack/react-query';

import { api, type WellbeingSettings } from '@/api';
import { queryKeys } from '@/api/query-keys';
import { useOptimisticPatch } from '@/lib/use-optimistic-patch';

export function useWellbeingSettings() {
  return useQuery({ queryKey: queryKeys.wellbeingSettings, queryFn: () => api.getWellbeingSettings() });
}

export function useUpdateWellbeingSettings() {
  return useOptimisticPatch<WellbeingSettings>({
    queryKey: queryKeys.wellbeingSettings,
    mutationFn: (patch) => api.updateWellbeingSettings(patch),
  });
}

export function useUsageToday() {
  return useQuery({ queryKey: queryKeys.usageToday, queryFn: () => api.getUsageToday() });
}
