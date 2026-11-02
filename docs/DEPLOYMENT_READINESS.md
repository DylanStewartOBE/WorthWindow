# Deployment Readiness

## Current Release Shape

The app is a static, offline-capable PWA. Jobs, elevations, and revisions are stored in the browser on each device. There is no server database, account system, cloud sync, or payment processing.

That shape is suitable for an owner-operated pilot or a small invited beta. It is not yet suitable for promising customers that their work follows them between devices or can be recovered by support.

## Private Beta Gate

Before inviting field testers:

- Run `npm run verify`.
- Generate and inspect the sample PDFs with `npm run sample:pdf`.
- Deploy over HTTPS with SPA fallback routing to `/index.html`.
- Serve `/sw.js` and `/index.html` with `Cache-Control: no-cache`.
- Serve hashed `/assets/*` files with long-lived immutable caching.
- Test installation, offline startup, PDF generation, backup, and restore on a real iPhone.
- Use a separate test pricing profile and label quotes as budgetary until rates and exclusions are approved.
- Hide or disable unfinished product workspaces in the public release.

## Paid Release Gate

Before accepting customer payment:

- Decide whether the product is intentionally local-only or requires accounts and cloud sync.
- If cloud-backed, add authentication, tenant isolation, encrypted transport, backups, data export, and account deletion.
- Add error reporting and release monitoring without collecting measurements or customer data unnecessarily.
- Publish terms of service, privacy policy, support contact, refund policy, and the product's calculation/engineering limitations.
- Confirm ownership or licensing for product data, logos, manufacturer references, and pricing content.
- Establish a pricing approval workflow so every quote records the immutable pricing profile version used.
- Add end-to-end tests for the primary phone workflow and every supported PDF output.
- Complete an accessibility pass and test the supported iOS and Android versions.

## Hosting Requirements

Any static host is viable if it provides:

- HTTPS on a custom domain.
- SPA fallback routing.
- Per-path cache headers.
- Atomic deployments and rollback.
- Preview deployments for release testing.

The first host should be selected after deciding whether the initial product stays local-only. A future authenticated API can be added without moving the static frontend if the repository boundary remains intact.

## Release Routine

1. Update the package version and any changed rule-pack versions.
2. Run `npm run verify`.
3. Generate and inspect sample outputs.
4. Deploy to a preview URL.
5. Test install, upgrade, offline startup, backup, restore, and PDF sharing on a phone.
6. Promote the same build to production.
7. Record the release date, app version, rule-pack versions, and rollback target.
