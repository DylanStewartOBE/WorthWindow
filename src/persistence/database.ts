import type { Elevation, Job, Revision } from "../domain/types";

export interface AppRepository {
  getJobs(): Promise<Job[]>;
  getElevations(): Promise<Elevation[]>;
  getRevisions(elevationId?: string): Promise<Revision[]>;
  saveJob(job: Job): Promise<void>;
  saveElevation(elevation: Elevation): Promise<void>;
  saveRevision(revision: Revision): Promise<void>;
  deleteElevation(id: string): Promise<void>;
  exportSnapshot(): Promise<LocalSnapshot>;
  replaceSnapshot(snapshot: LocalSnapshot): Promise<void>;
}

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface LocalSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  appVersion?: string;
  jobs: Job[];
  elevations: Elevation[];
  revisions: Revision[];
  exportedAt: string;
}

type StoreName = "jobs" | "elevations" | "revisions";

const DB_NAME = "fg-2000-field-measure";
const DB_VERSION = 1;

export class IndexedDbRepository implements AppRepository {
  private dbPromise: Promise<IDBDatabase> | undefined;

  async getJobs(): Promise<Job[]> {
    return this.getAll("jobs");
  }

  async getElevations(): Promise<Elevation[]> {
    return this.getAll("elevations");
  }

  async getRevisions(elevationId?: string): Promise<Revision[]> {
    const revisions = await this.getAll<Revision>("revisions");
    return elevationId ? revisions.filter((revision) => revision.elevationId === elevationId) : revisions;
  }

  async saveJob(job: Job): Promise<void> {
    await this.put("jobs", job);
  }

  async saveElevation(elevation: Elevation): Promise<void> {
    await this.put("elevations", elevation);
  }

  async saveRevision(revision: Revision): Promise<void> {
    await this.put("revisions", revision);
  }

  async deleteElevation(id: string): Promise<void> {
    const db = await this.open();
    await transactionPromise(db, "elevations", "readwrite", (store) => store.delete(id));
  }

  async exportSnapshot(): Promise<LocalSnapshot> {
    return createSnapshot({
      jobs: await this.getJobs(),
      elevations: await this.getElevations(),
      revisions: await this.getRevisions()
    });
  }

  async replaceSnapshot(snapshot: LocalSnapshot): Promise<void> {
    const db = await this.open();
    await replaceIndexedDbSnapshot(db, parseLocalSnapshot(snapshot));
  }

  private async getAll<T>(storeName: StoreName): Promise<T[]> {
    const db = await this.open();
    return transactionPromise<T[]>(db, storeName, "readonly", (store) => store.getAll());
  }

  private async put<T extends { id: string }>(storeName: StoreName, item: T): Promise<void> {
    const db = await this.open();
    await transactionPromise(db, storeName, "readwrite", (store) => store.put(item));
  }

  private async open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (!("indexedDB" in globalThis)) {
      throw new Error("IndexedDB is not available in this environment.");
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        createStore(db, "jobs");
        createStore(db, "elevations");
        createStore(db, "revisions");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }
}

export class LocalStorageRepository implements AppRepository {
  private key = "fg-2000-field-measure-snapshot";

  async getJobs(): Promise<Job[]> {
    return this.read().jobs;
  }

  async getElevations(): Promise<Elevation[]> {
    return this.read().elevations;
  }

  async getRevisions(elevationId?: string): Promise<Revision[]> {
    const revisions = this.read().revisions;
    return elevationId ? revisions.filter((revision) => revision.elevationId === elevationId) : revisions;
  }

  async saveJob(job: Job): Promise<void> {
    const snapshot = this.read();
    snapshot.jobs = upsert(snapshot.jobs, job);
    this.write(snapshot);
  }

  async saveElevation(elevation: Elevation): Promise<void> {
    const snapshot = this.read();
    snapshot.elevations = upsert(snapshot.elevations, elevation);
    this.write(snapshot);
  }

  async saveRevision(revision: Revision): Promise<void> {
    const snapshot = this.read();
    snapshot.revisions = upsert(snapshot.revisions, revision);
    this.write(snapshot);
  }

  async deleteElevation(id: string): Promise<void> {
    const snapshot = this.read();
    snapshot.elevations = snapshot.elevations.filter((elevation) => elevation.id !== id);
    this.write(snapshot);
  }

  async exportSnapshot(): Promise<LocalSnapshot> {
    return createSnapshot(this.read());
  }

  async replaceSnapshot(snapshot: LocalSnapshot): Promise<void> {
    this.write(parseLocalSnapshot(snapshot));
  }

  private read(): LocalSnapshot {
    const raw = localStorage.getItem(this.key);
    if (!raw) return emptySnapshot();
    return parseLocalSnapshot(JSON.parse(raw));
  }

  private write(snapshot: LocalSnapshot): void {
    localStorage.setItem(this.key, JSON.stringify(createSnapshot(snapshot)));
  }
}

export function createRepository(): AppRepository {
  if ("indexedDB" in globalThis) return new IndexedDbRepository();
  return new LocalStorageRepository();
}

function createStore(db: IDBDatabase, name: StoreName) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath: "id" });
  }
}

function transactionPromise<T>(
  db: IDBDatabase,
  storeName: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function replaceIndexedDbSnapshot(db: IDBDatabase, snapshot: LocalSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["jobs", "elevations", "revisions"], "readwrite");
    const itemsByStore: Record<StoreName, Array<Job | Elevation | Revision>> = {
      jobs: snapshot.jobs,
      elevations: snapshot.elevations,
      revisions: snapshot.revisions
    };

    for (const storeName of Object.keys(itemsByStore) as StoreName[]) {
      const store = transaction.objectStore(storeName);
      store.clear();
      for (const item of itemsByStore[storeName]) {
        store.put(item);
      }
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Backup restore was aborted."));
  });
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const next = items.filter((existing) => existing.id !== item.id);
  next.push(item);
  return next;
}

export function parseLocalSnapshot(value: unknown): LocalSnapshot {
  if (!isRecord(value)) {
    throw new Error("Backup must be a JSON object.");
  }

  const schemaVersion = value.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION;
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Backup schema version ${String(schemaVersion)} is not supported.`);
  }

  const jobs = parseEntityArray<Job>(value.jobs, "jobs");
  const elevations = parseEntityArray<Elevation>(value.elevations, "elevations");
  const revisions = parseEntityArray<Revision>(value.revisions, "revisions");
  assertUniqueIds(jobs, "jobs");
  assertUniqueIds(elevations, "elevations");
  assertUniqueIds(revisions, "revisions");

  for (const job of jobs) {
    if (
      !hasStringFields(job, ["name", "number", "customer", "createdBy", "dateCreated", "activeRevision"]) ||
      !Array.isArray(job.elevationIds) ||
      !job.elevationIds.every((id) => typeof id === "string")
    ) {
      throw new Error(`Job ${job.id} is missing required job data.`);
    }
  }

  for (const elevation of elevations) {
    if (
      !hasStringFields(elevation, ["jobId", "name", "systemRulePackId", "assemblyType"]) ||
      !isMeasurementSet(elevation.measurementSet) ||
      !isPositiveInteger(elevation.rows) ||
      !isPositiveInteger(elevation.columns) ||
      !isRecord(elevation.doorConfig) ||
      !isRecord(elevation.cornerConfig) ||
      !isRecord(elevation.finishConfig) ||
      !isRecord(elevation.glassConfig) ||
      !isRecord(elevation.computedGeometry) ||
      !isRecord(elevation.computedGlass) ||
      !Array.isArray(elevation.validationFlags)
    ) {
      throw new Error(`Elevation ${elevation.id} is missing required measurement or calculation data.`);
    }
  }

  for (const revision of revisions) {
    if (
      !hasStringFields(revision, ["elevationId", "number", "timestamp"]) ||
      !isRecord(revision.snapshot) ||
      !isRecord(revision.snapshot.input)
    ) {
      throw new Error(`Revision ${revision.id} is missing required elevation or snapshot data.`);
    }
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    appVersion: typeof value.appVersion === "string" ? value.appVersion : undefined,
    jobs,
    elevations,
    revisions,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString()
  };
}

function createSnapshot(
  snapshot: Pick<LocalSnapshot, "jobs" | "elevations" | "revisions"> & Partial<Pick<LocalSnapshot, "appVersion">>
): LocalSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    appVersion: snapshot.appVersion,
    jobs: snapshot.jobs,
    elevations: snapshot.elevations,
    revisions: snapshot.revisions,
    exportedAt: new Date().toISOString()
  };
}

function parseEntityArray<T extends { id: string }>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Backup field "${label}" must be an array.`);
  }

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.trim() === "") {
      throw new Error(`Backup field "${label}" contains an item without a valid ID.`);
    }
  }

  return value as T[];
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`Backup field "${label}" contains duplicate ID "${item.id}".`);
    }
    ids.add(item.id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringFields(value: unknown, fields: string[]): boolean {
  if (!isRecord(value)) return false;
  return fields.every((field) => typeof value[field] === "string");
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isMeasurementSet(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    "widthBottom",
    "widthCenter",
    "widthTop",
    "heightLeft",
    "heightCenter",
    "heightRight"
  ].every((field) => typeof value[field] === "number" && Number.isFinite(value[field]));
}

function emptySnapshot(): LocalSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    jobs: [],
    elevations: [],
    revisions: [],
    exportedAt: new Date().toISOString()
  };
}
