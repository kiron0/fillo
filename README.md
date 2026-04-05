# Fillo

Fillo is a Manifest V3 Chrome extension for Google Forms. It scans the active form, lets you review or edit answers in the popup, reuses saved profile data, stores per-form presets locally, and fills supported fields without auto-submitting the form.

## Features

- Scan the active Google Form from the popup
- Review and edit field values before filling
- Reuse saved profile values through field mappings
- Save per-form presets locally in Chrome storage
- Fill supported Google Form field types without submitting the form
- Manage profiles, presets, settings, and import/export from the options page

## Supported field types

- Text inputs
- Textareas
- Radio questions
- Checkboxes
- Dropdowns
- Linear scale and rating-style questions
- Date fields
- Time fields
- Grid questions

## Development

### Scripts

- `bun run build`
- `bun run dev`
- `bun run test`
- `bun run typecheck`

### Project structure

```text
src/
  core/         shared types, storage, normalization, and helper logic
  features/     background, content, popup, and options feature logic
  options/      static options page assets
  popup/        static popup assets
scripts/
  build.ts      Bun build entry that writes the unpacked extension to dist/
tests/
  *.test.ts     Vitest coverage
dist/
  unpacked Chrome extension output
```

## Load the extension locally

1. Run `bun install`
2. Run `bun run build`
3. Open `chrome://extensions`
4. Enable `Developer mode`
5. Click `Load unpacked`
6. Select the [dist](/d:/Web%20Development%20Learning/NPM%20Packages/fillo/dist) folder

## How it works

- The popup reads the active Google Form and shows detected fields for review.
- Profiles provide reusable values such as name, email, department, or other common answers.
- Per-form presets remember reviewed values and profile mappings for the current form.
- The content script scans the live Google Form DOM and applies supported values back into the page.
- The background service worker coordinates popup requests with the active tab.

## Notes

- Fillo is designed for Google Forms and only works on supported `docs.google.com/forms/...` pages.
- All profile data and presets are stored locally through Chrome extension storage.
- The extension fills values only. It does not auto-submit the form.
