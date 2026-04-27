# FG-2000 Field Measure Drawing App

Offline-first, iPhone-first field measuring app for interior FG-2000 storefront elevations. A field tech enters a squared rough opening width and height plus guided product selections; the app calculates frame/lite/glass geometry, flags advisory validation issues, and generates elevation and glass takeoff PDFs.

## Architecture

- `src/domain` contains the source-of-truth calculation engine. These functions are pure TypeScript and do not know about React, storage, or PDF rendering.
- `src/config` contains JSON-editable rule packs for FG-2000 storefront geometry, WS-500-style entrance assumptions, notes, validations, and branding.
- `src/persistence` provides a local database abstraction over IndexedDB with a localStorage fallback. The repository boundary is intentionally sync-ready.
- `src/pdf` converts computed domain objects into deterministic black-line PDF sheets with title blocks.
- `src/app` is the responsive PWA UI: guided wizard, validation review, revision actions, export, and a lightweight admin config view.
- `src/data` contains seed jobs/elevations for a pair-door storefront and a no-door storefront.
- `tests` covers the core math and revision behavior.

## Run Locally

```bash
source ~/.nvm/nvm.sh
nvm use
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
npm run sample:pdf
```

Sample PDFs are generated into `public/sample-outputs`.

## V1 Scope

This vertical slice supports:

- FG-2000 interior storefront only.
- Rectangular elevations.
- No door, single door, or pair doors.
- Standard 36 inch by 84 inch leaves.
- Bottom-row doors only.
- Equal bay layout by default.
- Auto transom when overall height allows.
- DLO-to-glass conversion using the editable rule pack.
- Advisory validation for likely ADA, safety glazing, unsupported combinations, wide elevations, and existing-building context.
- Offline project/revision persistence.

This is not a structural design, pricing, ERP, or fabrication optimization tool. Dimension accuracy and deterministic outputs have priority over visual flourish.
