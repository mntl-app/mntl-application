import { useQuery } from '@tanstack/react-query';

import { api, type User } from '@/api';
import { queryKeys } from '@/api/query-keys';

export function useSession() {
  return useQuery({ queryKey: queryKeys.session, queryFn: () => api.getSession() });
}

/**
 * The signed-in user. Only for screens behind the session gate in the root layout, which doesn't
 * render the app until the session has loaded.
 */
export function useCurrentUser(): User {
  const { data } = useSession();
  if (!data) throw new Error('useCurrentUser was called before the session loaded.');
  return data.user;
}
