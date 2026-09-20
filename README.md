# AI Personal Trainer — Android v0.3.0

Gemini-only workout planner with your own API key. No hosted backend, OpenAI account, or app login is needed.

## Set up Gemini
1. Get a Gemini API key at https://aistudio.google.com/apikey (sign in to Google there).
2. Install the APK, tap the gear icon, and paste it into **Your Gemini API key**.
3. Tap **Save key**. On the Workout page, use **Edit week** to choose training days, time budgets and exercises per day.
4. Open **AI coach** for advice or ask it to plan/refine your week. Advice does not change the planner.
5. Review the **Proposed weekly changes** card. Keep chatting to refine it, or tap **Apply to weekly planner**. The front page opens a changed day and shows what was applied. **Undo AI edit** restores the previous week during the current app session.

Model: `gemini-2.5-flash`. Requests go directly to Google's HTTPS Gemini API using the `x-goog-api-key` header. The app never sends the key in a URL. Each user supplies their own key; no shared developer key is bundled. Free-tier availability, quotas, and charges depend on the Google project. Google may use free-tier prompts and responses to improve its products.

On Android, the key is encrypted with an AES-GCM key in Android Keystore. The key is decrypted in memory for requests, never put in localStorage, logs, or workout history. Settings supports show/hide, replace, and remove. Android backups are disabled. Browser development preview keeps the key in memory only, so it must be reentered after reload. A compromised/rooted device can still expose a key in use.

## Features
- A recurring Monday–Sunday weekly planner with selected training/rest days, minutes available, and exercise counts per day. Push/Pull/Legs are starter sessions, not an individualized prescription. The catalog currently contains 12 exercises with looping start/end photos and instructions.
- Editable sets, reps, load (lb), and rest seconds.
- Sequential set completion, automatic rest timer, pause, extend and skip.
- Device-local workout state and up to 200 saved sessions.
- Conversational Gemini coach with detailed advice and persistent local chat history (latest 80 messages; up to 30 recent turns sent for context).
- Advice, proposed drafts and applied workouts are separate states. Drafts persist across app restarts and can be refined or discarded.
- Per-day diffs show added/removed exercises, sets, reps, load, rest, session title, time budget and training/rest changes.
- Apply updates the same saved weekly data used by the front page, preserves completed sets on matching days, and supports Undo. No-op responses never display a success/update notification. Drafts cannot overwrite manual changes without a new refinement.
- A previous single-workout v0.2.0 state migrates to Monday; workout history and the saved Gemini key retain their existing storage keys.
- Invalid-key, quota, network, blocked-response and invalid-plan errors leave the workout unchanged.

## Install
Open **Actions → Android APK → latest successful run → Artifacts**. Download `AI-Personal-Trainer-0.3.0-debug`, unzip and install the APK on Android 8+.

This is a development build, not a production-signed release. Different CI runs can have different debug signing keys; Android may require uninstalling the previous build, which removes local history. A stable production signing key is still needed for reliable upgrades.

## Build and test
Requires JDK 17, Android SDK 35, Gradle 8.9, and Node 22+.

```sh
npm test
gradle :app:assembleDebug :app:lintDebug
```

CI additionally runs browser tests covering day/time/exercise selection, weekly persistence, advice without edits, draft refinement using conversation context, draft persistence, applying actual front-page changes, Undo, unchanged replies, stale-draft protection, quota errors, and key removal. API responses are mocked in tests; no live key is checked into source or used by CI. Android device testing with the user's key remains necessary.

To preview locally:

```sh
python -m http.server 8000 --directory app/src/main/assets
```

Open http://localhost:8000. The API key is intentionally not persisted in the browser preview. A current Android System WebView is required for the packaged interface.

## Security boundaries
The WebView only displays packaged assets at `https://appassets.androidplatform.net/assets/index.html`. Its native bridge exposes only encrypted key read/write. A Content Security Policy disallows remote scripts, frames and objects, and permits network connections only to the local asset origin and Google's Gemini endpoint. The AI Studio key link opens in the external browser. All other remote navigation is blocked.

## Media
Catalog and photos: [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db), declared Unlicense. See `MEDIA-SOURCES.md` and the included upstream license. Demonstrations loop two photos; they are not full-motion videos. Check asset rights before commercial distribution.

## Limitations
Rest deadlines survive background suspension, but alerts only fire while the app is active. Time budgets are preferences, not guarantees of exact session duration. The schedule is a recurring weekly template, not a dated calendar. No background notifications, cloud sync, kg selector, or export yet. Physical device/Keystore QA and live Gemini calls are not covered by the browser test.
