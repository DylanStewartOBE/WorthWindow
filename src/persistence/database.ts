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
}

export interface LocalSnapshot {
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
    return {
      jobs: await this.getJobs(),
      elevations: await this.getElevations(),
      revisions: await this.getRevisions(),
      exportedAt: new Date().toISOString()
    };
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
    return { ...this.read(), exportedAt: new Date().toISOString() };
  }

  private read(): LocalSnapshot {
    const raw = localStorage.getItem(this.key);
    if (!raw) return emptySnapshot();
    return JSON.parse(raw) as LocalSnapshot;
  }

  private write(snapshot: LocalSnapshot): void {
    localStorage.setItem(this.key, JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString() }));
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

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const next = items.filter((existing) => existing.id !== item.id);
  next.push(item);
  return next;
}

function emptySnapshot(): LocalSnapshot {
  return {
    jobs: [],
    elevations: [],
    revisions: [],
    exportedAt: new Date().toISOString()
  };
}

