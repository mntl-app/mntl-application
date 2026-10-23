# MNTL app

The MNTL mobile app (iOS and Android first, web later), built with Expo SDK 57, Expo Router and
Tailwind via [Uniwind](https://docs.uniwind.dev). Screens follow the "MNTL App Draft" Figma file.
There is no backend yet: all data comes from an in-memory mock that implements the same contract
the real API will.

## Run it

```bash
npm install
npm run dev          # expo start; open in Expo Go, a simulator or the browser
npm run typecheck
npm run lint
```

After changing `metro.config.js`, `src/global.css` tokens or fonts, restart with `npx expo start --clear`.

## Layout

```text
src/
  app/                 Routes only (Expo Router). Each file re-exports a screen from features/.
  features/<name>/     One folder per product area: screen, components, and data hooks (api.ts).
  components/ui/       Design system: Text, Button, Chip, Toggle, SliderRow, SettingRow, ...
  components/navigation/  Custom tab bar.
  api/                 Data contract: domain types, ApiClient interface, mock implementation.
  i18n/                All user-facing copy (English for now).
  lib/                 Small helpers (class merging, formatting, query client, optimistic updates).
  theme/               Fonts and colour access for non-className APIs.
  global.css           Design tokens (colours, fonts) mirrored from Figma variables.
```

## Conventions

- **Styling**: Tailwind classes via `className`, using the tokens in `src/global.css`
  (`bg-card`, `text-muted`, `font-display`, ...). No hard-coded colours. Components take `variant`/`tone`
  props for their look and `className` for layout; `cn()` lets a caller's classes win.
- **Text**: always `<Text variant=... tone=...>` from `@/components/ui`, which carries the Figma type scale.
- **Data**: screens never call `api` directly. Each feature exposes TanStack Query hooks in its
  `api.ts`; settings use optimistic updates (`useOptimisticPatch`). Cache keys live in `src/api/query-keys.ts`.
- **Copy**: strings live in `src/i18n/en.ts`, read with `useCopy()`.
- **Accessibility**: interactive components set `role` and `aria-*` props, which work on iOS, Android and web.

## Connecting the backend

1. Keep `src/api/types.ts` and `src/api/client.ts` in sync with the API (they are the contract).
2. Implement `ApiClient` over HTTP and return it from `src/api/index.ts` instead of `createMockClient()`.
3. Add auth as another `Stack.Protected` guard in `src/app/_layout.tsx`, next to onboarding.

Nothing in `features/` or `components/` needs to change.
