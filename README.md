# AI Personal Trainer — Android v0.1.0

Android workout tracker with a conversational AI planner, offline exercise demonstrations and rest timer. The Android app packages a local HTML/CSS/JavaScript interface in a restricted WebView; it does not load a hosted website.

## Included
- Push / Pull / Legs sessions; add or remove exercises from a 12-exercise catalog.
- Edit sets, repetitions, weight (lb), and rest seconds per exercise.
- Complete sets sequentially; countdown automatically starts between sets. Pause, extend, or skip rest.
- Offline storage of the current workout, rest deadline and up to 200 completed sessions.
- Bundled start/end photos that loop as demonstrations, plus technique instructions.
- AI chat submits a message and workout to your backend. Validated changes apply on receipt, preserving completed sets; Undo restores the prior plan.
- Settings includes the app version and backend connection.

## Install an APK
Open **Actions → Android APK → latest successful run → Artifacts**, download `AI-Personal-Trainer-0.1.0-debug`, unzip, then install the APK on Android 8+. This is a development build. CI runner debug keys may change between runs; a stable release signing key is needed before distributing upgrades that preserve app data. Do not uninstall an existing version without considering local workout history.

## Build locally
Requires JDK 17, Android SDK 35 and Gradle 8.9. Open in Android Studio or run:

```sh
gradle :app:assembleDebug :app:lintDebug
npm test
```

No Gradle wrapper is bundled yet; CI installs the pinned Gradle version.

## Connect real AI
The tracker works without AI credentials. Live AI requires a separately deployed Node 22+ backend, a funded OpenAI API account, and HTTPS. A ChatGPT subscription does not configure this server.

1. Copy `server/.env.example` to `.env` and replace the values. Generate a random access token (for example `openssl rand -hex 32`). Never commit `.env`.
2. Start with `node --env-file=.env server/server.js` on your server.
3. Expose port 8080 through an HTTPS reverse proxy or an HTTPS-capable hosting service. `/health` is a health check.
4. In the Android app's Settings, enter the HTTPS base URL and access token. The token stays in memory and must be entered after a fresh app launch. The OpenAI key stays on the server.
5. Ask the AI to shorten the workout, change reps, or adapt equipment. The model is configurable through `OPENAI_MODEL` (default `gpt-4.1-mini`).

The backend validates requests and model output, limits body size, enforces bearer authentication and allowed origins, and applies a single-user limit of 20 requests/minute with 2 concurrent requests. This initial backend uses one shared token; multi-user authentication, persistent rate limiting and deployment are future work. Chat text and the current plan are transmitted to OpenAI with `store:false`. Do not put secrets or personal medical records in chat.

## Browser development preview

```sh
python -m http.server 8000 --directory app/src/main/assets
```

Visit `http://localhost:8000`. Set `ALLOWED_ORIGINS=http://localhost:8000` on the AI backend to permit preview requests. Android always requires an HTTPS backend.

## Media and attribution
Bundled catalog, instructions and demonstration photos come from [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db), whose repository declares the Unlicense. The upstream license is included in `app/src/main/assets/EXERCISE-LICENSE.txt`; provenance is in `MEDIA-SOURCES.md`. Two images alternate to show positions; they are **not full-motion GIFs or videos**. Recheck asset rights before a public commercial release. Adding verified licensed full-motion video/GIF sources is a follow-up milestone.

## Current limitations
- No backend is automatically deployed and no real provider call can succeed until credentials are configured.
- Timer uses an absolute deadline so background suspension does not reset it. Alerts are foreground-only; background notifications, sound and a native alarm service are not implemented.
- No streaming token display: the plan updates after the complete validated AI response.
- Device-local history, no cloud sync, accounts, kg selector or import/export yet.
- Physical Android device QA is still required.
