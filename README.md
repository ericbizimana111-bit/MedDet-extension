# MedDet (Media Detector)

Chrome extension + Node backend. A MedDet button attaches itself to the video that is playing on
YouTube, TikTok, Instagram or Facebook. Pick **Identify movie or show** or **Identify song**.

Phase 1 / MVP rules: free, no accounts, no payments, rate-limited to protect API costs.

## 1. Get the keys (the backend needs them, the extension never does)

| Env var | Where |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` | https://aistudio.google.com/apikey (confirm the model name is current) |
| `TMDB_API_KEY` | https://www.themoviedb.org/settings/api (v3 key) |
| `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` | console.acrcloud.com, create an "Audio & Video Recognition" project with the music database |

Missing keys never produce fake results. The matching feature just reports it is not set up.
Movies need Gemini + TMDB. Music needs ACRCloud. You can start with one and add the other later.

## 2. Run the backend

```bash
cd backend
npm install
cp .env.example .env     # then fill in your keys
npm test                 # unit tests (no keys needed)
npm run dev              # http://localhost:5000
curl http://localhost:5000/api/v1/health
```

## 3. Load the extension

1. Chrome: `chrome://extensions`, turn on Developer mode.
2. Load unpacked, choose the `extension/` folder.
3. Click the MedDet toolbar icon: it shows whether the server is reachable and which services are ready.
4. Open a video on a supported site and press play. The MedDet button appears on the video.

## How it works

- **Movie/TV:** captures up to 4 frames from the playing video (drops near-duplicates), sends them to   the backend. Gemini proposes candidates, every candidate is verified in TMDB (title + year + media type),
  ranked, and shown as Strong / Possible / Weak match. Unverified guesses are never shown.
- **Music:** records ~12 seconds of the video's own audio, converts to 8 kHz mono WAV in the browser,
  backend sends it to ACRCloud. Silence, paused or muted video gives a clear message, not a fake result.
- **Frame capture** reads the video directly. If the site blocks that (cross-origin), it falls back to a
  tab screenshot cropped to the video. Protected (DRM) or black video is reported, never bypassed.

## Cost protection

`RATE_LIMIT_PER_HOUR` per IP (movie), `RATE_LIMIT_MUSIC_PER_HOUR` per IP (music), `DAILY_GLOBAL_LIMIT` total
paid-service requests per day per backend process. Request size is capped. Request validation runs before
the daily paid-service budget is consumed. The in-memory daily counter resets at UTC midnight and is not
shared across multiple server instances. The per-IP rate-limit store is also in-memory; use a shared store
before scaling out. The Express proxy setting assumes exactly one trusted reverse proxy.

## Backend request formats

- `POST /api/v1/identify/movie`: JSON body `{ "frames": [{ "image": "<base64 JPEG/PNG/WebP>", "timestamp": 1.2 }], "platform": "youtube" }`.
  `frames` is required (1–6 images); `image` may also be a matching `data:image/...;base64,` URL.
- `POST /api/v1/identify/music`: JSON body `{ "audio": "<base64 audio>", "mimeType": "audio/wav", "platform": "youtube" }`.
  Music identification returns `ACR_NOT_CONFIGURED` until all three ACRCloud values are set.
- `GET /api/v1/health`: reports server status and whether the required service credentials are configured.
  A true service flag indicates configuration only, not a live upstream connectivity check.

The Gemini, TMDB, and ACRCloud integrations use IPv4-selected HTTPS requests with bounded timeouts.
Automated tests mock the paid upstream services; passing them does not establish live API availability.

## Known limits (honest list)

- Not yet tested against live YouTube/TikTok/Instagram/Facebook pages. Button position, hover previews and
  multi-video feeds need real-page tuning (per-site offsets live in `extension/content/platforms.js`).
- Audio capture uses `video.captureStream()`. Sites can block it for some videos.
- The button is not draggable yet.
- Deploying: add your server URL to `host_permissions` in `extension/manifest.json` and set it in the popup.
- Database, Redis cache, accounts and subscriptions are intentionally not built (MVP decision).

## Next: Phase 2 testing

Build a set of ~50 known scenes, record top-1 / top-3 accuracy, false-positive rate and latency before sharing widely.
