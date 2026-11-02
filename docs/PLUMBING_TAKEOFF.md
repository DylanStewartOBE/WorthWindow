# Plumbing Takeoff

The Plumbing workspace on the product landing page is a separate takeoff engine for Worth plumbing scopes. It does not share rules with the FG-2000 storefront engine. It reuses only the app shell, branding, and the jsPDF download helper.

## Who it is for

- **Estimator at a desk:** builds the takeoff from plans by entering areas, fixture counts, and pipe runs, then exports the takeoff package, customer quote, and material CSV.
- **Field tech on an iPhone:** opens the same job offline, adds or adjusts fixtures, and records rough-in stub-out measurements before walls close.

## Workflow

| Step | What happens |
| --- | --- |
| Job | Job info, residential (private) or commercial (public) use, project type, scope notes. Jobs autosave to this device; archive, delete, or load the sample job. |
| Plans | Upload plan PDFs, check each sheet's scale, then draw pipe runs and tap fixtures on the sheet. See **Plan takeoff** below. |
| Fixtures | Areas (room, unit type, or floor) with a **Repeats** multiplier, so a typical unit is entered once. Tap fixture chips to count. Each line is furnished by Worth or by others (install only). |
| Piping | Runs by system (sanitary, vent, cold, hot, hot-return, gas, storm, condensate), material, size, length, and location (underground, above ground, in wall). Fittings are estimated from the rule pack unless counted. Runs assigned to an area are multiplied by its repeat count. |
| Field verify | One check per rough-in dimension for every fixture type entered (drain distance from wall, supply heights, valve and head heights, and so on). Tape entries like `17 1/2` or `1'5-1/2"` are compared against the fixture library range. |
| Shopping list | What to order: pipe in full sticks or coils from the cut list, fittings by type and size, rough-in and trim parts, supports, site materials, and equipment rental, each with a brand. Exports PDF and CSV, or copies as text for a supplier. |
| Takeoff | Material list by phase (underground, rough-in, set & trim), fixture schedule with DFU and WSFU, pipe totals, and review flags. |
| Quote | Phase costs, fixtures, labor, tax, allowances, permit, overhead, and margin. Exports the takeoff package PDF, customer quote PDF, and material CSV. Revisions are saved snapshots that can be restored. |

## Plan takeoff (`src/plumbing/plan`, `src/plumbing/ui/PlansStep.tsx`)

**Reading the PDF.** pdf.js loads only when the Plans step is used. For each file the app keeps the document details (title, author, creating program, created and modified dates). For each page it records:

- paper size, with a warning on small sheets that may be reduced prints
- sheet number (the largest text that looks like `P-101`, preferring plumbing prefixes) and title
- every printed scale (`1/4" = 1'-0"`, `1" = 20'`, `1:48`), most frequent first

The first detected scale is applied. It can be changed from a list, or calibrated by tapping both ends of a known dimension and typing its length. Scanned sheets have no text, so their scale is set by hand.

**Drawing.** The same tools work with a mouse, a pen, or a finger:

- Drag to pan; pinch, scroll, or use + / - to zoom.
- **Pipe:** tap each turn. Points snap to existing pipe ends, fixtures, and pipe segments, and 45° snap keeps runs square.
  - Start on a pipe to branch off it. End on a fixture or another pipe, tap the last point twice, or press Finish run.
  - Draw from the downstream end (sewer or main) outward. Underground pipe falls toward the first point.
- **Fixture:** tap a symbol to count it.
- **Select:** tap a run or fixture to edit or delete it.
- **Full screen** gives the sheet most of a phone screen.

**What a drawn run produces** (`plan/analyze.ts`):

| Item | Rule |
| --- | --- |
| Length | Plan length at the sheet scale, plus rises and drops: a fixture rise per connection (by system), the pipe depth when underground, and any extra vertical feet entered. |
| Bends | Each turn is built from 90 / 45 / 22-1/2 / 11-1/4 bends; turns that cannot be made within 5° are flagged. DWV pipe gets drainage names (1/4 bend long sweep, 1/8 bend), pressure pipe gets elbows. |
| Branches | Ending on the middle of another pipe adds a combination wye & 1/8 bend (square entry) or a wye (45°) on drainage, a sanitary tee on vent, or a tee on pressure pipe, sized main x branch. |
| Joins | End-to-end joins add a coupling, the bends for any turn, or a reducer when sizes differ (counted once). |
| Fixture connections | A riser bend and vertical pipe. |
| Splices | Couplings wherever a straight is longer than a stick or coil. |
| Trench | Underground runs: trench width from pipe size plus side clearance, depth from the high-end depth and slope, and dig, bedding, and backfill volumes. Mark a run "shares a trench" so the digging is not counted twice. Warning tape and tracer wire are added by system and material. |
| Cut list | All pieces of each pipe size are packed into stock lengths (first-fit decreasing). The order is never below the waste allowance. |

Tapped fixtures and drawn runs count toward the area set on the sheet (with that area's repeat count) and go into the same fixture schedule, rough-in kits, labor, quote, and shopping list as hand-entered ones. Hand-entered fixtures are still counted, so don't enter the same fixture both ways.

PDFs are stored in the device's IndexedDB. A job opened on a device that lacks the PDF asks to re-attach it.

**Brands.** Each pipe material has pipe and fitting brand lists in `piping.json` (first is the default), and catalog materials can carry `brands`. On the Shopping list step, a brand can be picked per material group, or a new one typed in for the job.

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
| `piping.json` | Pipe materials (schedule, brands, allowed systems, stick length, hanger spacing, cost and labor per size), fitting types and cost factors, plan rules (bend angles, fixture rise, default depth and slope), excavation rules, fittings per 100 ft, waste %, building drain table, demand table |
| `pricing.json` | Labor rate, tax, overhead, margin, permit, testing and mobilization hours, assumptions, exclusions |

### Before using it for real bids

- **Every unit cost, fixture allowance, and labor unit is a budget placeholder.** Replace them with Worth supplier pricing and crew history.
- DFU and WSFU defaults come from IPC Table 709.1 and Appendix E. The building drain table comes from IPC Table 710.1(1); the demand curve from IPC Table E103.3(3); hanger spacing from IPC Table 308.5. If the jurisdiction adopts the UPC or a local amendment, update `fixtures.json` and `piping.json`.
- Rough-in ranges are typical values. The approved fixture cut sheet governs.
- Sizing outputs are estimating references, not an engineered design.

## Storage

Jobs and revisions use their own IndexedDB database (`worth-plumbing-takeoff`), with a localStorage fallback. They are separate from storefront records.

## Not in this pass

- Reading pipe automatically from CAD line work (runs are drawn by hand)
- Branches inheriting the main's depth (set high-end depth per run)
- Supplier price imports and SKUs
- Cloud sync
- Per-run sizing calculations (branch and riser sizing)
- Fixture-specific carriers and options beyond the library entries
