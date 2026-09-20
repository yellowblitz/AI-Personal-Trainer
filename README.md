# AI Personal Trainer — Android v0.7.0

Gemini-only workout planner with your own API key. No hosted backend, OpenAI account, or app login is needed.

## Set up Gemini
1. Get a Gemini API key at https://aistudio.google.com/apikey (sign in to Google there).
2. Install the APK, open **Profile** to set goal, experience, equipment, height and weight, then tap the gear icon and paste your key into **Your Gemini API key**.
3. Tap **Save key**. On the Workout page, use **Edit week** to choose training days, time budgets and exercises per day.
4. Open **AI coach** for advice or ask it to plan/refine your week. Advice does not change the planner.
5. Review the **Proposed weekly changes** card. Keep chatting to refine it, or tap **Apply to weekly planner**. The front page opens a changed day and shows what was applied. **Undo AI edit** restores the previous week during the current app session.

Model selection: `gemini-3.8-flash` (default), `gemini-3.7-flash`, or `gemini-3.6-flash`. The three choices are current stable Flash generations. v0.6.1 uses high reasoning, Gemini JSON mode, proposal repair for missing per-set arrays, strict app-side validation, and automatic fallback to the next selected Flash generation when Google returns HTTP 503 high-demand errors. Requests go directly to Google's HTTPS Gemini API using the `x-goog-api-key` header. The app never sends the key in a URL. Each user supplies their own key; no shared developer key is bundled. Free-tier availability, quotas, and charges depend on the Google project. Google may use free-tier prompts and responses to improve its products.

On Android, the key is encrypted with an AES-GCM key in Android Keystore. The key is decrypted in memory for requests, never put in localStorage, logs, or workout history. Settings supports show/hide, replace, and remove. Android backups are disabled. Browser development preview keeps the key in memory only, so it must be reentered after reload. A compromised/rooted device can still expose a key in use.

## Features
- A recurring Monday–Sunday weekly planner with selected training/rest days and approximate training-time targets. Warm-up is excluded from the estimate. Exercise count is deliberately flexible rather than a hard planner setting; the AI can choose the number of exercises that fits the requested split, volume, equipment and time. Push/Pull/Legs are starter sessions, not an individualized prescription.
- Every set has its own reps and load fields, so later sets can be reduced or changed without altering the other sets. Completed set-by-set performance is preserved in workout history and reused as coaching context.
- Sequential set completion, automatic rest timer, pause, extend and skip.
- Device-local workout state and up to 200 saved sessions, including the exact reps/load completed for each set.
- Conversational Gemini coach with persistent local chat plus a separate long-term coach-memory summary. Up to 20 recent logged sessions are sent as compact performance context so future recommendations can react to later-set rep drops or successful progression.
- Device-local Profile page for goal, experience, equipment, height and weight. The AI can propose body/profile changes, but they remain reviewable drafts until you apply them.
- Advice, proposed drafts and applied workouts are separate states. Drafts persist across app restarts and can be refined or discarded.
- Per-day diffs show added/removed exercises, per-set reps/load, rest, session title, time budget and training/rest changes. Changed sessions display an estimated duration before applying.
- AI-generated changed sessions are expanded when they are substantially shorter than the requested training-time target, but the target is no longer treated as a hard ceiling. Warm-up is excluded from estimated workout time. Long bodyweight sessions can draw from the expanded bodyweight catalog rather than collapsing to a tiny workout.
- Apply updates the same saved weekly/profile data used by the app, preserves completed set performance on matching exercises, and supports Undo. No-op responses never display a success/update notification. Drafts cannot overwrite newer manual changes.
- A previous single-workout v0.2.0 state migrates to Monday; workout history and the saved Gemini key retain their existing storage keys.
- Invalid-key, quota, network, blocked-response and invalid-plan errors leave the workout unchanged. AI failures are stored in **Settings → Error reports** with the selected model, HTTP/provider status, request text and exact validation issues; the Gemini API key is redacted and never included.

## Install
Open **Actions → Android APK → latest successful run → Artifacts**. Download `AI-Personal-Trainer-0.7.0-debug`, unzip and install the APK on Android 8+.

This is a development build, not a production release. Starting with v0.6.0, CI keeps a stable development signing key in the repository Actions cache so subsequent main-branch APKs can install as updates over v0.6.0 instead of conflicting. Because v0.5.1 and earlier used a different ephemeral CI key, installing v0.6.0 may require one final uninstall. A private production signing key is still required before public distribution; if the CI signing cache is ever lost, the development signature can change.

## Build and test
Requires JDK 17, Android SDK 35, Gradle 8.9, and Node 22+.

```sh
npm test
gradle :app:assembleDebug :app:lintDebug
```

CI additionally runs browser tests covering per-set logging, model selection, error-report creation, day/time/exercise selection, weekly persistence, advice without edits, draft refinement, applying front-page changes, body-profile updates, coach memory, and key removal. API responses are mocked in tests; no live key is checked into source or used by CI. Android device testing with the user's key remains necessary.

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
Rest deadlines survive background suspension, but alerts only fire while the app is active. Session duration is still an estimate based on reps, rest and transition assumptions; real completion time depends on pace and interruptions. The schedule is a recurring weekly template, not a dated calendar. No background notifications, cloud sync, kg selector, or export yet. Physical device/Keystore QA and live Gemini calls are not covered by the browser test.

## v0.6.1 behavior
- HTTP 503 `UNAVAILABLE` / high-demand responses automatically retry the next available selected Flash generation (3.8 → 3.7 → 3.6). If every fallback is busy, the error report records every attempted model.
- The weekly editor no longer asks for a fixed number of exercises. Only days and approximate training minutes are selected there.
- Training-minute estimates exclude warm-up. The AI is instructed to treat the minute value as an approximate target rather than an automatic target+5 hard ceiling.


## v0.7.0 — ChatGPT handoff
The recommended coaching workflow now uses regular ChatGPT for the human-facing conversation without requiring an OpenAI API key:
1. Open **ChatGPT** in the bottom navigation and tap **Copy context**. The copied context contains the local profile, current weekly plan, recent logged set performance, coach memory and the app exercise catalog. It never includes the Gemini API key.
2. Tap **Open ChatGPT**, paste the context into regular ChatGPT, and continue the coaching conversation there.
3. Bring a ChatGPT response back by pasting it into the trainer, or on Android use **Share → AI Personal Trainer** when the shared content contains the response text.
4. Tap **Interpret with Gemini**. Gemini is instructed to act only as a deterministic command translator, not as the coach. It emits a small command batch instead of regenerating the full seven-day plan.
5. Review the exact local commands, warnings and workout details. Nothing changes until **Apply commands to trainer** is tapped.

Supported handoff commands are intentionally narrow: enable/disable a training day and change its approximate time target, replace one day's workout using catalog exercise IDs, update explicitly requested profile fields, and update durable coach memory. Unknown commands, invalid ranges, duplicate exercises and unsupported exercise IDs are rejected locally. Unmentioned days are preserved. Actual workout progress is still recorded by the app when sets/sessions are completed; recent set-by-set history is included in the context copied to ChatGPT.

The existing direct Gemini coach remains available under an optional expandable section. Gemini 503 fallback and local error reports continue to apply to both direct coaching and ChatGPT-response interpretation.

No OpenAI API key or OpenAI API billing is used by the v0.7.0 handoff workflow. The app opens regular ChatGPT externally and does not scrape or automate the ChatGPT website.
