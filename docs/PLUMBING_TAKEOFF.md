# Plumbing Takeoff

The Plumbing workspace on the product landing page is a separate takeoff engine for Worth plumbing scopes. It does not share rules with the FG-2000 storefront engine. It reuses only the app shell, branding, and the jsPDF download helper.

## Who it is for

- **Estimator at a desk:** builds the takeoff from plans by entering areas, fixture counts, and pipe runs, then exports the takeoff package, customer quote, and material CSV.
- **Field tech on an iPhone:** opens the same job offline, adds or adjusts fixtures, and records rough-in stub-out measurements before walls close.

## Workflow

| Step | What happens |
| --- | --- |
| Job | Job info, residential (private) or commercial (public) use, project type, scope notes. Jobs autosave to this device; archive, delete, or load the sample job. |
| Fixtures | Areas (room, unit type, or floor) with a **Repeats** multiplier, so a typical unit is entered once. Tap fixture chips to count. Each line is furnished by Worth or by others (install only). |
| Piping | Runs by system (sanitary, vent, cold, hot, hot-return, gas, storm, condensate), material, size, length, and location (underground, above ground, in wall). Fittings are estimated from the rule pack unless counted. Runs assigned to an area are multiplied by its repeat count. |
| Field verify | One check per rough-in dimension for every fixture type entered (drain distance from wall, supply heights, valve and head heights, and so on). Tape entries like `17 1/2` or `1'5-1/2"` are compared against the fixture library range. |
| Takeoff | Material list by phase (underground, rough-in, set & trim), fixture schedule with DFU and WSFU, pipe totals, and review flags. |
| Quote | Phase costs, fixtures, labor, tax, allowances, permit, overhead, and margin. Exports the takeoff package PDF, customer quote PDF, and material CSV. Revisions are saved snapshots that can be restored. |

## Engine (`src/plumbing/domain`)

All of these are pure TypeScript and covered in `tests/plumbing.test.ts`.

- `takeoff.ts` `buildPlumbingTakeoff(job, config)` is the single entry point.
  - Fixture lines expand to rough-in kits, trim kits, rough and trim labor, and a fixture allowance (Worth-furnished only).
  - Pipe is summed by phase, material, and size, then waste is added and the total is rounded up to whole sticks or coils for ordering. Material cost uses the order quantity; labor uses the installed length.
  - Hangers follow the material's spacing (larger spacing above `largeSizeFrom`). Underground runs get none.
  - Insulated hot, hot-return, and condensate runs add insulation by the foot.
- `sizing.ts` totals DFU and WSFU (public-use values on commercial jobs), finds the minimum building drain at 1/4" per foot (at least 3" when there is a water closet), and estimates peak GPM on the Hunter's curve table.
- `roughIn.ts` checks field measurements against `min` / `target` / `max`.
- `validation.ts` produces advisory flags. Nothing blocks output.
- `quote.ts` applies `pricing.json`.

## Rule packs (`src/plumbing/config`)

Open the app with `?admin=1` or `#admin` to edit them in the Plumbing workspace. Edits are kept in this browser's local storage until **Reset to defaults** is used.

| File | Holds |
| --- | --- |
| `fixtures.json` | Fixture types: DFU, WSFU, public-use overrides, rough and trim kits, labor hours, fixture allowance, rough-in ranges |
| `materials.json` | Kit materials, hangers, insulation: unit cost and labor |
| `piping.json` | Pipe materials (allowed systems, stick length, hanger spacing, cost and labor per size), fittings per 100 ft, waste %, building drain table, demand table |
| `pricing.json` | Labor rate, tax, overhead, margin, permit, testing and mobilization hours, assumptions, exclusions |

### Before using it for real bids

- **Every unit cost, fixture allowance, and labor unit is a budget placeholder.** Replace them with Worth supplier pricing and crew history.
- DFU and WSFU defaults come from IPC Table 709.1 and Appendix E. The building drain table comes from IPC Table 710.1(1); the demand curve from IPC Table E103.3(3); hanger spacing from IPC Table 308.5. If the jurisdiction adopts the UPC or a local amendment, update `fixtures.json` and `piping.json`.
- Rough-in ranges are typical values. The approved fixture cut sheet governs.
- Sizing outputs are estimating references, not an engineered design.

## Storage

Jobs and revisions use their own IndexedDB database (`worth-plumbing-takeoff`), with a localStorage fallback. They are separate from storefront records.

## Not in this pass

- Plan-sheet measuring (digitizing runs from PDFs)
- Supplier price imports
- Cloud sync
- Per-run sizing calculations (branch and riser sizing)
- Fixture-specific carriers and options beyond the library entries
