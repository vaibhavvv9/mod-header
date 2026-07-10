# HeaderPilot

A minimal Chrome extension (Manifest V3) that adds or overrides HTTP request
headers on all sites. No build step, no dependencies, no background worker —
the popup writes `declarativeNetRequest` dynamic rules that Chrome applies
natively, even after the browser is closed and reopened.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.

## Use

- **＋ Add header** — add a name/value pair. Changes save automatically.
- **Row toggle** — enable/disable one header without deleting it.
- **ON/OFF pill** — pause/resume all headers at once.
- Invalid header names (spaces, colons, non-ASCII) get a red tint and are
  skipped; empty names/values are kept in the list but never applied.

Verify at <https://httpbin.org/headers>, which echoes your request headers.

## Development

Pure logic lives in `rules.js`; run its tests with:

    npm test   # node --test, no dependencies

`popup.js` is DOM/chrome-API glue; `manifest.json` declares
`declarativeNetRequest` + `storage` permissions over `<all_urls>`.
