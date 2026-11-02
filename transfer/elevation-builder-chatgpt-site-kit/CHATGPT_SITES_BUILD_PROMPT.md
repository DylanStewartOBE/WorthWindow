# ChatGPT Sites Build Prompt

```text
Integrate the attached Elevation Builder Kit into this existing ChatGPT Site as a first-class take-off workflow. Do not replace the current app, its navigation, or its data layer.

The attached source is the working reference implementation. Copy source/src into a single feature folder such as src/elevation-builder so its relative imports stay intact. Preserve the calculation modules and JSON rule packs exactly unless I explicitly approve a rule change.

Build a Storefront Elevation Builder panel or route that lets an estimator enter and edit:
- Opening width and height
- Rows, columns, equal/custom row and column sizing
- Single or pair doors, location, swing, hinges, hardware, and threshold
- Corner conditions
- Knee walls and lite splits
- Finish, glass, storefront system, and assembly type

Use src/elevation-builder/transfer/elevationBuilder.ts as the only calculation boundary. On a committed input change, call buildStorefrontElevation(elevationInput, context), where context comes from createElevationBuilderContext(). Do not reproduce geometry, glass, metal, validation, or pricing formulas in UI components or server actions.

Render the computed elevation from result.elevation.computedGeometry. Use source/src/app/App.tsx and source/src/app/styles.css as the visual and interaction reference for the SVG elevation, doors, knee walls, lites, assembly labels, selection states, and corner plan view. Adapt the surrounding UI to the existing site design, but preserve the drawing behavior and all door/knee-wall logic.

Use result.takeoff for the materials/take-off section:
- result.takeoff.glassItems for grouped glass lines
- result.takeoff.metal for aluminum/member take-off
- result.takeoff.quote for the current pricing snapshot
- result.elevation.validationFlags for visible warnings

When the estimator saves a take-off, call toStorefrontTakeoffPayload(result) and persist the entire returned JSON payload with the job. Make that payload the calculation snapshot used for future review and exports. Keep its schemaVersion and the rule-pack version data.

Keep the source tests and run them after integration. Add a focused receiving-app test that proves a pair-door elevation with knee walls returns door openings, knee-wall geometry, glass lines, metal lineal footage, validation flags, and a quote total.

The app is an estimating/configuration tool, not a structural or fabrication authority. Keep the existing advisory validations visible and do not represent the configured baseline rule packs as manufacturer-approved data.
```
