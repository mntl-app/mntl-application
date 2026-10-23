import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';

type Options<T> = {
  /** The query holding the object being patched. Also used as the mutation key. */
  queryKey: QueryKey;
  mutationFn: (patch: Partial<T>) => Promise<T>;
  /** Other queries that depend on this data and should refetch once the change is saved. */
  invalidates?: QueryKey[];
};

/**
 * Settings-style mutation: the patch is applied to the cache straight away (the design promises
 * "changes apply right away"), rolled back if the request fails, and the data is refetched once the
 * last pending patch settles, so rapid taps never flicker back to an older value.
 */
export function useOptimisticPatch<T extends object>({ queryKey, mutationFn, invalidates = [] }: Options<T>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: queryKey,
    mutationFn,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<T>(queryKey);
      if (previous) queryClient.setQueryData<T>(queryKey, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: queryKey }) > 1) return;
      for (const key of [queryKey, ...invalidates]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
