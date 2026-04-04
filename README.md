# Fillo

Manifest V3 Chrome extension for scanning Google Forms, reviewing reusable values, saving local presets, and filling supported fields without auto-submitting.

## Scripts

- `bun run build`
- `bun run test`
- `bun run typecheck`

## Folder Structure

```text
src/
  core/         shared types, storage, normalization, and helper logic
  features/     feature implementation modules
  options/      static options assets
  popup/        static popup assets
scripts/
  build.ts      Bun build entry that writes the unpacked extension to dist/
tests/
  *.test.ts     Vitest coverage
dist/
  Chrome extension output for Load unpacked
```

## Load the extension

1. Run `bun install`
2. Run `bun run build`
3. Open `chrome://extensions`
4. Enable Developer Mode
5. Click `Load unpacked`
6. Select the `dist` directory

## What is implemented

- Popup UI for scanning the active Google Form, reviewing values, saving per-form presets, and filling fields
- Options page for profiles, saved forms, settings, import/export, and clearing local data
- Content script for scanning and filling text, textarea, radio, checkbox, dropdown, and scale-style fields
- Background service worker for active-tab coordination
- Vitest coverage for form identification, profile matching, storage, and DOM-level scan/fill logic

## Build Notes

- The repo now follows the same basic discipline as the reference extension: one `src` tree for source, one `tests` tree for tests, and one build entry under `scripts`.
- Inside `src`, shared logic lives in `core`, feature logic lives in `features`, and the build points directly at those feature modules.
- The build stays Chrome-specific. `scripts/build.ts` bundles extension entrypoints with Bun, copies static popup/options assets, and writes `dist/manifest.json`.
