# SimVehicleApp brand assets (M01-T06)

Source of truth: [`source/simvehicleapp-brand-board.png`](source/simvehicleapp-brand-board.png) — brand board provided by the
PO on 2026-10-03 (concepts A–F, primary lockup "SimVehicleApp — MODEL · BUILD · RUN · FOR REAL VEHICLES", app icons,
monochrome). sha256 `ac3133052f7b9fe51b10d3f552258fef5f3c6e894957e9263f728f2d55915bb1`.

Regenerate everything (deterministic):
```bash
python3 brand/build_brand_assets.py      # needs Python 3 + Pillow + NumPy
```

## Outputs
- `apps/sim/public/brand/simvehicleapp/` — brand kit: `concept-{a..f}-*.png`, `mark.png` (primary = concept A),
  `mark-mono-{white,dark}.png`, `wordmark-on-{dark,light}.png`, `lockup-on-{dark,light}.png`, `lockup-mono-dark.png`,
  `lockup-tagline-on-dark.png`, `app-icon-{dark,light}.png` (1024 px).
- Every Sim logo/favicon/icon under `apps/sim/public/{logo,brandbook,brand/color,favicon}`, `icon.svg` and
  `email/broadcast/v0.5/logo.png` is replaced **in place** (same path, same aspect ratio), so no Sim source file had to
  change. Variant per path (first rule wins, see `variant()` in the script): header SVGs → horizontal lockup (dark/light);
  favicons, `icon.svg`, `rounded` → dark app icon; `426-240` → social banner with tagline; `text`/`workmark` → lockup
  (`b&w` = stacked monochrome); `b&w`/`black` → dark mono mark; `reverse` → white mono mark; otherwise the color mark.

## Limits
- The board is a 1536×1024 raster, so assets are raster (SVG files embed a PNG); rasters are capped at 1024 px. Provide
  vector (SVG) or ≥ 4× resolution originals to get crisp large sizes — rerun the script after replacing the board.
- Background removal is colour-to-alpha against the local board background plus despeckle on artwork; the dark "fold"
  shading inside the mark becomes transparent.
- Brand **name/metadata** ("Sim" in titles, emails, support links) comes from the brand config that lives in
  `apps/sim/ee/whitelabeling`; it is replaced by the clean-room `lib/sv/oss/brand` in M01-T02b/T02c (ADR-0004), not here.
