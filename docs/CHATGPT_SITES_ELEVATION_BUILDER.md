# ChatGPT Sites Elevation Builder Handoff

This package moves the working FG-2000 storefront elevation builder into an existing ChatGPT Site without re-creating its rules by hand. The kit keeps the original TypeScript calculator, JSON rule packs, React/SVG drawing surface, optional PDF output, and tests together.

## What To Give The Site Builder

Attach `transfer/elevation-builder-chatgpt-site-kit.zip` to the ChatGPT Sites task and paste the contents of `CHATGPT_SITES_BUILD_PROMPT.md` from the kit. The source bundle is the reference implementation. The receiving site should preserve its own structure, navigation, data layer, and visual language while placing the kit under a single `elevation-builder` feature folder.

If the receiving site has a `src` directory, copy `source/src` to `src/elevation-builder`. That keeps the existing relative imports working:

- `src/elevation-builder/transfer/elevationBuilder.ts` is the stable entry point for calculations and take-off output.
- `src/elevation-builder/domain` contains the pure geometry, door, knee-wall, glass, metal, validation, and quote logic.
- `src/elevation-builder/config` contains editable storefront, entrance, pricing, validation, note, and branding rule packs.
- `src/elevation-builder/app/App.tsx` and `styles.css` are the complete working React/SVG reference surface, including interactive elevation graphics and plan view.
- `src/elevation-builder/pdf` and `persistence` are optional. Bring them over only when the receiving site needs PDF export or device-local draft storage.

## Receiving App Contract

Use the exported API rather than calling geometry helpers in different parts of the receiving app.

```ts
import {
  buildStorefrontElevation,
  createElevationBuilderContext,
  toStorefrontTakeoffPayload
} from "@/elevation-builder/transfer/elevationBuilder";

const context = createElevationBuilderContext({
  // Replace rule packs here only after an authorized product/pricing update.
});

const result = buildStorefrontElevation(elevationInput, context);
const payload = toStorefrontTakeoffPayload(result);

await saveTakeoff({
  elevationPayload: payload,
  total: payload.takeoff.quote.total
});
```

`elevationInput` uses the `ElevationInput` interface in `source/src/domain/types.ts`. It carries the field values a user changes: measured opening, rows, columns, equal or custom sizing, door sets, corners, knee walls, lite splits, finish, glass, system, and assembly type.

The result is calculated once and contains the computed geometry for graphics, validation flags, grouped glass lines, metal take-off, and the quote snapshot. Store the full `StorefrontTakeoffPayload` with the take-off record so later review uses the same rules and output that the estimator saw.

## Integration Order

1. Copy the `source/src` folder under the receiving site’s elevation-builder feature folder. Copy `source/public/brand` only if the existing branding files are needed.
2. Add a Storefront Elevation Builder route or panel inside the take-off workflow. Feed user edits into a single `ElevationInput` state object.
3. Recalculate with `buildStorefrontElevation` after each committed edit. Use `result.elevation.computedGeometry` to render or inspect the elevation; use `result.takeoff` for take-off and pricing data.
4. Connect `toStorefrontTakeoffPayload(result)` to the receiving site’s save action or API. Persist it as JSON along with the source rule-pack version embedded in the result.
5. Use `source/src/app/App.tsx` plus `styles.css` as the complete interactive drawing reference. Preserve all domain logic; only adapt the outer layout, navigation, and persistence boundary to the receiving site.
6. Run the included tests after the move. Keep the same expected geometry results before changing any rule pack.

## Guardrails

- Do not treat the baseline rule packs as manufacturer-approved fabrication or structural design data. Keep the current advisory validation and arrange technical review before selling production outputs.
- Do not split the calculation across the UI, API, and take-off table. The portable adapter is the one calculation boundary.
- Price changes belong in `config/rulepacks/quote-pricing.json`; geometry changes belong in the appropriate storefront or entrance rule pack. Make those changes versioned and test them.
- Preserve `schemaVersion`, rule-pack versions, the original `ElevationInput`, and the generated result when an estimate is saved.

## Regenerate The Kit

From this project, run:

```bash
npm run transfer:chatgpt-site
```

That rebuilds the folder and ZIP after future elevation-builder changes.
