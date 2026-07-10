# ModHeader Chrome Extension — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Purpose

A Chrome extension that lets the user define multiple HTTP request headers (name + value) that are added/overridden on all outgoing requests. Clean, compact UI that shows many header configs on one screen.

## Scope

- **In scope:** Request headers only, applied globally to all URLs. Per-header enable/disable toggle plus a master ON/OFF switch.
- **Out of scope:** Response headers, per-header URL filters, profiles, import/export, sync storage.

## Technical Approach

Manifest V3 with the `declarativeNetRequest` API using **dynamic rules**. No background service worker: the popup itself recomputes and swaps rules whenever state changes. Chrome applies the rules natively even when the popup is closed.

Rejected alternatives:

- MV2 blocking `webRequest` — deprecated, being removed from the Chrome Web Store.
- Proxy-based rewriting — massive overkill.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: `declarativeNetRequest`, `storage`. Host permissions: `<all_urls>`. Action popup: `popup.html`. |
| `popup.html` | Popup markup. |
| `popup.css` | All styles. |
| `popup.js` | State management, storage, rule sync. |
| `icons/` | 16/32/48/128 px icons (simple generated SVG-derived PNGs). |

No build step, no dependencies. Load unpacked via `chrome://extensions`.

## Data Model

Stored in `chrome.storage.local`:

```json
{
  "paused": false,
  "headers": [
    { "id": 1710000000001, "name": "Authorization", "value": "Bearer …", "enabled": true }
  ]
}
```

`id` is a unique integer (timestamp + counter), reused as the `declarativeNetRequest` rule id.

## Data Flow

1. Popup opens → load state from `chrome.storage.local` → render list.
2. Any edit (add, change, toggle, delete, master switch) → update in-memory state → persist to storage (input edits debounced ~300 ms) → recompute full rule set → `chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: <all previous>, addRules: <new> })` — an atomic swap.
3. Rule set: one `modifyHeaders` rule per header that is `enabled`, has a non-empty RFC-7230-valid token name, when not `paused`. Operation: `set` (adds or overrides). Condition: `urlFilter: "*"`, all resource types.

## UI Design (light, minimal, compact)

Popup: **420 px wide**, max-height ~560 px with the list scrolling internally if needed. Density goal: **8–10 header rows visible at once**.

```
┌──────────────────────────────────────────────┐
│  ModHeader                          [● ON ]  │   ← header bar, master switch pill
├──────────────────────────────────────────────┤
│ [◉] [Authorization ] [Bearer eyJhbG…    ] ✕  │   ← one compact row (~40px)
│ [◉] [X-Debug-Mode  ] [true              ] ✕  │
│ [○] [X-Trace-Id    ] [abc-123           ] ✕  │   ← disabled = dimmed
│  …                                           │
├──────────────────────────────────────────────┤
│  ＋ Add header                    3 active   │   ← footer: add button + active count
└──────────────────────────────────────────────┘
```

Details:

- **Row:** single line — toggle switch, name input (~38 % width), value input (flex), delete button. Delete is always present but low-contrast until row hover.
- **Inputs:** borderless-looking (border appears on focus), monospace-ish for values, placeholder text `Name` / `Value`.
- **Toggle:** small iOS-style switch, accent color when on.
- **Master switch:** pill in the header bar; when OFF the whole list dims and all rules are removed.
- **Add:** appends an empty enabled row and focuses its name input.
- **Empty state:** centered hint "No headers yet — click ＋ Add header".
- **Footer:** shows `N active` count for at-a-glance status.
- **Style tokens:** white background, `#e5e7eb` hairline borders, one accent (indigo `#4f46e5`), system font stack, 13 px base size, 6 px radii.

## Edge Cases

- Empty name → stored, rendered, but no rule generated.
- Invalid name characters (outside RFC token charset `!#$%&'*+-.^_`|~0-9A-Za-z`) → no rule generated; input gets a red tint to signal the problem.
- Duplicate names → all matching rules registered; Chrome resolves by rule priority (last write wins in practice). Allowed, like real ModHeader.
- Empty value → row is kept in the list but no rule is generated (same as empty name); no error styling, it's just inactive until filled in.
- Storage/rule API failures → console-logged; UI state stays consistent since storage is written first.

## Testing

- Load unpacked, add headers, visit `https://httpbin.org/headers` and confirm echoed request headers.
- Toggle individual header off → header disappears from echo.
- Master switch off → all custom headers disappear.
- Close and reopen popup → state persists.
- Restart browser → dynamic rules persist (DNR dynamic rules survive restarts).
