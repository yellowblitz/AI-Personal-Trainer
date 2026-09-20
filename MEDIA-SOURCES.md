# Exercise media provenance

Source: https://github.com/yuhonas/free-exercise-db

Imported dataset commit: `79ca7b47d77cd5a6dd7a50440e9f0bf24da6a142`

Declared upstream license: Unlicense (bundled verbatim). Catalog instructions, names and image paths come from `dist/exercises.json`. Existing core demonstrations are bundled locally; the expanded library loads additional images unmodified from the corresponding upstream `exercises/<ID>/` directory.

The app labels these as looping start/end photos, not full-motion videos. Upstream issues have asked about image provenance; independently verify rights before commercial distribution.

## v0.5.0 bodyweight expansion
Additional bodyweight demonstration images are loaded at runtime from the same `yuhonas/free-exercise-db` GitHub repository under its declared Unlicense. Existing bundled exercise images remain local assets.

## v0.9.0 full catalog
The app now includes every upstream exercise entry with at least one demonstration image: 873 entries in the imported dataset. Three upstream entries without images are omitted. Existing bundled images remain local; additional demonstrations load from the same public repository at runtime.


## v0.11.0 on-demand video demos
Optional full-motion demonstrations are requested at runtime from the public wger exercise API only after the user opens an exercise demo. No wger videos are bundled in the APK and the app does not bulk-download the video library. For matched exercises, the app reads the video's source-provided author/license metadata and streams the direct wger-hosted media URL; only requested resources can enter the Android WebView HTTP cache. Settings can clear that trainer cache.

Source/API: https://wger.de/
Project source: https://github.com/wger-project/wger

wger's project history documents contributed exercise videos under Creative Commons licensing, while individual video entries expose license metadata. The app does not copy Fitbod media. When no matched wger video is available, it falls back to the free-exercise-db image demonstration described above. License/attribution should be reviewed per media entry before commercial distribution.


## v0.12.0 anatomy illustrations and exact exercise pairing
The trainer now uses the open-source Anatome project for anatomy-style SVG rendering and exact exercise animation pairing.

- Project/API: https://github.com/NextSolutionsStudio/anatome and https://api.anatome.dev
- Anatome API code and anatomy renderer are published under Apache-2.0.
- Anatome's exercise bundle is based on the same 873 free-exercise-db exercise IDs used by this app.
- Every local catalog entry is paired to `/exerciseGif?id=<exercise-id>`; the build verifies that all 873 IDs have an exact GIF in Anatome's published tree.
- The GIFs are generated from the free-exercise-db image pairs according to Anatome's documented generation process; they are not Fitbod media.
- Anatomy SVGs are generated from normalized muscle slugs. The card uses the catalog's primary muscle mapping; the detail view requests that exercise's exact primary/secondary Anatome mapping on demand and caches only metadata for exercises the user opens.
- Optional wger full-motion videos remain a best-effort enhancement and are shown only after an exact or high-confidence name match. If no such match exists, the exact Anatome animation is used.

No third-party demo-video library is bundled into the APK. Media enters the Android WebView cache only after the user opens it; Settings can clear the trainer media cache without clearing the isolated ChatGPT login.
