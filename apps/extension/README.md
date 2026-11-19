# 思维账本 · 记一笔 (browser extension)

A Manifest V3 extension. On DeepSeek or Doubao web chat it adds one floating button, 「记一笔」. Pressing it reads the
last question and answer the page shows (or the text you selected), lets you pick how much help you took
(提示 / 思路 / 完整答案) and posts one entry to `POST /api/v1/mind-ledger/entries` on your own Research OS server.

Then 讲给我听: without looking at the answer, you explain it in your own words. The server splits the answer into key
points and says for each one 通过, 需补充 or 待复核 (no score); it follows up at most twice, one point each time, and
「给点提示」 goes one level further each press (what kind of point is missing, a keyword, half the point, the point).
Hints make the debt heavier; the result sets how soon the phone asks you to repay it. 「先不讲」 leaves the debt as booked.

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
The site selectors in `src/capture.js` have not been checked against the live DeepSeek or Doubao pages (when no
user message matches, the text block right before the answer is taken as the question, which the user can edit), and
signing in through a real Chrome (session cookie on an extension request) has not been tried yet.
`tests/test_mind_ledger.py` posts the same `fixtures/entry.json` body from an extension origin.
