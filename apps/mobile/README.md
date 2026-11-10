# Paper Reading & Experiment Log Assistant (Android)

Phone-first Android app (React + Vite + TypeScript, packaged with Capacitor) for:
1. asking questions about a paper and getting answers with page citations (via an existing Research OS backend);
2. logging experiments by photo or voice note, stored locally with an offline queue.

Started 2026-11-04 during the contest period. See COMPLIANCE.md for what is new vs. reused.
Local-only repository: no remote.

## Connecting the phone to Research OS (W2)
- Phone and computer must be on the **same Wi-Fi**. In the app's Settings, enter `http://<computer LAN IP>:8443`
  (find the IP with `researchos-api lan-urls`), tap Test connection, then pair with a code from Research OS.
- The backend rejects unknown Host names (HTTP 421). Start it with
  `RESEARCHOS_EXTRA_ALLOWED_HOSTS=<computer LAN IP>` (comma-separated list; `10.0.2.2` for the Android emulator).
- Mobile endpoints (`/api/v1/mobile/logs`, `/api/v1/mobile/compare`) exist only on the Research OS `mobile-api`
  branch (not merged). That branch also has `RESEARCHOS_MOBILE_APP_ORIGINS=1` (default off) to accept the in-app
  origins `https://localhost` / `capacitor://localhost`; pairing is still required.
- Compare feedback (accept / ignore / edit) applies only to the entry on screen and is not saved.
- Model key: type your own key in Settings; it is sent once to your own computer and not stored in the app.
  Never paste it into a chat.
- Browser test only: `DEV_PROXY_BACKEND=http://localhost:18443 npx vite` proxies `/api` so page and API share an origin.
