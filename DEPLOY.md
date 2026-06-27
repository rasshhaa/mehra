# Deploy AutoVault (MEHRA) on Vercel — full stack

Everything runs on **one Vercel project**: FastAPI serves the API and `index.html` from the same URL. No separate Railway backend.

---

## Before you deploy

| Limit | Detail |
|-------|--------|
| **Vercel Pro recommended** | Inspection + Roboflow can take 30–120s. Hobby plan max is **10s** per request; Pro allows up to **300s** (`maxDuration` in `vercel.json`). |
| **Engine audio** | Disabled on Vercel (torch/librosa too large). Photo inspection, live camera, reports, and marketplace still work. |
| **Uploads / PDFs** | Stored in `/tmp` per invocation — not persistent across cold starts. Fine for demos; production should use Firebase Storage later. |
| **Bundle size** | Slim `requirements.txt` (no torch). Must stay under Vercel’s ~500MB function limit. |

---

## 1. Push to GitHub

Commit and push this repo (Vercel deploys from Git).

---

## 2. Create the Vercel project

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo.
2. **Root Directory:** `mehra` ← important
3. **Framework Preset:** Other
4. Leave **Build Command** empty (Vercel runs `pip install -r requirements.txt` via `vercel.json`).
5. Deploy once (it may fail until env vars are set — that’s OK).

---

## 3. Environment variables

In Vercel → Project → **Settings** → **Environment Variables**, add:

| Variable | Required | Notes |
|----------|----------|-------|
| `GROQ_API_KEY` | Yes | AI report text |
| `ROBOFLOW_API_KEY` | Yes | Damage detection |
| `USE_FIRESTORE` | Yes | Set to `1` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes | Paste the **entire** contents of `serviceAccountKey.json` (single line or multiline JSON) |
| `FIREBASE_PRIMARY_PROJECT_ID` | If needed | Default `mehra-b3a7c` — must match your Firebase web app project |
| `ROBOFLOW_MODEL_ID` | Optional | Default in code |

Optional secondary Firestore pool:

| Variable | Notes |
|----------|-------|
| `FIREBASE_SERVICE_ACCOUNT_SECONDARY` | Path on Vercel is not useful; use a second JSON env if you extend `firestore_pool.py` |

Redeploy after saving env vars (**Deployments** → ⋮ → **Redeploy**).

---

## 4. Firebase authorized domains

Firebase Console → **Authentication** → **Settings** → **Authorized domains**:

- Add `your-project.vercel.app`
- Add any custom domain

---

## 5. Verify

1. Open `https://YOUR-APP.vercel.app` — you should see the owner portal.
2. Open `https://YOUR-APP.vercel.app/docs` — FastAPI Swagger.
3. Open `https://YOUR-APP.vercel.app/health` — `{ "ok": true, ... }`.
4. Sign in and run a photo inspection (Network tab should hit the same origin, not a separate backend URL).

---

## Deploy with Vercel CLI (optional)

```bash
npm i -g vercel
cd mehra
vercel
# set env vars in dashboard, then:
vercel --prod
```

---

## Local development (unchanged)

```bash
cd mehra/backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Open `http://127.0.0.1:8000` — same app, full engine-audio support locally.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Root Directory wrong | Must be `mehra`, not repo root or `mehra/frontend` |
| Function timeout | Upgrade to Pro; inspection needs `maxDuration: 300` |
| Firebase / Unauthorized | Set `FIREBASE_SERVICE_ACCOUNT_JSON`; add Vercel domain to Firebase |
| `index.html not found` | Confirm `mehra/frontend/index.html` is in the repo and Root Directory is `mehra` |
| Engine audio 503 | Expected on Vercel — use photo inspection |
| Cold start slow | First request after idle may take 10–20s; normal for serverless |
| Static images 404 after inspect | Generated files live in `/tmp` for that request only; refresh may lose them until you add cloud storage |

---

## Split deploy (optional)

If Vercel limits are too tight, you can still run **frontend on Vercel + backend on Railway** — see git history for `mehra/frontend/vercel.json` + `BACKEND_URL` pattern. The default setup in this repo is **full stack on Vercel**.
