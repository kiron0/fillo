# Fillo

Fillo is a browser extension for Google Forms that works with both Chrome and Firefox, helping you review, reuse, and fill answers faster without auto-submitting the form.

## Features

- Scan the active Google Form from the popup
- Review and edit field values before filling
- Reuse saved profile values through field mappings
- Save per-form presets locally in extension storage
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

## Notes

- Fillo is designed for Google Forms and only works on supported `docs.google.com/forms/...` pages.
- All profile data and presets are stored locally through the browser extension storage API.
- The extension fills values only. It does not auto-submit the form.

## Build targets

- `bun run build` or `bun run build:chrome` writes the Chrome bundle to `extension/build-chrome`.
- `bun run build:firefox` writes the Firefox bundle to `extension/build-firefox`.
- Releases publish separate Chrome and Firefox zip files.
- Set `FILLO_FIREFOX_EXTENSION_ID` before `build:firefox` if you want a fixed Gecko extension ID in the generated manifest.

## License

MIT
