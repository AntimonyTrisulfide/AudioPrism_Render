# AudioPrism Frontend

Deployment-ready Vite + React frontend for the Render-friendly AudioPrism backend.
It keeps login/history, lets users choose which stems to extract, and sends only
those requested stem names to the API.

## Environment

Create `.env` locally or set these in Vercel:

```text
VITE_API_ROOT=https://your-audioprism-backend.onrender.com
VITE_MAX_UPLOAD_MB=25
VITE_MAX_AUDIO_SECONDS=60
VITE_API_PROXY_TARGET=http://127.0.0.1:8001
```

`VITE_API_ROOT` must point to the deployed backend and must be present before
building/deploying the frontend. The backend must also allow the deployed
frontend origin in `ALLOWED_ORIGINS`. The app calls:

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/infer/segment (with async_inference=1)
GET  /api/infer/jobs/{job_id}
GET  /api/infer/results
GET  /api/stems
```

The frontend checks `VITE_MAX_UPLOAD_MB` and `VITE_MAX_AUDIO_SECONDS` before
uploading when browser metadata is available. The backend still enforces the
real cap with `MAX_AUDIO_SECONDS`.

For local dev, leave `VITE_API_ROOT` unset or empty so Vite proxies `/api` and
`/output` to `VITE_API_PROXY_TARGET`. The default proxy target is
`http://127.0.0.1:8001`.

## Local Development

```bash
npm ci
npm run dev
```

## Production Build

```bash
npm run build
```

## Vercel

Import this frontend directory as a Vercel project and set:

```text
Framework preset: Vite
Build command: npm run build
Output directory: dist
VITE_API_ROOT=https://your-audioprism-backend.onrender.com
```

`vercel.json` already contains the SPA rewrite needed for refreshes.
