import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultEntranceRulePack,
  defaultNoteLibrary,
  defaultStorefrontRulePack,
  defaultValidationLibrary
} from "../src/config/options";
import { buildSeedElevations, seedJob } from "../src/data/seed";
import { createRevisionSnapshot } from "../src/domain/revision";
import {
  LocalStorageRepository,
  SNAPSHOT_SCHEMA_VERSION,
  parseLocalSnapshot
} from "../src/persistence/database";

const elevation = buildSeedElevations({
  storefrontRulePack: defaultStorefrontRulePack,
  entranceRulePack: defaultEntranceRulePack,
  noteLibrary: defaultNoteLibrary,
  validationLibrary: defaultValidationLibrary
})[0];
const revision = createRevisionSnapshot(elevation, "A");

describe("local data backups", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("accepts existing unversioned snapshots as schema version 1", () => {
    const snapshot = parseLocalSnapshot({
      jobs: [seedJob],
      elevations: [elevation],
      revisions: [revision],
      exportedAt: "2026-07-02T12:00:00.000Z"
    });

    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.jobs[0].id).toBe(seedJob.id);
    expect(snapshot.elevations[0].id).toBe(elevation.id);
  });

  it("rejects unsupported or malformed snapshots before restore", () => {
    expect(() =>
      parseLocalSnapshot({
        schemaVersion: 99,
        jobs: [],
        elevations: [],
        revisions: []
      })
    ).toThrow(/not supported/);

    expect(() =>
      parseLocalSnapshot({
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        jobs: [seedJob],
        elevations: [{ id: "broken-elevation", jobId: seedJob.id }],
        revisions: []
      })
    ).toThrow(/measurement or calculation data/);
  });

  it("replaces and exports the complete local snapshot", async () => {
    const repository = new LocalStorageRepository();
    const snapshot = parseLocalSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      appVersion: "0.1.0",
      jobs: [seedJob],
      elevations: [elevation],
      revisions: [revision],
      exportedAt: "2026-07-02T12:00:00.000Z"
    });

    await repository.replaceSnapshot(snapshot);
    const exported = await repository.exportSnapshot();

    expect(exported.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(exported.appVersion).toBe("0.1.0");
    expect(exported.jobs).toHaveLength(1);
    expect(exported.elevations).toHaveLength(1);
    expect(exported.revisions).toHaveLength(1);
  });
});
