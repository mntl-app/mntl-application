import type { ApiClient } from './client';
import { createMockClient } from './mock/mock-client';

/**
 * The single data source for the app. There is no backend yet, so this is the in-memory mock.
 * When the API exists, implement `ApiClient` over HTTP (e.g. reading the base URL from
 * `process.env.EXPO_PUBLIC_API_URL`) and return it here; nothing else needs to change.
 */
export const api: ApiClient = createMockClient();

export type { ApiClient } from './client';
export * from './types';
