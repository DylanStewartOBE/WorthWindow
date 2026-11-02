import type { PlumbingJob, PlumbingRevision } from "./domain/types";

export interface PlumbingRepository {
  getJobs(): Promise<PlumbingJob[]>;
  saveJob(job: PlumbingJob): Promise<void>;
  deleteJob(id: string): Promise<void>;
  getRevisions(jobId: string): Promise<PlumbingRevision[]>;
  saveRevision(revision: PlumbingRevision): Promise<void>;
}

type StoreName = "jobs" | "revisions";

// Separate database from the storefront app so the two engines never share records.
const DB_NAME = "worth-plumbing-takeoff";
const DB_VERSION = 1;

class IndexedDbPlumbingRepository implements PlumbingRepository {
  private dbPromise: Promise<IDBDatabase> | undefined;

  async getJobs(): Promise<PlumbingJob[]> {
    return this.request<PlumbingJob[]>("jobs", "readonly", (store) => store.getAll());
  }

  async saveJob(job: PlumbingJob): Promise<void> {
    await this.request("jobs", "readwrite", (store) => store.put(job));
  }

  async deleteJob(id: string): Promise<void> {
    await this.request("jobs", "readwrite", (store) => store.delete(id));
  }

  async getRevisions(jobId: string): Promise<PlumbingRevision[]> {
    const revisions = await this.request<PlumbingRevision[]>("revisions", "readonly", (store) => store.getAll());
    return revisions.filter((revision) => revision.jobId === jobId);
  }

  async saveRevision(revision: PlumbingRevision): Promise<void> {
    await this.request("revisions", "readwrite", (store) => store.put(revision));
  }

  private async request<T>(storeName: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          (["jobs", "revisions"] as StoreName[]).forEach((name) => {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
          });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }
}

class LocalStoragePlumbingRepository implements PlumbingRepository {
  private key = "worth-plumbing-takeoff";

  async getJobs(): Promise<PlumbingJob[]> {
    return this.read().jobs;
  }

  async saveJob(job: PlumbingJob): Promise<void> {
    const data = this.read();
    data.jobs = [...data.jobs.filter((existing) => existing.id !== job.id), job];
    this.write(data);
  }

  async deleteJob(id: string): Promise<void> {
    const data = this.read();
    data.jobs = data.jobs.filter((job) => job.id !== id);
    this.write(data);
  }

  async getRevisions(jobId: string): Promise<PlumbingRevision[]> {
    return this.read().revisions.filter((revision) => revision.jobId === jobId);
  }

  async saveRevision(revision: PlumbingRevision): Promise<void> {
    const data = this.read();
    data.revisions = [...data.revisions.filter((existing) => existing.id !== revision.id), revision];
    this.write(data);
  }

  private read(): { jobs: PlumbingJob[]; revisions: PlumbingRevision[] } {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) return JSON.parse(raw);
    } catch {
      // fall through to empty
    }
    return { jobs: [], revisions: [] };
  }

  private write(data: { jobs: PlumbingJob[]; revisions: PlumbingRevision[] }) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
}

export function createPlumbingRepository(): PlumbingRepository {
  if ("indexedDB" in globalThis) return new IndexedDbPlumbingRepository();
  return new LocalStoragePlumbingRepository();
}
