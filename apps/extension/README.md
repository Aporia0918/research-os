# 思维账本 · 记这一条 (browser extension)

A Manifest V3 extension. On DeepSeek or Doubao web chat it adds one floating button, 「记这一条」. Pressing it reads the
last question and answer the page shows (or the text you selected), lets you pick how much help you took
(提示 / 思路 / 完整答案) and posts one entry to `POST /api/v1/mind-ledger/entries` on your own Research OS server.

- Nothing is read until you press the button, and only what the page displays. No page is scraped in the background.
- Selecting text and pressing the button works on any page, so a site changing its markup never blocks you.
- The server address and session stay in this browser (`chrome.storage.local`); the extension asks for access to
  that one address when you pair.

## Try it

1. Add the extension's origin to `public_origins` in the server config, e.g. `chrome-extension://<id shown on
   chrome://extensions>`. The server refuses writes from origins it does not know.
2. `chrome://extensions` → Developer mode → Load unpacked → this folder.
3. Open the extension's options, enter the server address and an 8-character pairing code from
   Settings → Devices.

## Tests

```
node --test apps/extension/test/*.test.mjs
```

The HTML under `test/fixtures` is hand-written to look like each site; it is not copied from the real pages.
The site selectors in `src/capture.js` have not been checked against the live DeepSeek or Doubao pages, and
signing in through a real Chrome (session cookie on an extension request) has not been tried yet.
`tests/test_mind_ledger.py` posts the same `fixtures/entry.json` body from an extension origin.
