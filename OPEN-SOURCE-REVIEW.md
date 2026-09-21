# Open-source review — v0.8.1

Reviewed app base: `07fbde4` (v0.8.0).

## References inspected

- [simonalveteg/Workout-Tracker](https://github.com/simonalveteg/Workout-Tracker), revision `8105eab92b209895453c5bb315609d5d43bb33c7`: `GymRepository.kt` retrieves exercise-specific history sorted by session date; `TimerService.kt` separates timer lifecycle/actions from workout screens. These informed the last-performance display and explicit timer context. A native notification service is not implemented in this update.
- [rafaelfelipeac/hermes](https://github.com/rafaelfelipeac/hermes), revision `42601a9eb6b7f8cb37a6dcb9232919b09f142c6a`: `RoomWeeklyTrainingCommandRepository.kt` uses database transactions for multi-step changes. This informed validating all parts of an AI proposal before assigning new app state. This app still uses localStorage; the change does not provide database-level crash atomicity.

Hermes declares Apache-2.0. No root license was found in the inspected Workout-Tracker checkout; public visibility is not permission to copy. This revision uses original implementations of the ideas above, with no copied source, assets or new dependencies.

## Findings addressed

1. The manual picker could exceed the 12-exercise validator limit, causing the saved week to be rejected at startup. Both UI and handler now enforce that limit; search helps navigate the catalog.
2. Performance history was accessible only in Progress. Exercise cards now show the most recent saved completed sets, excluding unfinished targets.
3. Rest timer state did not identify its workout day. Persisted timers now include day/exercise context and retain it through pause/resume. Malformed timer data no longer breaks rendering.
4. Direct-coach apply assigned a new week before checking the profile's stale-draft guard. Both validations now run before mutation.
5. Error reports stored raw provider/request text and redacted only part of the rendered report. New reports and previously saved reports are scrubbed before storage; the whole displayed report is scrubbed as well.
6. Native inset dimensions were passed as physical pixels to CSS, exaggerating spacing on dense displays. Convert to density-independent CSS units.
7. Removing an exercise could silently discard unsaved completed sets. The user is now asked before removal when progress exists.
8. ChatGPT focus styling used a hostname suffix without a dot boundary. Host matching now requires the exact domain or a subdomain.

## Validation and limits

- Unit suite covers plan validity, stale drafts, AI handoff, per-set history and malformed timers.
- Browser suite covers last-session display, timer ownership across day changes/reload, picker search/limit/reload and saved error-report redaction, alongside existing coaching and phone-layout checks.
- Android CI builds the APK and runs lint.
- Physical phone testing, real ChatGPT login and live Gemini requests remain necessary. Background rest notifications, recovery from storage quota failures, database transactions and a fully inline native ChatGPT pane remain future work.

### Verification result in this session

- `npm test`: 41/41 passed.
- JavaScript syntax check and whitespace/diff check passed.
- Browser regression tests were extended but could not run locally: Chromium was absent and its download timed out.
- Android build/lint have not run for this revision. Automatic approval review blocked the GitHub push, so CI was not triggered. Changes are committed locally on `refine/open-source-review-0.8.1` pending explicit push authorization.
