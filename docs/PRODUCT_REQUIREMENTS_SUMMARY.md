# Product Requirements Summary

## Purpose

Build a production-shaped V1 of an offline-first field measuring app that generates installer-usable and estimating-ready PDF drawings for interior FG-2000 storefront elevations with optional standard entrances.

## Primary User

A field tech standing in front of an opening with an iPhone. They measure with a tape, enter the opening and selections, then generate clean PDF sheets without doing deduction math.

## Source Of Truth

1. Project-approved shop drawings.
2. Exact FG-2000 reference, installation, and detail documents.
3. Exact WS-500 / NS-212 / MS-375 entrance documents.
4. The project requirements.
5. Generic code defaults.

The app keeps rules data-driven so an admin can override product assumptions as better source documents are added.

## V1 Features

- Job setup and metadata.
- Measurement entry with one squared rough opening width and one squared rough opening height for estimating use.
- The stored measurement set mirrors that width and height across the legacy bottom/center/top and left/center/right fields so older calculation rules remain deterministic.
- FG-2000 baseline storefront rule pack.
- Entrance rule scaffold for standard single-acting doors.
- No-door, single-door, and pair-door layouts.
- Equal bay calculations with door placement controls.
- Auto transom above standard 84 inch doors when height allows.
- Glass takeoff from DLO plus configured glazing add.
- Validation warnings that allow generation unless geometry is impossible.
- Elevation PDF and glass takeoff PDF.
- Local-first persistence and revision snapshots.
- Hidden admin config editor for rule packs and note libraries.

## Non-Goals

- Pricing.
- Structural engineering.
- True fabrication part optimization.
- Heavy CAD rendering or 3D.
- Full hardware object modeling.
- Multi-system manufacturer database.

## Future Phases

Phase 2 adds richer entrance families, deeper validation, more storefront assembly methods, better note libraries, optional DLO debug sheets, and cloud sync.

Phase 3 adds additional systems, pricing schema, product database expansion, and broader field logic.
