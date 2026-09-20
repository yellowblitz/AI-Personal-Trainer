# Exercise media provenance

Source: https://github.com/yuhonas/free-exercise-db

Imported dataset commit: `79ca7b47d77cd5a6dd7a50440e9f0bf24da6a142`

Declared upstream license: Unlicense (bundled verbatim). Catalog instructions, names and image paths come from `dist/exercises.json`. Existing core demonstrations are bundled locally; the expanded library loads additional images unmodified from the corresponding upstream `exercises/<ID>/` directory.

The app labels these as looping start/end photos, not full-motion videos. Upstream issues have asked about image provenance; independently verify rights before commercial distribution.

## v0.5.0 bodyweight expansion
Additional bodyweight demonstration images are loaded at runtime from the same `yuhonas/free-exercise-db` GitHub repository under its declared Unlicense. Existing bundled exercise images remain local assets.

## v0.9.0 full catalog
The app now includes every upstream exercise entry with at least one demonstration image: 873 entries in the imported dataset. Three upstream entries without images are omitted. Existing bundled images remain local; additional demonstrations load from the same public repository at runtime.
